const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Campaign = sequelize.define('Campaign', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        account_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'accounts',
                key: 'id'
            }
        },
        template_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'message_templates',
                key: 'id'
            }
        },
        total_targets: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        sent_count: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        failed_count: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        status: {
            type: DataTypes.ENUM('draft', 'running', 'completed', 'paused', 'cancelled'),
            defaultValue: 'draft'
        },
        delay_seconds: {
            type: DataTypes.INTEGER,
            defaultValue: 5
        },
        started_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        completed_at: {
            type: DataTypes.DATE,
            allowNull: true
        }
    }, {
        tableName: 'campaigns',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false
    });

    Campaign.associate = (models) => {
        Campaign.belongsTo(models.Account, {
            foreignKey: 'account_id',
            as: 'account',
            onDelete: 'CASCADE'
        });
        Campaign.belongsTo(models.MessageTemplate, {
            foreignKey: 'template_id',
            as: 'template',
            onDelete: 'CASCADE'
        });
        Campaign.hasMany(models.CampaignMessage, {
            foreignKey: 'campaign_id',
            as: 'messages',
            onDelete: 'CASCADE'
        });
    };

    return Campaign;
};
