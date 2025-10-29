const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const models = require('../models');
const { sequelize } = models;
const { Op } = require('sequelize');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const fileType = getFileType(file.mimetype);
        const uploadDir = path.join(__dirname, '..', 'uploads', fileType);
        
        // Ensure directory exists
        fs.ensureDirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueId = uuidv4();
        const extension = path.extname(file.originalname).toLowerCase();
        cb(null, `${uniqueId}${extension}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 1
    },
    fileFilter: (req, file, cb) => {
        // Allow images, documents, videos, and audio
        const allowedMimes = [
            // Images
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            // Documents
            'application/pdf', 'application/msword', 
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain', 'text/csv',
            // Videos
            'video/mp4', 'video/quicktime', 'video/x-msvideo',
            // Audio
            'audio/mpeg', 'audio/wav', 'audio/ogg'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${file.mimetype} is not allowed`), false);
        }
    }
});

function getFileType(mimetype) {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    return 'document';
}

// Upload single file
router.post('/file', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const { originalname, filename, path: filePath, size, mimetype } = req.file;
        const fileType = getFileType(mimetype);
        
        // If it's an image, create thumbnail
        let thumbnailPath = null;
        if (fileType === 'image') {
            try {
                const thumbnailName = `thumb_${filename}`;
                thumbnailPath = path.join(path.dirname(filePath), thumbnailName);
                
                await sharp(filePath)
                    .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toFile(thumbnailPath);
            } catch (error) {
                console.warn('Failed to create thumbnail:', error.message);
            }
        }
        
        // Save to database using Sequelize
        const mediaFile = await models.MediaFile.create({
            original_name: originalname,
            filename: filename,
            file_path: filePath,
            file_size: size,
            mime_type: mimetype,
            file_type: fileType
        });
        
        res.status(201).json({
            id: mediaFile.id,
            original_name: mediaFile.original_name,
            filename: mediaFile.filename,
            file_path: `/uploads/${fileType}/${filename}`,
            thumbnail_path: thumbnailPath ? `/uploads/${fileType}/thumb_${filename}` : null,
            file_size: mediaFile.file_size,
            mime_type: mediaFile.mime_type,
            file_type: mediaFile.file_type,
            message: 'File uploaded successfully'
        });
        
    } catch (error) {
        // Clean up uploaded file if database save fails
        if (req.file && req.file.path) {
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.warn('Failed to clean up file:', unlinkError.message);
            }
        }
        
        res.status(500).json({ error: error.message });
    }
});

// Upload multiple files
router.post('/files', upload.array('files', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }
        
        const uploadedFiles = [];
        const errors = [];
        
        for (const file of req.files) {
            try {
                const { originalname, filename, path: filePath, size, mimetype } = file;
                const fileType = getFileType(mimetype);
                
                // Create thumbnail for images
                let thumbnailPath = null;
                if (fileType === 'image') {
                    try {
                        const thumbnailName = `thumb_${filename}`;
                        thumbnailPath = path.join(path.dirname(filePath), thumbnailName);
                        
                        await sharp(filePath)
                            .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
                            .jpeg({ quality: 80 })
                            .toFile(thumbnailPath);
                    } catch (error) {
                        console.warn('Failed to create thumbnail:', error.message);
                    }
                }
                
                // Save to database using Sequelize
                const mediaFile = await models.MediaFile.create({
                    original_name: originalname,
                    filename: filename,
                    file_path: filePath,
                    file_size: size,
                    mime_type: mimetype,
                    file_type: fileType
                });
                
                uploadedFiles.push({
                    id: mediaFile.id,
                    original_name: mediaFile.original_name,
                    filename: mediaFile.filename,
                    file_path: `/uploads/${fileType}/${filename}`,
                    thumbnail_path: thumbnailPath ? `/uploads/${fileType}/thumb_${filename}` : null,
                    file_size: mediaFile.file_size,
                    mime_type: mediaFile.mime_type,
                    file_type: mediaFile.file_type
                });
                
            } catch (error) {
                errors.push({
                    filename: file.originalname,
                    error: error.message
                });
                
                // Clean up file on error
                try {
                    await fs.unlink(file.path);
                } catch (unlinkError) {
                    console.warn('Failed to clean up file:', unlinkError.message);
                }
            }
        }
        
        res.status(201).json({
            uploaded_files: uploadedFiles,
            errors: errors,
            message: `${uploadedFiles.length} files uploaded successfully, ${errors.length} errors`
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all uploaded files with pagination
router.get('/files', async (req, res) => {
    try {
        const { file_type, limit = 20, offset = 0, search } = req.query;
        
        const whereClause = {};
        
        if (file_type) {
            whereClause.file_type = file_type;
        }
        
        if (search) {
            whereClause.original_name = {
                [Op.like]: `%${search}%`
            };
        }
        
        const files = await models.MediaFile.findAll({
            where: whereClause,
            order: [['uploaded_at', 'DESC']],
            limit: parseInt(limit),
            offset: parseInt(offset),
            raw: true
        });
        
        // Get total count
        const total = await models.MediaFile.count({
            where: whereClause
        });
        
        // Add full URL paths
        const filesWithUrls = files.map(file => ({
            ...file,
            file_url: `/uploads/${file.file_type}/${file.filename}`,
            thumbnail_url: file.file_type === 'image' ? `/uploads/${file.file_type}/thumb_${file.filename}` : null
        }));
        
        res.json({
            files: filesWithUrls,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get file by ID
router.get('/files/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const fileData = await models.MediaFile.findByPk(id, {
            raw: true
        });
        
        if (!fileData) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        res.json({
            ...fileData,
            file_url: `/uploads/${fileData.file_type}/${fileData.filename}`,
            thumbnail_url: fileData.file_type === 'image' ? `/uploads/${fileData.file_type}/thumb_${fileData.filename}` : null
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete file
router.delete('/files/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const fileData = await models.MediaFile.findByPk(id, {
            raw: true
        });
        
        if (!fileData) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Delete from database first
        await models.MediaFile.destroy({
            where: { id }
        });
        
        // Delete physical files
        try {
            await fs.unlink(fileData.file_path);
            
            // Delete thumbnail if exists
            if (fileData.file_type === 'image') {
                const thumbnailPath = path.join(
                    path.dirname(fileData.file_path), 
                    `thumb_${fileData.filename}`
                );
                
                if (await fs.pathExists(thumbnailPath)) {
                    await fs.unlink(thumbnailPath);
                }
            }
        } catch (unlinkError) {
            console.warn('Failed to delete physical file:', unlinkError.message);
        }
        
        res.json({ message: 'File deleted successfully' });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get file statistics
router.get('/stats', async (req, res) => {
    try {
        const stats = await models.MediaFile.findAll({
            attributes: [
                'file_type',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
                [sequelize.fn('SUM', sequelize.col('file_size')), 'total_size']
            ],
            group: ['file_type'],
            raw: true
        });
        
        const totalResult = await models.MediaFile.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
                [sequelize.fn('SUM', sequelize.col('file_size')), 'total_size']
            ],
            raw: true
        });
        
        res.json({
            by_type: stats,
            total: totalResult[0]
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Error handling middleware
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files. Maximum is 10 files.' });
        }
    }
    
    res.status(500).json({ error: error.message });
});

module.exports = router;