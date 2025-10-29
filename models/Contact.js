const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Contact = sequelize.define('Contact', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        phone: {
            type: DataTypes.STRING(20),
            allowNull: false
        },
        group_name: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        }
    }, {
        tableName: 'contacts',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
        indexes: [
            { fields: ['phone'] },
            { fields: ['group_name'] }
        ]
    });

    Contact.associate = (models) => {
        Contact.hasMany(models.CampaignMessage, {
            foreignKey: 'contact_id',
            as: 'campaign_messages',
            onDelete: 'CASCADE'
        });
    };

    return Contact;
};
