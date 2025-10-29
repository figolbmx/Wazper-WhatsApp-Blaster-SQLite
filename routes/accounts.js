const express = require('express');
const router = express.Router();
const models = require('../models');
const whatsappService = require('../services/whatsapp');
const { Op } = require('sequelize');

router.get('/', async (req, res) => {
    try {
        const accounts = await models.Account.findAll({
            attributes: ['id', 'name', 'phone', 'status', 'qr_code', 'created_at', 'updated_at', 'last_connected'],
            order: [['created_at', 'DESC']]
        });
        
        res.json(accounts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const account = await models.Account.findByPk(id, {
            attributes: ['id', 'name', 'phone', 'status', 'qr_code', 'created_at', 'updated_at', 'last_connected']
        });
        
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        res.json(account);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const { name, phone } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }
        
        if (phone) {
            const existingAccount = await models.Account.findOne({ where: { phone } });
            
            if (existingAccount) {
                return res.status(400).json({ error: 'Phone number already exists' });
            }
        }
        
        const account = await models.Account.create({
            name,
            phone,
            status: 'disconnected'
        });
        
        await models.ActivityLog.create({
            account_id: account.id,
            action: 'created',
            description: 'Account created'
        });
        
        res.status(201).json({
            ...account.toJSON(),
            message: 'Account created successfully'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/connect', async (req, res) => {
    try {
        const { id } = req.params;
        
        const account = await models.Account.findByPk(id);
        
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        await whatsappService.connectAccount(id);
        
        res.json({ message: 'Connection initiated. Please scan QR code.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/fresh-connect', async (req, res) => {
    try {
        const { id } = req.params;
        
        const account = await models.Account.findByPk(id);
        
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        console.log(`🔄 Fresh reconnect initiated for account ${id}`);
        
        await whatsappService.disconnectAccount(id);
        
        await account.update({
            status: 'connecting',
            qr_code: null,
            last_connected: null
        });
        
        await models.ActivityLog.create({
            account_id: id,
            action: 'fresh_reconnect',
            description: 'Fresh reconnection initiated - starting new session'
        });
        
        setTimeout(async () => {
            try {
                await whatsappService.connectAccount(id);
                console.log(`✅ Fresh connection started for account ${id}`);
            } catch (connectError) {
                console.error(`❌ Fresh connection failed for account ${id}:`, connectError);
            }
        }, 1000);
        
        res.json({ 
            success: true,
            message: 'Fresh connection initiated. QR code will be generated shortly.' 
        });
        
    } catch (error) {
        console.error('Fresh reconnect error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/force-reconnect', async (req, res) => {
    try {
        const { id } = req.params;
        
        const account = await models.Account.findByPk(id);
        
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        await models.ActivityLog.create({
            account_id: id,
            action: 'force_reconnect',
            description: 'Force reconnection initiated - generating new QR code'
        });
        
        await whatsappService.forceReconnectAccount(id);
        
        res.json({ 
            message: 'Force reconnection initiated. New QR code will be generated.',
            note: 'All session files have been cleared for fresh authentication.'
        });
    } catch (error) {
        console.error('Force reconnect error:', error);
        res.status(500).json({ 
            error: 'Force reconnection failed',
            message: error.message 
        });
    }
});

router.post('/:id/disconnect', async (req, res) => {
    try {
        const { id } = req.params;
        
        await whatsappService.disconnectAccount(id);
        
        res.json({ message: 'Account disconnected successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone } = req.body;
        
        if (!name || !phone) {
            return res.status(400).json({ error: 'Name and phone are required' });
        }
        
        const account = await models.Account.findByPk(id);
        
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        await account.update({ name, phone });
        
        await models.ActivityLog.create({
            account_id: id,
            action: 'updated',
            description: `Account details updated to ${name} - ${phone}`
        });
        
        res.json({ message: 'Account updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        try {
            await whatsappService.disconnectAccount(id);
        } catch (err) {
            console.warn('Error disconnecting account during deletion:', err.message);
        }
        
        const account = await models.Account.findByPk(id);
        
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        
        await account.destroy();
        
        res.json({ message: 'Account deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id/logs', async (req, res) => {
    try {
        const { id } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        
        const logs = await models.ActivityLog.findAll({
            where: { account_id: id },
            order: [['created_at', 'DESC']],
            limit,
            offset
        });
        
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
