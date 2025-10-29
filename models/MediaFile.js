const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const MediaFile = sequelize.define('MediaFile', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        original_name: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        filename: {
            type: DataTypes.STRING(255),
            allowNull: false,
            unique: true
        },
        file_path: {
            type: DataTypes.STRING(500),
            allowNull: false
        },
        file_size: {
            type: DataTypes.BIGINT,
            allowNull: false
        },
        mime_type: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        file_type: {
            type: DataTypes.ENUM('image', 'document', 'video', 'audio'),
            allowNull: false
        }
    }, {
        tableName: 'media_files',
        timestamps: true,
        createdAt: 'uploaded_at',
        updatedAt: false,
        indexes: [
            { fields: ['file_type'] }
        ]
    });

    return MediaFile;
};
