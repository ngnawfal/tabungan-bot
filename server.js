require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initializeWhatsApp } = require('./src/bot/whatsapp');
const { initializeDatabase } = require('./src/database/migrations');
const { startReminderService } = require('./src/features/reminders');
const { startBackupScheduler } = require('./src/features/backup');
const { startWeeklyReportScheduler, startDailyTipsScheduler } = require('./src/features/advancedFeatures');
const { initializeBadges } = require('./src/features/gamification');
const apiRoutes = require('./src/routes/api');
const logger = require('./src/utils/logger');
const { apiLimiter } = require('./src/middlewares/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3847;

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (req.path.startsWith('/api')) {
            logger.info(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
        }
    });
    next();
});

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Explicit route for /dashboard to serve index.html (fix for Cloudflare Tunnel)
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/dashboard/index.html'));
});
app.use('/dashboard', express.static(path.join(__dirname, 'public/dashboard')));

// Apply rate limiting to API routes
app.use('/api', apiLimiter);

// API Routes
app.use('/api', apiRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Initialize services
async function startServer() {
    try {
        logger.info('Starting Tabungan Bot Server...');
        
        // Initialize Database
        logger.info('Initializing database...');
        await initializeDatabase();
        
        // Initialize WhatsApp
        logger.info('Initializing WhatsApp...');
        await initializeWhatsApp();
        
        // Start Reminder Service
        logger.info('Starting reminder service...');
        startReminderService();
        
        // Start Auto Backup Scheduler (setiap hari jam 02:00)
        logger.info('Starting auto backup scheduler...');
        startBackupScheduler('0 2 * * *');
        
        // Initialize gamification badges
        logger.info('Initializing gamification badges...');
        await initializeBadges();
        
        // Start Weekly Report Scheduler (Minggu jam 08:00)
        logger.info('Starting weekly report scheduler...');
        startWeeklyReportScheduler();
        
        // Start Daily Tips Scheduler (setiap hari jam 07:00)
        logger.info('Starting daily tips scheduler...');
        startDailyTipsScheduler();
        
        // Start Express Server
        app.listen(PORT, () => {
            logger.info(`Server running on http://localhost:${PORT}`);
            logger.info(`Dashboard available at http://localhost:${PORT}/dashboard`);
        });
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
    logger.info('Shutting down gracefully...');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});

startServer();
