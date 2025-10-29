const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const CampaignMessage = sequelize.define('CampaignMessage', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        campaign_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'campaigns',
                key: 'id'
            }
        },
        contact_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'contacts',
                key: 'id'
            }
        },
        phone: {
            type: DataTypes.STRING(20),
            allowNull: false
        },
        message_text: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        media_path: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        media_type: {
            type: DataTypes.ENUM('image', 'document', 'video', 'audio'),
            allowNull: true
        },
        status: {
            type: DataTypes.ENUM('pending', 'sent', 'failed', 'delivered', 'read'),
            defaultValue: 'pending'
        },
        error_message: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        sent_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        delivered_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        read_at: {
            type: DataTypes.DATE,
            allowNull: true
        }
    }, {
        tableName: 'campaign_messages',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
        indexes: [
            { fields: ['campaign_id', 'status'] },
            { fields: ['phone'] }
        ]
    });

    CampaignMessage.associate = (models) => {
        CampaignMessage.belongsTo(models.Campaign, {
            foreignKey: 'campaign_id',
            as: 'campaign',
            onDelete: 'CASCADE'
        });
        CampaignMessage.belongsTo(models.Contact, {
            foreignKey: 'contact_id',
            as: 'contact',
            onDelete: 'CASCADE'
        });
    };

    return CampaignMessage;
};
