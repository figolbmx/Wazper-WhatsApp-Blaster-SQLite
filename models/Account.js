const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Account = sequelize.define('Account', {
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
            allowNull: true,
            unique: true
        },
        status: {
            type: DataTypes.ENUM('disconnected', 'connecting', 'connected', 'reconnecting', 'error'),
            defaultValue: 'disconnected'
        },
        qr_code: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        session_data: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        last_connected: {
            type: DataTypes.DATE,
            allowNull: true
        }
    }, {
        tableName: 'accounts',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    });

    Account.associate = (models) => {
        Account.hasMany(models.Campaign, {
            foreignKey: 'account_id',
            as: 'campaigns',
            onDelete: 'CASCADE'
        });
        Account.hasMany(models.ActivityLog, {
            foreignKey: 'account_id',
            as: 'activity_logs',
            onDelete: 'SET NULL'
        });
    };

    return Account;
};
