const { 
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    delay,
    generateWAMessageFromContent,
    proto
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const QRCode = require('qrcode');
const models = require('../models');
const { Op } = require('sequelize');

class WhatsAppService {
    constructor() {
        this.sessions = new Map();
        this.stores = new Map();
        this.logger = pino({ level: 'warn' });
        this.retryCount = new Map();
        this.connectionAttempts = new Map();
        this.lastConnectionTime = new Map();
        
        // Rate limiting: max 1 connection attempt per 30 seconds per account
        this.CONNECTION_COOLDOWN = 30000; // 30 seconds
    }

    async initialize() {
        try {
            // Ensure sessions directory exists
            await fs.ensureDir('./sessions');
            
            // Load existing accounts from database with better error handling
            try {
                const accounts = await models.Account.findAll({
                    where: {
                        status: {
                            [Op.ne]: 'disconnected'
                        }
                    }
                });
                
                console.log(`🔄 Auto-connecting ${accounts.length} accounts...`);
                
                // Connect accounts one by one with individual error handling
                for (const account of accounts) {
                    try {
                        console.log(`🔌 Attempting to connect account ${account.id} (${account.name})...`);
                        await this.connectAccount(account.id);
                        console.log(`✅ Account ${account.id} connected successfully`);
                    } catch (accountError) {
                        console.error(`❌ Failed to connect account ${account.id}:`, accountError.message);
                        // Update account status to error but don't crash the whole service
                        try {
                            await models.Account.update(
                                { status: 'error' },
                                { where: { id: account.id } }
                            );
                        } catch (dbError) {
                            console.error('Failed to update account status:', dbError);
                        }
                    }
                }
            } catch (dbError) {
                console.error('❌ Failed to load accounts from database:', dbError.message);
            }
            
            console.log('✅ WhatsApp service initialized (Auto-connection mode)');
        } catch (error) {
            console.error('❌ Failed to initialize WhatsApp service:', error);
            // Don't throw error to prevent server crash
            console.log('⚠️ WhatsApp service started with limited functionality');
        }
    }

    async connectAccount(accountId) {
        try {
            // Rate limiting check
            const lastAttempt = this.lastConnectionTime.get(accountId);
            const now = Date.now();
            
            if (lastAttempt && (now - lastAttempt) < this.CONNECTION_COOLDOWN) {
                const remainingTime = Math.ceil((this.CONNECTION_COOLDOWN - (now - lastAttempt)) / 1000);
                throw new Error(`Rate limited: Wait ${remainingTime}s before reconnecting account ${accountId}`);
            }
            
            this.lastConnectionTime.set(accountId, now);
            
            const accountData = await models.Account.findByPk(accountId);
            
            if (!accountData) {
                throw new Error('Account not found');
            }

            const sessionPath = path.join('./sessions', `session_${accountId}`);
            
            // Ensure session directory exists
            await fs.ensureDir(sessionPath);
            
            // Initialize auth state with multi-file
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

            const sock = makeWASocket({
                logger: this.logger,
                auth: state,
                printQRInTerminal: false,
                browser: ['Wazper', 'Chrome', '1.0.0'],
                // Connection stability settings
                keepAliveIntervalMs: 30000, // Keep-alive setiap 30 detik
                connectTimeoutMs: 60000,    // Timeout connection 60 detik
                defaultQueryTimeoutMs: 60000, // Query timeout 60 detik
                // Retry settings
                retryRequestDelayMs: 250,   // Delay retry request
                maxMsgRetryCount: 3,        // Maksimal retry message
                // Browser settings untuk stabilitas
                markOnlineOnConnect: false,  // Jangan set online otomatis
                syncFullHistory: false,      // Jangan sync history penuh (menghemat bandwidth)
                // Connection options
                options: {
                    keepAlive: true,
                    timeout: 60000
                }
            });

            // Event handlers
            sock.ev.on('connection.update', async (update) => {
                await this.handleConnectionUpdate(accountId, accountData, update, sock);
            });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('messages.upsert', async (m) => {
                // Handle incoming messages if needed
                console.log('New messages:', m.messages);
            });

            this.sessions.set(accountId, sock);
            
            // Update account status
            await models.Account.update(
                { status: 'connecting' },
                { where: { id: accountId } }
            );

            return sock;
            
        } catch (error) {
            console.error(`Failed to connect account ${accountId}:`, error);
            
            // Update account status to error
            try {
                await models.Account.update(
                    { status: 'error' },
                    { where: { id: accountId } }
                );
            } catch (dbError) {
                console.error('Failed to update account status:', dbError);
            }
            
            throw error;
        }
    }

    async handleConnectionUpdate(accountId, accountData, update, sock) {
        const { connection, lastDisconnect, qr } = update;
        
        try {
            if (qr) {
                // Generate QR code
                const qrDataURL = await QRCode.toDataURL(qr);
                
                // Save QR to database
                await models.Account.update(
                    { qr_code: qrDataURL, status: 'connecting' },
                    { where: { id: accountId } }
                );
                
                console.log(`QR Code generated for account ${accountId}`);
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMessage = lastDisconnect?.error?.message || 'Unknown error';
                
                // Clean up current session
                this.sessions.delete(accountId);
                
                // Determine if we should reconnect based on error type
                const shouldReconnect = this.shouldAttemptReconnect(statusCode, errorMessage);
                
                if (shouldReconnect) {
                    console.log(`📱 Account ${accountId} disconnected. Reason: ${this.getDisconnectReasonText(statusCode)} - ${errorMessage}`);
                    
                    // Only schedule reconnect if not due to rate limiting or permanent errors
                    if (!this.isPermanentError(statusCode)) {
                        await this.scheduleReconnect(accountId, statusCode);
                    } else {
                        console.log(`❌ Permanent error detected for account ${accountId}. Manual intervention required.`);
                        await models.Account.update(
                            { status: 'error', qr_code: null },
                            { where: { id: accountId } }
                        );
                    }
                } else {
                    console.log(`Account ${accountId} logged out properly`);
                    await models.Account.update(
                        { status: 'disconnected', qr_code: null },
                        { where: { id: accountId } }
                    );
                    // Clean up retry tracking
                    this.retryCount.delete(accountId);
                    this.lastConnectionTime.delete(accountId);
                }
            } else if (connection === 'open') {
                console.log(`Account ${accountId} connected successfully`);
                
                // Get current account data from database
                const currentAccount = await models.Account.findByPk(accountId, {
                    attributes: ['phone', 'name']
                });
                
                // Get user info from WhatsApp
                let detectedPhone = null;
                let accountName = currentAccount?.name || `device-${accountId}`;
                let phoneChanged = false;
                
                try {
                    // Try to get user info
                    const user = sock.user;
                    if (user && user.id) {
                        // Extract phone number from user ID (format: number:device@s.whatsapp.net)
                        const fullId = user.id.split('@')[0]; // Get part before @
                        detectedPhone = fullId.split(':')[0]; // Remove device ID part (:XX)
                        console.log(`📱 Detected phone number: ${detectedPhone}`);
                        
                        // Check if phone number changed
                        const currentPhone = currentAccount?.phone;
                        if (currentPhone && currentPhone !== detectedPhone) {
                            phoneChanged = true;
                            console.log(`📞 Phone number changed from ${currentPhone} to ${detectedPhone}`);
                        }
                    }
                } catch (infoError) {
                    console.log('Could not detect phone number automatically');
                }
                
                // Update account with detected info
                await models.Account.update(
                    { 
                        name: accountName, 
                        phone: detectedPhone, 
                        status: 'connected', 
                        qr_code: null, 
                        last_connected: new Date() 
                    },
                    { where: { id: accountId } }
                );

                // Log connection activity
                const logDescription = phoneChanged 
                    ? `Account reconnected with new phone number: ${detectedPhone} (previously: ${currentAccount?.phone})` 
                    : `Account connected successfully${detectedPhone ? ' - Phone: ' + detectedPhone : ''}`;
                    
                await models.ActivityLog.create({
                    account_id: accountId,
                    action: phoneChanged ? 'phone_updated' : 'connected',
                    description: logDescription
                });
            }
            
        } catch (error) {
            console.error(`Error handling connection update for account ${accountId}:`, error);
            
            await models.Account.update(
                { status: 'error' },
                { where: { id: accountId } }
            );
        }
    }

    async disconnectAccount(accountId) {
        try {
            const sock = this.sessions.get(accountId);
            
            if (sock) {
                await sock.logout();
                this.sessions.delete(accountId);
            }
            
            // Remove store if exists
            if (this.stores && this.stores.has(accountId)) {
                this.stores.delete(accountId);
            }
            
            // Update database
            await models.Account.update(
                { status: 'disconnected', qr_code: null },
                { where: { id: accountId } }
            );
            
            console.log(`Account ${accountId} disconnected`);
            
        } catch (error) {
            console.error(`Error disconnecting account ${accountId}:`, error);
            throw error;
        }
    }

    async sendMessage(accountId, phone, message, mediaPath = null, mimeType = null, originalName = null) {
        try {
            // Convert accountId to string to match session keys (sessions are stored as strings)
            const stringAccountId = String(accountId);
            
            // DEBUG: Check sessions
            const numericAccountId = parseInt(accountId);
            console.log(`🔍 Session debug:`);
            console.log(`  - Raw accountId: "${accountId}" (type: ${typeof accountId})`);
            console.log(`  - String accountId: "${stringAccountId}"`);
            console.log(`  - Numeric accountId: ${numericAccountId}`);
            console.log(`  - Available session keys:`, Array.from(this.sessions.keys()));
            
            // Try numeric key first (sessions are stored as numeric)
            let sock = this.sessions.get(numericAccountId);
            console.log(`  - Numeric key ${numericAccountId}:`, !!sock);
            
            // Fallback: try string key
            if (!sock) {
                sock = this.sessions.get(stringAccountId);
                console.log(`  - String key "${stringAccountId}":`, !!sock);
            }
            
            if (!sock) {
                console.log(`❌ No session found. Available:`, Array.from(this.sessions.keys()));
                throw new Error('Account not connected');
            }
            
            // Debug socket properties
            console.log(`🔍 Socket properties:`, Object.keys(sock));
            console.log(`🔍 Socket state:`, sock.state || 'unknown');
            console.log(`🔍 Socket user:`, sock.user ? 'present' : 'missing');
            
            // Check if socket has essential properties instead of ws.readyState
            if (!sock.user && !sock.authState) {
                console.log(`⚠️ Socket missing authentication, might not be ready`);
                // Don't throw error, let it try to send and fail naturally
            }
            
            console.log(`✅ Proceeding with message send attempt...`);

            // Format phone number
            const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
            
            // DEBUG: Log all parameters
            console.log(`🔍 sendMessage called with:`);
            console.log(`  - accountId: ${accountId}`);
            console.log(`  - phone: ${phone}`);
            console.log(`  - message: "${message}"`);
            console.log(`  - mediaPath: "${mediaPath}"`);
            console.log(`  - mimeType: "${mimeType}"`);
            console.log(`  - mediaPath type: ${typeof mediaPath}`);
            console.log(`  - mediaPath boolean: ${!!mediaPath}`);
            
            let messageContent = { text: message };
            
            if (mediaPath) {
                console.log(`📂 Processing media file: ${mediaPath}`);
                
                // Check if file exists
                try {
                    const fileStats = await fs.stat(mediaPath);
                    console.log(`📊 File stats - Size: ${fileStats.size} bytes, isFile: ${fileStats.isFile()}`);
                } catch (statError) {
                    console.error(`❌ File stat error: ${statError.message}`);
                    throw new Error(`Media file not found: ${mediaPath}`);
                }
                
                // Read file
                let mediaBuffer;
                try {
                    mediaBuffer = await fs.readFile(mediaPath);
                    console.log(`📦 Media buffer loaded - Size: ${mediaBuffer.length} bytes`);
                } catch (readError) {
                    console.error(`❌ File read error: ${readError.message}`);
                    throw new Error(`Failed to read media file: ${readError.message}`);
                }
                
                // Use provided mimeType or detect from path
                const finalMimeType = mimeType || this.getMimeType(mediaPath);
                console.log(`🏷️ Using MIME type: ${finalMimeType}`);
                
                // Use standard Baileys format based on official documentation
                console.log(`🔄 Using standard Baileys media format`);
                
                if (finalMimeType.startsWith('image/')) {
                    console.log(`🖼️ Preparing image message (buffer format)`);
                    messageContent = {
                        image: mediaBuffer
                    };
                    if (message && message.trim()) {
                        messageContent.caption = message.trim();
                    }
                    
                } else if (finalMimeType.startsWith('video/')) {
                    console.log(`🎥 Preparing video message (buffer format)`);
                    messageContent = {
                        video: mediaBuffer
                    };
                    if (message && message.trim()) {
                        messageContent.caption = message.trim();
                    }
                    
                } else if (finalMimeType.startsWith('audio/')) {
                    console.log(`🎵 Preparing audio message (buffer format)`);
                    messageContent = {
                        audio: mediaBuffer,
                        mimetype: finalMimeType,
                        ptt: false
                    };
                    
                } else {
                    console.log(`📄 Preparing document message (buffer format)`);
                    
                    // Use original filename if available, otherwise use path basename
                    const fileName = originalName || path.basename(mediaPath);
                    console.log(`📄 Using filename: "${fileName}"`);
                    
                    messageContent = {
                        document: mediaBuffer,
                        mimetype: finalMimeType,
                        fileName: fileName
                    };
                    if (message && message.trim()) {
                        messageContent.caption = message.trim();
                    }
                }
                
                console.log(`📋 Final message content structure:`, {
                    type: Object.keys(messageContent)[0],
                    hasCaption: !!messageContent.caption,
                    bufferSize: mediaBuffer.length
                });
            }

            console.log(`🚀 Sending message to WhatsApp...`);
            console.log(`📱 JID: ${jid}`);
            console.log(`📝 Message content keys:`, Object.keys(messageContent));
            
            // Additional debug for media messages
            if (messageContent.image) {
                console.log(`🖼️ Image buffer size: ${messageContent.image.length} bytes`);
            } else if (messageContent.video) {
                console.log(`🎥 Video buffer size: ${messageContent.video.length} bytes`);
            } else if (messageContent.audio) {
                console.log(`🎵 Audio buffer size: ${messageContent.audio.length} bytes`);
            } else if (messageContent.document) {
                console.log(`📄 Document buffer size: ${messageContent.document.length} bytes`);
            }
            
            const result = await sock.sendMessage(jid, messageContent);
            
            console.log(`✅ WhatsApp sendMessage result:`, {
                key: result.key,
                messageTimestamp: result.messageTimestamp,
                status: result.status
            });
            
            // Log activity
            await models.ActivityLog.create({
                account_id: accountId,
                action: 'message_sent',
                description: `Message sent to ${phone}`
            });
            
            return result;
            
        } catch (error) {
            console.error(`Error sending message from account ${accountId}:`, error);
            
            // Log error
            await models.ActivityLog.create({
                account_id: accountId,
                action: 'message_failed',
                description: `Failed to send message to ${phone}: ${error.message}`
            });
            
            throw error;
        }
    }

    async sendBulkMessages(campaignId) {
        try {
            const campaign = await models.Campaign.findOne({
                where: {
                    id: campaignId,
                    status: 'running'
                },
                include: [
                    {
                        model: models.Account,
                        as: 'account',
                        attributes: ['id']
                    },
                    {
                        model: models.MessageTemplate,
                        as: 'template',
                        attributes: ['message_text', 'media_path']
                    }
                ]
            });

            if (!campaign) {
                throw new Error('Campaign not found or not running');
            }

            const accountId = campaign.account.id;

            // Get pending messages
            const pendingMessages = await models.CampaignMessage.findAll({
                where: {
                    campaign_id: campaignId,
                    status: 'pending'
                },
                order: [['id', 'ASC']]
            });

            let sentCount = 0;
            let failedCount = 0;

            for (const messageData of pendingMessages) {
                try {
                    // Check if campaign is still running
                    const currentCampaign = await models.Campaign.findByPk(campaignId, {
                        attributes: ['status']
                    });

                    if (!currentCampaign || currentCampaign.status !== 'running') {
                        console.log('Campaign stopped or paused');
                        break;
                    }

                    // Send message
                    await this.sendMessage(
                        accountId,
                        messageData.phone,
                        messageData.message_text,
                        messageData.media_path
                    );

                    // Update message status
                    await models.CampaignMessage.update(
                        { status: 'sent', sent_at: new Date() },
                        { where: { id: messageData.id } }
                    );

                    sentCount++;

                    // Delay between messages
                    await delay(campaign.delay_seconds * 1000);

                } catch (error) {
                    console.error(`Failed to send message ${messageData.id}:`, error);
                    
                    // Update message status with error
                    await models.CampaignMessage.update(
                        { status: 'failed', error_message: error.message },
                        { where: { id: messageData.id } }
                    );

                    failedCount++;
                }
            }

            // Update campaign statistics
            await models.Campaign.increment(
                { sent_count: sentCount, failed_count: failedCount },
                { where: { id: campaignId } }
            );

            // Check if campaign is completed
            const remainingCount = await models.CampaignMessage.count({
                where: {
                    campaign_id: campaignId,
                    status: 'pending'
                }
            });

            if (remainingCount === 0) {
                await models.Campaign.update(
                    { status: 'completed', completed_at: new Date() },
                    { where: { id: campaignId } }
                );
            }

            return { sentCount, failedCount };

        } catch (error) {
            console.error('Error in bulk message sending:', error);
            
            // Update campaign status to error
            await models.Campaign.update(
                { status: 'cancelled' },
                { where: { id: campaignId } }
            );
            
            throw error;
        }
    }

    getMimeType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.mov': 'video/quicktime',
            '.avi': 'video/x-msvideo',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls': 'application/vnd.ms-excel',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }

    getAccountStatus(accountId) {
        const sock = this.sessions.get(accountId);
        return sock ? 'connected' : 'disconnected';
    }

    async sendTextMessage(accountId, toNumber, message) {
        try {
            // Convert accountId to numeric to match session keys (sessions are stored as numeric)
            const numericAccountId = parseInt(accountId);
            const stringAccountId = String(accountId);
            
            // Try numeric key first (sessions are stored as numeric)
            let sock = this.sessions.get(numericAccountId);
            console.log(`🔍 sendTextMessage session lookup - numeric key ${numericAccountId}:`, !!sock);
            
            // Fallback: try string key
            if (!sock) {
                sock = this.sessions.get(stringAccountId);
                console.log(`🔍 sendTextMessage session lookup - string key "${stringAccountId}":`, !!sock);
            }
            
            if (!sock) {
                console.log(`❌ No session found. Available:`, Array.from(this.sessions.keys()));
                throw new Error(`Account ${accountId} is not connected`);
            }
            
            // Format phone number for WhatsApp (add @s.whatsapp.net)
            const formattedNumber = toNumber.includes('@') ? toNumber : `${toNumber}@s.whatsapp.net`;
            
            // Send message
            const result = await sock.sendMessage(formattedNumber, { text: message });
            
            console.log(`Message sent from account ${accountId} to ${toNumber}`);
            
            return {
                success: true,
                messageId: result.key.id,
                timestamp: result.messageTimestamp
            };
            
        } catch (error) {
            console.error(`Error sending message from account ${accountId}:`, error);
            throw new Error(`Failed to send message: ${error.message}`);
        }
    }

    async sendMediaMessage(accountId, toNumber, mediaFileOrPath, caption = '') {
        console.log(`📎 Sending media message from account ${accountId} to ${toNumber}`);
        console.log(`📁 Media input:`, mediaFileOrPath);
        console.log(`💬 Caption: ${caption || '(no caption)'}`);
        
        try {
            // Handle both file object and path string
            let mediaPath, mimeType, originalName;
            
            if (typeof mediaFileOrPath === 'string') {
                // Old format: just path
                mediaPath = mediaFileOrPath;
                mimeType = this.getMimeType(mediaPath);
                originalName = null;
            } else {
                // New format: file object with mimetype
                mediaPath = mediaFileOrPath.path;
                mimeType = mediaFileOrPath.mimetype || this.getMimeType(mediaFileOrPath.originalname || mediaPath);
                originalName = mediaFileOrPath.originalname;
            }
            
            console.log(`🏷️ Using MIME type: ${mimeType}`);
            console.log(`📄 Original filename: "${originalName}"`);
            
            // Use the existing sendMessage function that already supports media
            const result = await this.sendMessage(accountId, toNumber, caption, mediaPath, mimeType, originalName);
            
            console.log(`✅ Media message sent successfully to ${toNumber}`);
            return result;
            
        } catch (error) {
            console.error(`❌ Failed to send media message to ${toNumber}:`, error.message);
            throw error;
        }
    }

    async scheduleReconnect(accountId, disconnectReason) {
        // Initialize retry count if not exists
        if (!this.retryCount) {
            this.retryCount = new Map();
        }
        
        const currentRetries = this.retryCount.get(accountId) || 0;
        const maxRetries = 5; // Maksimal 5 kali retry
        
        if (currentRetries >= maxRetries) {
            console.log(`❌ Account ${accountId} reached max retry attempts. Stopping reconnection.`);
            await models.Account.update(
                { status: 'error' },
                { where: { id: accountId } }
            );
            this.retryCount.delete(accountId);
            return;
        }
        
        // Exponential backoff: 5s, 15s, 45s, 135s, 405s
        const delayMs = Math.min(5000 * Math.pow(3, currentRetries), 300000); // Max 5 minutes
        
        console.log(`🔄 Scheduling reconnect for account ${accountId} in ${delayMs/1000}s (attempt ${currentRetries + 1}/${maxRetries})`);
        
        // Update retry count
        this.retryCount.set(accountId, currentRetries + 1);
        
        // Update database status
        await models.Account.update(
            { status: 'reconnecting' },
            { where: { id: accountId } }
        );
        
        // Schedule reconnection with delay
        setTimeout(async () => {
            try {
                console.log(`🔄 Attempting reconnection for account ${accountId}...`);
                
                // Clean up old session files to prevent corruption
                await this.cleanSessionFiles(accountId);
                
                // Attempt reconnection
                await this.connectAccount(accountId);
                
                // Reset retry count on successful connection
                this.retryCount.delete(accountId);
                
            } catch (error) {
                console.error(`❌ Reconnection failed for account ${accountId}:`, error.message);
                
                // Schedule next retry
                await this.scheduleReconnect(accountId, disconnectReason);
            }
        }, delayMs);
    }

    async cleanSessionFiles(accountId, aggressive = false) {
        try {
            const sessionPath = path.join('./sessions', `session_${accountId}`);
            
            if (await fs.pathExists(sessionPath)) {
                console.log(`🧹 Cleaning session files for account ${accountId} (aggressive: ${aggressive})`);
                
                if (aggressive) {
                    // For manual reconnect - clean everything to force new QR
                    console.log(`🗑️ Aggressive cleanup for account ${accountId} - removing all session files`);
                    await fs.remove(sessionPath);
                    await fs.ensureDir(sessionPath);
                } else {
                    // For auto-reconnect - keep credentials, clean problematic files
                    const filesToClean = [
                        'app-state-sync-version.json',
                        'session-*.json',
                        'sender-keys.json'
                    ];
                    
                    for (const filePattern of filesToClean) {
                        try {
                            const files = await fs.readdir(sessionPath);
                            for (const file of files) {
                                if (filePattern.includes('*') ? 
                                    file.includes(filePattern.replace('*', '')) : 
                                    file === filePattern) {
                                    await fs.unlink(path.join(sessionPath, file));
                                    console.log(`Cleaned: ${file}`);
                                }
                            }
                        } catch (cleanError) {
                            // Ignore individual file errors
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error cleaning session files for account ${accountId}:`, error);
        }
    }

    async forceReconnectAccount(accountId) {
        console.log(`🔄 Force reconnecting account ${accountId}...`);
        
        try {
            // Disconnect existing session if any
            const existingSock = this.sessions.get(accountId);
            if (existingSock) {
                try {
                    await existingSock.logout();
                } catch (logoutError) {
                    console.log(`Logout error (expected):`, logoutError.message);
                }
                this.sessions.delete(accountId);
            }
            
            // Clean up tracking
            this.retryCount.delete(accountId);
            this.lastConnectionTime.delete(accountId);
            
            // Aggressive session cleanup to force new QR
            await this.cleanSessionFiles(accountId, true);
            
            // Update database status
            await models.Account.update(
                { status: 'connecting', qr_code: null },
                { where: { id: accountId } }
            );
            
            // Start fresh connection
            await this.connectAccount(accountId);
            
            console.log(`✅ Force reconnection initiated for account ${accountId}`);
            
        } catch (error) {
            console.error(`❌ Force reconnection failed for account ${accountId}:`, error);
            
            await models.Account.update(
                { status: 'error' },
                { where: { id: accountId } }
            );
            
            throw error;
        }
    }

    shouldAttemptReconnect(statusCode, errorMessage) {
        // Don't reconnect if user explicitly logged out
        if (statusCode === DisconnectReason.loggedOut) {
            return false;
        }
        
        // Don't reconnect on rate limiting errors (let them reconnect manually)
        if (errorMessage && errorMessage.includes('rate limit')) {
            return false;
        }
        
        // Don't reconnect on banned/blocked errors
        if (statusCode === DisconnectReason.forbidden || 
            statusCode === DisconnectReason.banned) {
            return false;
        }
        
        return true;
    }

    isPermanentError(statusCode) {
        const permanentErrors = [
            DisconnectReason.forbidden,
            DisconnectReason.banned,
            DisconnectReason.multideviceMismatch
        ];
        
        return permanentErrors.includes(statusCode);
    }

    getDisconnectReasonText(statusCode) {
        const reasons = {
            [DisconnectReason.badSession]: 'Bad Session',
            [DisconnectReason.connectionClosed]: 'Connection Closed',
            [DisconnectReason.connectionLost]: 'Connection Lost',
            [DisconnectReason.connectionReplaced]: 'Connection Replaced',
            [DisconnectReason.loggedOut]: 'Logged Out',
            [DisconnectReason.restart]: 'Restart Required',
            [DisconnectReason.timedOut]: 'Connection Timed Out',
            [DisconnectReason.forbidden]: 'Forbidden/Blocked',
            [DisconnectReason.banned]: 'Account Banned',
            [DisconnectReason.multideviceMismatch]: 'Multi-device Mismatch'
        };
        
        return reasons[statusCode] || `Unknown (${statusCode})`;
    }

    async disconnectAccount(accountId) {
        try {
            const sock = this.sessions.get(accountId);
            if (sock) {
                // Graceful logout
                await sock.logout();
                console.log(`Account ${accountId} logged out gracefully`);
            }
            
            // Clean up tracking
            this.sessions.delete(accountId);
            this.retryCount.delete(accountId);
            this.lastConnectionTime.delete(accountId);
            
            // Update database
            await models.Account.update(
                { status: 'disconnected', qr_code: null },
                { where: { id: accountId } }
            );
            
        } catch (error) {
            console.error(`Error disconnecting account ${accountId}:`, error);
        }
    }

    async disconnectAll() {
        console.log('🛑 Gracefully disconnecting all WhatsApp accounts...');
        
        for (const [accountId, sock] of this.sessions) {
            try {
                await sock.logout();
                console.log(`Account ${accountId} logged out`);
            } catch (error) {
                console.error(`Error disconnecting account ${accountId}:`, error);
            }
        }
        
        // Clean up all tracking maps
        this.sessions.clear();
        this.stores.clear();
        this.retryCount.clear();
        this.lastConnectionTime.clear();
        
        console.log('✅ All WhatsApp accounts disconnected');
    }
}

module.exports = new WhatsAppService();
