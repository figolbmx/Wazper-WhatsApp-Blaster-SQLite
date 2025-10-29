const express = require('express');
const router = express.Router();
const models = require('../models');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { Op, fn, col } = require('sequelize');

const upload = multer({
    dest: 'uploads/temp/',
    limits: {
        fileSize: 16 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/avi', 'video/mov', 'video/wmv',
            'audio/mp3', 'audio/wav', 'audio/aac', 'audio/ogg',
            'application/pdf', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('File type not supported'), false);
        }
    }
});

router.post('/send', async (req, res) => {
    try {
        const { fromAccountId, toNumber, message, scheduledAt } = req.body;
        
        if (!fromAccountId || !toNumber || !message) {
            return res.status(400).json({ error: 'fromAccountId, toNumber, and message are required' });
        }
        
        const account = await models.Account.findOne({
            where: { id: fromAccountId, status: 'connected' }
        });
        
        if (!account) {
            return res.status(400).json({ error: 'Account not found or not connected' });
        }
        
        const whatsappService = require('../services/whatsapp');
        
        try {
            const result = await whatsappService.sendTextMessage(fromAccountId, toNumber, message);
            
            console.log(`✅ Single message successfully sent to ${toNumber}`);
            
            await models.ActivityLog.create({
                account_id: fromAccountId,
                action: 'message_sent',
                description: `Message sent to ${toNumber}`
            });
            
            res.json({ 
                success: true, 
                message: 'Message sent successfully',
                result: result 
            });
            
        } catch (waError) {
            console.error(`❌ Failed to send single message to ${toNumber}:`, waError.message);
            throw waError;
        }
        
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message: ' + error.message });
    }
});

router.post('/send-media', (req, res, next) => {
    upload.single('media')(req, res, (err) => {
        if (err) {
            console.error('❌ Multer upload error:', err);
            
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'File too large. Maximum size is 16MB.' });
            } else if (err.message === 'File type not supported') {
                return res.status(400).json({ error: 'File type not supported. Please use images, videos, audio, or documents.' });
            } else if (err instanceof multer.MulterError) {
                return res.status(400).json({ error: 'Upload error: ' + err.message });
            }
            
            return res.status(500).json({ error: 'File upload failed: ' + err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        const { fromAccountId, toNumber, message, scheduledAt } = req.body;
        const mediaFile = req.file;
        
        console.log('📎 Media message request received:');
        console.log('  - fromAccountId:', fromAccountId);
        console.log('  - toNumber:', toNumber);
        console.log('  - message:', message);
        console.log('  - mediaFile:', mediaFile ? {
            filename: mediaFile.filename,
            originalname: mediaFile.originalname,
            mimetype: mediaFile.mimetype,
            size: mediaFile.size,
            path: mediaFile.path
        } : 'No media file');
        
        if (!fromAccountId || !toNumber) {
            return res.status(400).json({ error: 'From account and to number are required' });
        }
        
        if (!message?.trim() && !mediaFile) {
            return res.status(400).json({ error: 'Either message or media file is required' });
        }
        
        const phoneRegex = /^[0-9]{10,15}$/;
        if (!phoneRegex.test(toNumber)) {
            return res.status(400).json({ error: 'Invalid phone number format' });
        }
        
        const account = await models.Account.findOne({
            where: { id: fromAccountId, status: 'connected' }
        });
        
        if (!account) {
            return res.status(400).json({ error: 'Account not found or not connected' });
        }
        
        if (scheduledAt) {
            return res.status(501).json({ error: 'Scheduled media messages not implemented yet' });
        }
        
        const whatsappService = require('../services/whatsapp');
        
        try {
            let result;
            
            if (mediaFile && message?.trim()) {
                result = await whatsappService.sendMediaMessage(fromAccountId, toNumber, mediaFile, message.trim());
            } else if (mediaFile) {
                result = await whatsappService.sendMediaMessage(fromAccountId, toNumber, mediaFile);
            } else {
                result = await whatsappService.sendTextMessage(fromAccountId, toNumber, message.trim());
            }
            
            console.log(`✅ Media message successfully sent to ${toNumber}`);
            
            await models.ActivityLog.create({
                account_id: fromAccountId,
                action: 'media_message_sent',
                description: `Media message sent to ${toNumber}`
            });
            
            if (mediaFile && mediaFile.path) {
                try {
                    await fs.unlink(mediaFile.path);
                } catch (cleanupError) {
                    console.log('File cleanup warning:', cleanupError.message);
                }
            }
            
            res.json({ 
                success: true, 
                message: 'Media message sent successfully',
                result: result 
            });
            
        } catch (waError) {
            if (mediaFile && mediaFile.path) {
                try {
                    await fs.unlink(mediaFile.path);
                } catch (cleanupError) {
                    console.log('File cleanup warning:', cleanupError.message);
                }
            }
            
            console.error(`❌ Failed to send media message to ${toNumber}:`, waError.message);
            throw waError;
        }
        
    } catch (error) {
        console.error('❌ Error sending media message:', error);
        
        if (req.file && req.file.path) {
            try {
                await fs.unlink(req.file.path);
            } catch (cleanupError) {
                console.log('File cleanup warning:', cleanupError.message);
            }
        }
        
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 16MB.' });
        } else if (error.message === 'File type not supported') {
            return res.status(400).json({ error: 'File type not supported. Please use images, videos, audio, or documents.' });
        }
        
        res.status(500).json({ error: 'Failed to send media message: ' + error.message });
    }
});

router.get('/templates', async (req, res) => {
    try {
        const templates = await models.MessageTemplate.findAll({
            order: [['created_at', 'DESC']]
        });
        
        res.json(templates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/templates/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const template = await models.MessageTemplate.findByPk(id);
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        res.json(template);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/templates', async (req, res) => {
    try {
        const { name, message_text, has_media, media_type, media_path } = req.body;
        
        if (!name || !message_text) {
            return res.status(400).json({ error: 'Name and message_text are required' });
        }
        
        const template = await models.MessageTemplate.create({
            name,
            message_text,
            has_media: has_media || false,
            media_type: media_type || null,
            media_path: media_path || null
        });
        
        res.status(201).json({
            ...template.toJSON(),
            message: 'Template created successfully'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/templates/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, message_text, has_media, media_type, media_path } = req.body;
        
        if (!name || !message_text) {
            return res.status(400).json({ error: 'Name and message_text are required' });
        }
        
        const [updated] = await models.MessageTemplate.update(
            {
                name,
                message_text,
                has_media: has_media || false,
                media_type: media_type || null,
                media_path: media_path || null
            },
            { where: { id } }
        );
        
        if (updated === 0) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        res.json({ message: 'Template updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/templates/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const deleted = await models.MessageTemplate.destroy({ where: { id } });
        
        if (deleted === 0) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        res.json({ message: 'Template deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/contacts', async (req, res) => {
    try {
        const { group_name } = req.query;
        
        const whereClause = { is_active: true };
        if (group_name) {
            whereClause.group_name = group_name;
        }
        
        const contacts = await models.Contact.findAll({
            where: whereClause,
            order: [['created_at', 'DESC']]
        });
        
        res.json(contacts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/contacts/groups', async (req, res) => {
    try {
        const groups = await models.Contact.findAll({
            where: {
                is_active: true,
                group_name: { [Op.ne]: null }
            },
            attributes: [
                'group_name',
                [fn('COUNT', col('*')), 'contact_count']
            ],
            group: ['group_name'],
            order: [['group_name', 'ASC']],
            raw: true
        });
        
        res.json(groups);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/contacts', async (req, res) => {
    try {
        const { name, phone, group_name } = req.body;
        
        if (!name || !phone) {
            return res.status(400).json({ error: 'Name and phone are required' });
        }
        
        const cleanPhone = phone.replace(/\D/g, '');
        
        const contact = await models.Contact.create({
            name,
            phone: cleanPhone,
            group_name: group_name || null
        });
        
        res.status(201).json({
            ...contact.toJSON(),
            message: 'Contact added successfully'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/contacts/bulk', async (req, res) => {
    try {
        const { contacts } = req.body;
        
        if (!Array.isArray(contacts) || !contacts.length) {
            return res.status(400).json({ error: 'Contacts array is required' });
        }
        
        let successCount = 0;
        let errorCount = 0;
        const errors = [];
        
        for (const contact of contacts) {
            try {
                const { name, phone, group_name } = contact;
                
                if (!name || !phone) {
                    errors.push(`Contact missing name or phone: ${JSON.stringify(contact)}`);
                    errorCount++;
                    continue;
                }
                
                const cleanPhone = phone.toString().replace(/\D/g, '');
                
                await models.Contact.create({
                    name,
                    phone: cleanPhone,
                    group_name: group_name || null
                });
                
                successCount++;
                
            } catch (err) {
                errors.push(`Error adding contact ${contact.name}: ${err.message}`);
                errorCount++;
            }
        }
        
        res.json({
            message: 'Bulk import completed',
            success_count: successCount,
            error_count: errorCount,
            errors: errors.slice(0, 10)
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/contacts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, group_name, is_active } = req.body;
        
        if (!name || !phone) {
            return res.status(400).json({ error: 'Name and phone are required' });
        }
        
        const cleanPhone = phone.replace(/\D/g, '');
        
        const [updated] = await models.Contact.update(
            {
                name,
                phone: cleanPhone,
                group_name: group_name || null,
                is_active: is_active !== undefined ? is_active : true
            },
            { where: { id } }
        );
        
        if (updated === 0) {
            return res.status(404).json({ error: 'Contact not found' });
        }
        
        res.json({ message: 'Contact updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/contacts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const deleted = await models.Contact.destroy({ where: { id } });
        
        if (deleted === 0) {
            return res.status(404).json({ error: 'Contact not found' });
        }
        
        res.json({ message: 'Contact deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/send-bulk', async (req, res) => {
    try {
        const { fromAccountId, recipients, message, scheduledAt } = req.body;
        
        if (!fromAccountId || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ error: 'Invalid request data' });
        }
        
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        const phoneRegex = /^[0-9]{10,15}$/;
        const invalidNumbers = recipients.filter(num => !phoneRegex.test(num));
        if (invalidNumbers.length > 0) {
            return res.status(400).json({ 
                error: 'Invalid phone numbers',
                invalidNumbers: invalidNumbers
            });
        }
        
        const results = [];
        const whatsapp = require('../services/whatsapp');
        
        if (recipients.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 recipients per bulk send' });
        }
        
        for (const toNumber of recipients) {
            try {
                const result = await whatsapp.sendTextMessage(fromAccountId, toNumber, message);
                
                results.push({
                    toNumber: toNumber,
                    success: true,
                    messageId: result.key?.id
                });
                
            } catch (sendError) {
                console.error(`Error sending to ${toNumber}:`, sendError);
                results.push({
                    toNumber: toNumber,
                    success: false,
                    error: sendError.message
                });
            }
        }
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        res.json({
            message: `Bulk send completed: ${successful} successful, ${failed} failed`,
            successful: successful,
            failed: failed,
            results: results
        });
        
    } catch (error) {
        console.error('Bulk send error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/send-bulk-media', upload.single('media'), async (req, res) => {
    try {
        const { fromAccountId, recipients, message, scheduledAt } = req.body;
        const mediaFile = req.file;
        
        if (!fromAccountId || !recipients) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        let recipientList;
        try {
            recipientList = typeof recipients === 'string' ? JSON.parse(recipients) : recipients;
        } catch (e) {
            return res.status(400).json({ error: 'Invalid recipients format' });
        }
        
        if (!Array.isArray(recipientList) || recipientList.length === 0) {
            return res.status(400).json({ error: 'Recipients must be a non-empty array' });
        }
        
        const phoneRegex = /^[0-9]{10,15}$/;
        const invalidNumbers = recipientList.filter(num => !phoneRegex.test(num));
        if (invalidNumbers.length > 0) {
            return res.status(400).json({ 
                error: 'Invalid phone numbers',
                invalidNumbers: invalidNumbers
            });
        }
        
        if (recipientList.length > 50) {
            return res.status(400).json({ error: 'Maximum 50 recipients per bulk media send' });
        }
        
        if (!mediaFile && (!message || !message.trim())) {
            return res.status(400).json({ error: 'Either message or media is required' });
        }
        
        const results = [];
        const whatsapp = require('../services/whatsapp');
        
        for (const toNumber of recipientList) {
            try {
                let result;
                
                if (mediaFile) {
                    result = await whatsapp.sendMediaMessage(fromAccountId, toNumber, message || '', mediaFile);
                } else {
                    result = await whatsapp.sendTextMessage(fromAccountId, toNumber, message);
                }
                
                results.push({
                    toNumber: toNumber,
                    success: true,
                    messageId: result.key?.id
                });
                
            } catch (sendError) {
                console.error(`Error sending to ${toNumber}:`, sendError);
                results.push({
                    toNumber: toNumber,
                    success: false,
                    error: sendError.message
                });
            }
        }
        
        if (mediaFile && mediaFile.path) {
            try {
                await fs.unlink(mediaFile.path);
            } catch (cleanupError) {
                console.log('File cleanup warning:', cleanupError.message);
            }
        }
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        res.json({
            message: `Bulk media send completed: ${successful} successful, ${failed} failed`,
            successful: successful,
            failed: failed,
            results: results
        });
        
    } catch (error) {
        console.error('Bulk media send error:', error);
        
        if (req.file && req.file.path) {
            try {
                await fs.unlink(req.file.path);
            } catch (cleanupError) {
                console.log('File cleanup warning:', cleanupError.message);
            }
        }
        
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
