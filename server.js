const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs-extra');
const models = require('./models');
const whatsappService = require('./services/whatsapp');

const accountRoutes = require('./routes/accounts');
const messageRoutes = require('./routes/messages');
const campaignRoutes = require('./routes/campaigns');
const uploadRoutes = require('./routes/uploads');

const app = express();

const PORT = process.env.PORT || 5000;

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'wazper-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/accounts', accountRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/uploads', uploadRoutes);

// Default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check route
app.get('/api/status', async (req, res) => {
    try {
        const totalAccounts = await models.Account.count();
        const connectedAccounts = await models.Account.count({ where: { status: 'connected' } });
        const activeCampaigns = await models.Campaign.count({ where: { status: 'running' } });

        res.json({
            status: 'ok',
            uptime: process.uptime(),
            accounts: { total: totalAccounts, connected: connectedAccounts },
            campaigns: { active: activeCampaigns }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({ error: 'Something went wrong!', message: err.message });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', message: 'The requested resource was not found' });
});

// Graceful shutdown (optional for local dev)
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down server...');
    try {
        await whatsappService.disconnectAll();
        await models.sequelize.close();
        console.log('✅ Database connection closed');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
});

// Initialize resources (database + WhatsApp)
async function initializeApp() {
    try {
        await models.sequelize.authenticate();
        console.log('✅ Database connected');

        await models.sequelize.sync();
        console.log('✅ Database tables synchronized');

        const uploadDirs = ['uploads/images', 'uploads/documents', 'uploads/audio', 'uploads/video'];
        for (const dir of uploadDirs) await fs.ensureDir(dir);

        await whatsappService.initialize();
        console.log('✅ WhatsApp service initialized');
    } catch (error) {
        console.error('❌ Initialization failed:', error);
    }
}

// Start initialization (on import)
initializeApp();

// Start server
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    });
}

// Export the Express app for serverless environments
module.exports = app;
