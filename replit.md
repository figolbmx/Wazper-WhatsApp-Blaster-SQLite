# Wazper - WhatsApp Blaster

## Overview

Wazper is a Node.js-based WhatsApp mass messaging application that enables multi-account management and bulk message sending. The application uses the Baileys library to interface with WhatsApp Web and provides a web-based dashboard for managing accounts, contacts, message templates, and campaigns. It supports sending text messages and media files (images, documents, audio, video) to multiple recipients with configurable delays and real-time monitoring.

## Recent Changes

**Database Migration (October 2025):**
- Migrated from MySQL database with mysql2 driver to SQLite with Sequelize ORM
- Created Sequelize models for all 7 database tables (Account, Contact, MessageTemplate, Campaign, CampaignMessage, MediaFile, ActivityLog)
- Converted all database operations to use Sequelize methods exclusively (no raw SQL queries)
- Removed legacy config/database.js helper to enforce ORM-only usage
- Database file stored as wazper.db in project root
- All relationships configured with proper foreign keys and cascading deletes
- Application fully tested and verified working with new database layer

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
- Bootstrap 5 for responsive UI components
- Vanilla JavaScript for client-side logic
- Font Awesome for icons
- Server-side rendered HTML with static file serving

**Design Pattern:**
- Single-page application (SPA) architecture with section-based navigation
- Client-side state management for broadcast operations
- Real-time updates via polling for campaign and message status
- Modal-based interactions for forms and confirmations

**Key Components:**
- Dashboard with analytics and statistics
- Multi-account management interface with QR code display
- Campaign management with real-time progress tracking
- Contact and message template management
- Media upload interface with file type validation

### Backend Architecture

**Technology Stack:**
- Node.js with Express.js framework
- RESTful API design pattern
- Session-based state management using express-session
- Multer for multipart form data and file uploads
- Sharp for image processing

**Design Pattern:**
- MVC-inspired architecture with models, routes, and services separation
- Service layer pattern for WhatsApp connection management
- Singleton pattern for WhatsApp service maintaining session state
- Repository pattern through Sequelize ORM models

**Key Services:**
- WhatsApp Service: Manages Baileys socket connections, QR code generation, message sending, and session persistence
- Account Management: Handles multi-account connections with individual session directories
- Campaign Orchestration: Controls bulk message sending with delays and status tracking
- Media Processing: Handles file uploads, type detection, and storage organization

**Connection Management:**
- In-memory Map storage for active WhatsApp socket sessions
- Rate limiting with 30-second cooldown between connection attempts
- Automatic reconnection logic with retry counting
- Session persistence using multi-file auth state (Baileys feature)

**Message Delivery:**
- Queue-based campaign execution with configurable delays
- Status tracking (pending, sent, failed, delivered, read)
- Error handling and logging for failed deliveries
- Support for scheduled messages (if scheduledAt is provided)

### Data Storage

**Database:** SQLite via Sequelize ORM

**Rationale:** SQLite was chosen for simplicity and portability, avoiding the need for a separate database server. This makes deployment and development easier, particularly for single-instance deployments. The application can be migrated to PostgreSQL or MySQL by changing the Sequelize dialect configuration.

**Schema Design:**

1. **Accounts Table**: Stores WhatsApp account information including connection status, QR codes, and session data
2. **Contacts Table**: Manages recipient information with optional grouping
3. **MessageTemplates Table**: Stores reusable message templates with optional media attachments
4. **Campaigns Table**: Tracks bulk messaging campaigns with progress metrics
5. **CampaignMessages Table**: Individual message records within campaigns with delivery status
6. **MediaFiles Table**: Metadata for uploaded media files
7. **ActivityLogs Table**: Audit trail for user actions and system events

**Relationships:**
- One-to-many: Account → Campaigns, Campaign → CampaignMessages, Contact → CampaignMessages, MessageTemplate → Campaigns
- Foreign key constraints with CASCADE and SET NULL delete rules for data integrity

**File Storage:**
- Media files organized by type in separate directories (images/, documents/, audio/, video/)
- UUID-based filenames to prevent collisions
- Session data stored in individual directories per account

### Authentication and Authorization

**Current Implementation:**
- Basic session management using express-session
- No user authentication system currently implemented
- Session secret configurable via environment variable

**Security Considerations:**
- The application currently lacks user authentication
- Suitable for single-user or trusted environment deployments
- Future enhancement: Add user authentication layer with role-based access control

### API Structure

**RESTful Endpoints:**

- `/api/accounts` - CRUD operations for WhatsApp accounts
- `/api/messages` - Message sending and history
- `/api/campaigns` - Campaign management and monitoring
- `/api/uploads` - Media file upload handling
- `/api/status` - System health and statistics

**Request/Response Format:**
- JSON for all API communications
- Standard HTTP status codes
- Error responses include descriptive error messages
- File uploads use multipart/form-data

## External Dependencies

### Third-Party Libraries

**@whiskeysockets/baileys (v7.0.0-rc.6):**
- Purpose: WhatsApp Web API client library
- Handles WebSocket connections to WhatsApp servers
- Provides QR code authentication flow
- Manages message encryption and protocol compliance
- Alternative considered: whatsapp-web.js (also included but Baileys is primary)

**Sequelize (v6.37.7):**
- Purpose: Promise-based ORM for database operations
- Supports multiple SQL dialects (currently using SQLite)
- Provides model definitions, migrations, and query building
- Alternative: Direct SQL queries (rejected for maintainability)

**Multer (v1.4.5-lts.1):**
- Purpose: Middleware for handling multipart/form-data file uploads
- File size limiting and MIME type validation
- Temporary file storage with stream handling

**Sharp:**
- Purpose: High-performance image processing
- Used for image optimization and format conversion
- Native module for better performance than pure JavaScript alternatives

**QRCode (v1.5.4):**
- Purpose: QR code generation for WhatsApp authentication
- Converts auth tokens to scannable QR codes
- Supports terminal output via qrcode-terminal for debugging

**Pino (v10.1.0):**
- Purpose: Fast JSON logger
- Low-overhead logging for production environments
- Configurable log levels (currently set to 'warn')

### File Processing

- **fs-extra (v11.3.2)**: Enhanced file system operations with promise support
- **path**: Built-in Node.js module for cross-platform path handling

### Session and State Management

- **express-session (v1.18.2)**: Server-side session storage
- In-memory session store (suitable for single-instance; use Redis for scaling)

### Runtime Requirements

- Node.js v16.0.0 or higher (required for ES6+ features and Baileys compatibility)
- Sufficient disk space for media file storage and SQLite database
- Stable internet connection for WhatsApp Web socket connections

### Development vs Production

**Development:**
- SQLite database for easy setup
- File-based session storage
- Console logging enabled

**Production Considerations:**
- Migrate to PostgreSQL/MySQL for better concurrent access
- Implement Redis for session storage in multi-instance deployments
- Add process manager (PM2) for automatic restarts
- Configure reverse proxy (nginx) for static file serving
- Implement proper logging with rotation
- Add monitoring and alerting for WhatsApp connection status