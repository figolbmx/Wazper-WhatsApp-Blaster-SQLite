const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const ActivityLog = sequelize.define('ActivityLog', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        account_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'accounts',
                key: 'id'
            }
        },
        action: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        ip_address: {
            type: DataTypes.STRING(45),
            allowNull: true
        }
    }, {
        tableName: 'activity_logs',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
        indexes: [
            { fields: ['account_id', 'created_at'] }
        ]
    });

    ActivityLog.associate = (models) => {
        ActivityLog.belongsTo(models.Account, {
            foreignKey: 'account_id',
            as: 'account',
            onDelete: 'SET NULL'
        });
    };

    return ActivityLog;
};
