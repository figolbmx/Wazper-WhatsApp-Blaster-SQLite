const fs = require('fs-extra');
const path = require('path');
const models = require('../models');

async function setupDatabase() {
    try {
        console.log('🚀 Setting up Wazper database...');
        
        await models.sequelize.authenticate();
        console.log('✅ Database connected successfully');
        
        await models.sequelize.sync({ force: false });
        console.log('✅ Database tables created successfully!');
        
        const contactsCount = await models.Contact.count();
        if (contactsCount === 0) {
            console.log('📝 Inserting sample data...');
            
            await models.Contact.bulkCreate([
                { name: 'John Doe', phone: '6281234567890', group_name: 'Group A' },
                { name: 'Jane Smith', phone: '6289876543210', group_name: 'Group A' },
                { name: 'Bob Johnson', phone: '6285555123456', group_name: 'Group B' }
            ]);
            
            await models.MessageTemplate.bulkCreate([
                { name: 'Welcome Message', message_text: 'Halo {name}, selamat datang di layanan kami! 🎉' },
                { name: 'Promo Special', message_text: 'Hi {name}! Ada promo spesial hari ini, diskon 50% untuk semua produk! 💰' },
                { name: 'Reminder', message_text: 'Halo {name}, jangan lupa untuk check update terbaru dari kami ya! 📢' }
            ]);
            
            console.log('✅ Sample data inserted successfully!');
        }
        
        const directories = [
            'uploads/images',
            'uploads/documents',
            'uploads/audio',
            'uploads/video',
            'sessions'
        ];
        
        for (const dir of directories) {
            const fullPath = path.join(__dirname, '..', dir);
            await fs.ensureDir(fullPath);
            console.log(`📁 Created directory: ${dir}`);
        }
        
        console.log('🎉 Setup completed! You can now run: npm start');
        
    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        process.exit(1);
    } finally {
        await models.sequelize.close();
        console.log('Database connection closed');
        process.exit(0);
    }
}

if (require.main === module) {
    setupDatabase();
}

module.exports = setupDatabase;
