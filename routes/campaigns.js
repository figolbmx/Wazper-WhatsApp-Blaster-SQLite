const express = require('express');
const router = express.Router();
const models = require('../models');
const whatsappService = require('../services/whatsapp');
const { Op, fn, col, literal } = require('sequelize');

router.get('/', async (req, res) => {
    try {
        const { status } = req.query;
        
        const whereClause = status ? { status } : {};
        
        const campaigns = await models.Campaign.findAll({
            where: whereClause,
            include: [
                {
                    model: models.Account,
                    as: 'account',
                    attributes: ['name', 'phone', 'status']
                },
                {
                    model: models.MessageTemplate,
                    as: 'template',
                    attributes: ['name']
                }
            ],
            order: [['created_at', 'DESC']]
        });
        
        const formattedCampaigns = campaigns.map(c => {
            const campaign = c.toJSON();
            return {
                ...campaign,
                account_name: campaign.account?.name,
                account_phone: campaign.account?.phone,
                account_status: campaign.account?.status,
                template_name: campaign.template?.name
            };
        });
        
        res.json(formattedCampaigns);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const campaign = await models.Campaign.findByPk(id, {
            include: [
                {
                    model: models.Account,
                    as: 'account',
                    attributes: ['name', 'phone', 'status']
                },
                {
                    model: models.MessageTemplate,
                    as: 'template',
                    attributes: ['name', 'message_text', 'media_path']
                }
            ]
        });
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        const messageStats = await models.CampaignMessage.findAll({
            where: { campaign_id: id },
            attributes: [
                'status',
                [fn('COUNT', col('*')), 'count']
            ],
            group: ['status'],
            raw: true
        });
        
        const stats = {
            pending: 0,
            sent: 0,
            failed: 0,
            delivered: 0,
            read: 0
        };
        
        messageStats.forEach(stat => {
            stats[stat.status] = parseInt(stat.count);
        });
        
        const result = campaign.toJSON();
        res.json({
            ...result,
            account_name: result.account?.name,
            account_phone: result.account?.phone,
            account_status: result.account?.status,
            template_name: result.template?.name,
            message_text: result.template?.message_text,
            media_path: result.template?.media_path,
            message_stats: stats
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const { name, account_id, template_id, target_contacts, delay_seconds } = req.body;
        
        if (!name || !account_id || !template_id || !target_contacts || !Array.isArray(target_contacts)) {
            return res.status(400).json({ 
                error: 'Name, account_id, template_id, and target_contacts array are required' 
            });
        }
        
        const account = await models.Account.findOne({
            where: { id: account_id, status: 'connected' }
        });
        
        if (!account) {
            return res.status(400).json({ error: 'Account not found or not connected' });
        }
        
        const template = await models.MessageTemplate.findByPk(template_id);
        
        if (!template) {
            return res.status(400).json({ error: 'Template not found' });
        }
        
        const result = await models.sequelize.transaction(async (t) => {
            const campaign = await models.Campaign.create({
                name,
                account_id,
                template_id,
                total_targets: target_contacts.length,
                delay_seconds: delay_seconds || 5
            }, { transaction: t });
            
            for (const contactId of target_contacts) {
                const contact = await models.Contact.findOne({
                    where: { id: contactId, is_active: true },
                    transaction: t
                });
                
                if (contact) {
                    let personalizedMessage = template.message_text;
                    personalizedMessage = personalizedMessage.replace(/{name}/g, contact.name);
                    personalizedMessage = personalizedMessage.replace(/{phone}/g, contact.phone);
                    
                    await models.CampaignMessage.create({
                        campaign_id: campaign.id,
                        contact_id: contact.id,
                        phone: contact.phone,
                        message_text: personalizedMessage,
                        media_path: template.media_path
                    }, { transaction: t });
                }
            }
            
            return campaign;
        });
        
        res.status(201).json({
            id: result.id,
            name,
            message: 'Campaign created successfully'
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/start', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [updated] = await models.Campaign.update(
            { status: 'running', started_at: new Date() },
            { where: { id, status: 'draft' } }
        );
        
        if (updated === 0) {
            return res.status(400).json({ error: 'Campaign not found or already started' });
        }
        
        setTimeout(async () => {
            try {
                await whatsappService.sendBulkMessages(id);
            } catch (error) {
                console.error('Error in bulk message sending:', error);
            }
        }, 1000);
        
        res.json({ message: 'Campaign started successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/pause', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [updated] = await models.Campaign.update(
            { status: 'paused' },
            { where: { id, status: 'running' } }
        );
        
        if (updated === 0) {
            return res.status(400).json({ error: 'Campaign not found or not running' });
        }
        
        res.json({ message: 'Campaign paused successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/resume', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [updated] = await models.Campaign.update(
            { status: 'running' },
            { where: { id, status: 'paused' } }
        );
        
        if (updated === 0) {
            return res.status(400).json({ error: 'Campaign not found or not paused' });
        }
        
        setTimeout(async () => {
            try {
                await whatsappService.sendBulkMessages(id);
            } catch (error) {
                console.error('Error resuming bulk messages:', error);
            }
        }, 1000);
        
        res.json({ message: 'Campaign resumed successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/cancel', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [updated] = await models.Campaign.update(
            { status: 'cancelled' },
            { where: { id, status: { [Op.in]: ['running', 'paused', 'draft'] } } }
        );
        
        if (updated === 0) {
            return res.status(400).json({ error: 'Campaign not found or already completed' });
        }
        
        res.json({ message: 'Campaign cancelled successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id/messages', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, limit = 50, offset = 0 } = req.query;
        
        const whereClause = { campaign_id: id };
        if (status) {
            whereClause.status = status;
        }
        
        const messages = await models.CampaignMessage.findAll({
            where: whereClause,
            include: [
                {
                    model: models.Contact,
                    as: 'contact',
                    attributes: ['name']
                }
            ],
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
        
        const total = await models.CampaignMessage.count({ where: whereClause });
        
        const formattedMessages = messages.map(m => {
            const msg = m.toJSON();
            return {
                ...msg,
                contact_name: msg.contact?.name
            };
        });
        
        res.json({
            messages: formattedMessages,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const deleted = await models.Campaign.destroy({
            where: { 
                id, 
                status: { [Op.ne]: 'running' } 
            }
        });
        
        if (deleted === 0) {
            return res.status(400).json({ 
                error: 'Campaign not found or is currently running. Please stop the campaign first.' 
            });
        }
        
        res.json({ message: 'Campaign deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
