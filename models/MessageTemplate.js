const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const MessageTemplate = sequelize.define('MessageTemplate', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        message_text: {
            type: DataTypes.TEXT,
            allowNull: false
        },
        has_media: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        media_type: {
            type: DataTypes.ENUM('image', 'document', 'video', 'audio'),
            allowNull: true
        },
        media_path: {
            type: DataTypes.STRING(255),
            allowNull: true
        }
    }, {
        tableName: 'message_templates',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    });

    MessageTemplate.associate = (models) => {
        MessageTemplate.hasMany(models.Campaign, {
            foreignKey: 'template_id',
            as: 'campaigns',
            onDelete: 'CASCADE'
        });
    };

    return MessageTemplate;
};
