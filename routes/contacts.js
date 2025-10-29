const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const models = require('../models');

const upload = multer({ dest: 'uploads/temp/' });

router.get('/', async (req, res) => {
    try {
        const { group, search, page = 1, limit = 50 } = req.query;
        
        const where = {};
        
        if (group && group !== 'all') {
            where.group_name = group;
        }
        
        if (search) {
            const { Op } = require('sequelize');
            where[Op.or] = [
                { name: { [Op.like]: `%${search}%` } },
                { phone: { [Op.like]: `%${search}%` } }
            ];
        }
        
        const offset = (page - 1) * limit;
        
        const { count, rows: contacts } = await models.Contact.findAndCountAll({
            where,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['created_at', 'DESC']]
        });
        
        res.json({
            success: true,
            contacts,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/groups', async (req, res) => {
    try {
        const { Op } = require('sequelize');
        const groups = await models.Contact.findAll({
            attributes: [
                'group_name',
                [models.sequelize.fn('COUNT', models.sequelize.col('id')), 'count']
            ],
            where: {
                group_name: {
                    [Op.ne]: null
                }
            },
            group: ['group_name'],
            raw: true
        });
        
        res.json({ success: true, groups });
    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/stats', async (req, res) => {
    try {
        const { Op } = require('sequelize');
        const totalContacts = await models.Contact.count();
        const activeContacts = await models.Contact.count({ where: { is_active: true } });
        
        const groupsCount = await models.Contact.count({
            distinct: true,
            col: 'group_name',
            where: {
                group_name: {
                    [Op.ne]: null
                }
            }
        });
        
        res.json({
            success: true,
            stats: {
                total: totalContacts,
                active: activeContacts,
                inactive: totalContacts - activeContacts,
                groups: groupsCount
            }
        });
    } catch (error) {
        console.error('Error fetching contact stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const { name, phone, group_name, is_active = true } = req.body;
        
        if (!name || !phone) {
            return res.status(400).json({ 
                success: false, 
                error: 'Name and phone are required' 
            });
        }
        
        const cleanPhone = phone.replace(/[^0-9]/g, '');
        
        if (cleanPhone.length < 10) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid phone number format' 
            });
        }
        
        const existingContact = await models.Contact.findOne({
            where: { phone: cleanPhone }
        });
        
        if (existingContact) {
            return res.status(400).json({ 
                success: false, 
                error: 'Contact with this phone number already exists' 
            });
        }
        
        const contact = await models.Contact.create({
            name: name.trim(),
            phone: cleanPhone,
            group_name: group_name ? group_name.trim() : null,
            is_active
        });
        
        res.json({ success: true, contact });
    } catch (error) {
        console.error('Error creating contact:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/bulk/delete', async (req, res) => {
    try {
        const { ids } = req.body;
        
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'No contact IDs provided' 
            });
        }
        
        const deleted = await models.Contact.destroy({
            where: {
                id: ids
            }
        });
        
        res.json({ 
            success: true, 
            message: `${deleted} contact(s) deleted successfully`,
            deleted
        });
    } catch (error) {
        console.error('Error bulk deleting contacts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, group_name, is_active } = req.body;
        
        const contact = await models.Contact.findByPk(id);
        
        if (!contact) {
            return res.status(404).json({ 
                success: false, 
                error: 'Contact not found' 
            });
        }
        
        const updateData = {};
        
        if (name) updateData.name = name.trim();
        
        if (phone) {
            const cleanPhone = phone.replace(/[^0-9]/g, '');
            
            if (cleanPhone.length < 10) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Invalid phone number format' 
                });
            }
            
            const existingContact = await models.Contact.findOne({
                where: { 
                    phone: cleanPhone,
                    id: { [models.sequelize.Op.ne]: id }
                }
            });
            
            if (existingContact) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Contact with this phone number already exists' 
                });
            }
            
            updateData.phone = cleanPhone;
        }
        
        if (group_name !== undefined) updateData.group_name = group_name ? group_name.trim() : null;
        if (is_active !== undefined) updateData.is_active = is_active;
        
        await contact.update(updateData);
        
        res.json({ success: true, contact });
    } catch (error) {
        console.error('Error updating contact:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const contact = await models.Contact.findByPk(id);
        
        if (!contact) {
            return res.status(404).json({ 
                success: false, 
                error: 'Contact not found' 
            });
        }
        
        await contact.destroy();
        
        res.json({ success: true, message: 'Contact deleted successfully' });
    } catch (error) {
        console.error('Error deleting contact:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/import/csv', upload.single('csvFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                error: 'No CSV file uploaded' 
            });
        }
        
        const filePath = req.file.path;
        const fileContent = await fs.readFile(filePath, 'utf-8');
        
        await fs.remove(filePath);
        
        const lines = fileContent.split('\n').filter(line => line.trim());
        
        if (lines.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'CSV file is empty' 
            });
        }
        
        const header = lines[0].toLowerCase();
        const hasHeader = header.includes('name') || header.includes('phone') || header.includes('nama') || header.includes('nomor');
        
        const dataLines = hasHeader ? lines.slice(1) : lines;
        
        const results = {
            success: 0,
            failed: 0,
            duplicate: 0,
            errors: []
        };
        
        for (let i = 0; i < dataLines.length; i++) {
            const line = dataLines[i].trim();
            if (!line) continue;
            
            const parts = line.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
            
            if (parts.length < 2) {
                results.failed++;
                results.errors.push(`Line ${i + 1}: Invalid format (needs at least name and phone)`);
                continue;
            }
            
            const [name, phone, group_name] = parts;
            
            const cleanPhone = phone.replace(/[^0-9]/g, '');
            
            if (!name || cleanPhone.length < 10) {
                results.failed++;
                results.errors.push(`Line ${i + 1}: Invalid name or phone number`);
                continue;
            }
            
            try {
                const existingContact = await models.Contact.findOne({
                    where: { phone: cleanPhone }
                });
                
                if (existingContact) {
                    results.duplicate++;
                    continue;
                }
                
                await models.Contact.create({
                    name: name.trim(),
                    phone: cleanPhone,
                    group_name: group_name ? group_name.trim() : null,
                    is_active: true
                });
                
                results.success++;
            } catch (error) {
                results.failed++;
                results.errors.push(`Line ${i + 1}: ${error.message}`);
            }
        }
        
        res.json({ 
            success: true, 
            message: `Import completed: ${results.success} added, ${results.duplicate} duplicates, ${results.failed} failed`,
            results 
        });
    } catch (error) {
        console.error('Error importing CSV:', error);
        
        if (req.file && req.file.path) {
            await fs.remove(req.file.path).catch(() => {});
        }
        
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/export/csv', async (req, res) => {
    try {
        const { group } = req.query;
        
        const where = {};
        if (group && group !== 'all') {
            where.group_name = group;
        }
        
        const contacts = await models.Contact.findAll({
            where,
            order: [['name', 'ASC']]
        });
        
        let csv = 'Name,Phone,Group,Active\n';
        
        contacts.forEach(contact => {
            const name = `"${contact.name.replace(/"/g, '""')}"`;
            const phone = contact.phone;
            const group = contact.group_name ? `"${contact.group_name.replace(/"/g, '""')}"` : '';
            const active = contact.is_active ? 'Yes' : 'No';
            
            csv += `${name},${phone},${group},${active}\n`;
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="contacts_${Date.now()}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Error exporting contacts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
