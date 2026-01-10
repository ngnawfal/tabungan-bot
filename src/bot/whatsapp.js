const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const EventEmitter = require('events');
const { handleMessage, startExpirationService } = require('./handlers');
const logger = require('../utils/logger');
const { setClient } = require('../features/adminNotify');
const { setReminderClient } = require('../features/reminders');
const { setWeeklyReportClient, setDailyTipsClient } = require('../features/advancedFeatures');
const { initSessionTable, saveSession, getSession, deleteSession } = require('./sessionStore');

let client = null;
let isClientReady = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_BASE = 5000; // 5 seconds base delay

// ========== WEB UI STATUS TRACKING ==========
const statusEmitter = new EventEmitter();
let currentQR = null;
let currentStatus = 'initializing'; // initializing, qr_ready, authenticated, ready, disconnected
let connectedPhone = null;

function emitStatus() {
    statusEmitter.emit('status', {
        status: currentStatus,
        qr: currentQR,
        phone: connectedPhone,
        isReady: isClientReady,
        timestamp: new Date().toISOString()
    });
}

function getWhatsAppStatus() {
    return {
        status: currentStatus,
        qr: currentQR,
        phone: connectedPhone,
        isReady: isClientReady,
        timestamp: new Date().toISOString()
    };
}

function getStatusEmitter() {
    return statusEmitter;
}

// Helper function to wait
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Check if client is ready
function isReady() {
    return client && isClientReady;
}

// Safe send message with retry
async function safeSendMessage(chatId, content, options = {}) {
    if (!isReady()) {
        logger.warn('Client not ready, message queued for retry');
        // Wait and retry up to 3 times
        for (let i = 0; i < 3; i++) {
            await delay(2000);
            if (isReady()) break;
        }
        if (!isReady()) {
            throw new Error('WhatsApp client not ready after retries');
        }
    }

    try {
        const result = await client.sendMessage(chatId, content, options);
        return result;
    } catch (error) {
        // Check if it's the WidFactory error
        if (error.message && error.message.includes('WidFactory')) {
            logger.error('WidFactory error detected, session may be invalid');
            isClientReady = false;
            // Attempt reconnection
            handleReconnect('WidFactory error');
            throw new Error('Session invalid, reconnecting...');
        }
        throw error;
    }
}

// Handle reconnection with exponential backoff
async function handleReconnect(reason) {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        logger.error(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Manual intervention required.`);
        logger.error('Try deleting .wwebjs_auth folder and restart the bot to scan QR again.');
        return;
    }

    reconnectAttempts++;
    const delayTime = RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttempts - 1);

    logger.warn(`Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delayTime / 1000}s. Reason: ${reason}`);

    await delay(delayTime);

    try {
        if (client) {
            try {
                await client.destroy();
            } catch (e) {
                logger.warn('Error destroying old client:', e.message);
            }
        }

        // Reinitialize
        await initializeWhatsApp();
    } catch (error) {
        logger.error('Reconnect failed:', error.message);
        handleReconnect('Reconnect failed');
    }
}

async function initializeWhatsApp() {
    // Initialize session table in database
    try {
        await initSessionTable();
    } catch (e) {
        logger.warn('Session table init warning:', e.message);
    }

    const sessionName = process.env.WHATSAPP_SESSION_NAME || 'tabungan-bot';

    client = new Client({
        authStrategy: new LocalAuth({
            clientId: sessionName,
            dataPath: './.wwebjs_auth'
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        },
        restartOnAuthFail: true
    });

    client.on('qr', async (qr) => {
        isClientReady = false;
        reconnectAttempts = 0; // Reset on new QR
        currentStatus = 'qr_ready';
        connectedPhone = null;

        // Generate QR as base64 for web UI
        try {
            currentQR = await QRCode.toDataURL(qr, { width: 256, margin: 2 });
        } catch (e) {
            logger.warn('Failed to generate QR base64:', e.message);
            currentQR = null;
        }

        emitStatus();
        logger.info('Scan QR Code to login WhatsApp:');
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', async () => {
        isClientReady = true;
        reconnectAttempts = 0; // Reset on successful connection
        currentStatus = 'ready';
        currentQR = null;

        // Get connected phone number
        try {
            const info = client.info;
            connectedPhone = info?.wid?.user || null;
        } catch (e) {
            connectedPhone = null;
        }

        emitStatus();
        logger.info('WhatsApp Client is ready!');

        // Save session info to database for tracking
        try {
            await saveSession(sessionName, {
                status: 'connected',
                connectedAt: new Date().toISOString()
            });
        } catch (e) {
            logger.warn('Failed to save session info:', e.message);
        }

        setClient(client);
        setReminderClient(client);
        setWeeklyReportClient(client);
        setDailyTipsClient(client);
        startExpirationService(client);
    });

    client.on('authenticated', () => {
        currentStatus = 'authenticated';
        currentQR = null;
        emitStatus();
        logger.info('WhatsApp authenticated successfully!');
    });

    client.on('auth_failure', async (msg) => {
        isClientReady = false;
        logger.error('Authentication failed:', msg);
        logger.info('Deleting session and will show new QR code...');

        // Delete session from database
        try {
            await deleteSession(sessionName);
        } catch (e) {
            logger.warn('Failed to delete session from db:', e.message);
        }

        // Wait before retry
        await delay(5000);
        handleReconnect('Authentication failure');
    });

    client.on('disconnected', async (reason) => {
        isClientReady = false;
        currentStatus = 'disconnected';
        connectedPhone = null;
        emitStatus();
        logger.warn('WhatsApp disconnected:', reason);

        // Update session status
        try {
            await saveSession(sessionName, {
                status: 'disconnected',
                disconnectedAt: new Date().toISOString(),
                reason: reason
            });
        } catch (e) {
            logger.warn('Failed to update session status:', e.message);
        }

        handleReconnect(reason);
    });

    client.on('change_state', (state) => {
        logger.info('WhatsApp state changed:', state);
        if (state === 'CONFLICT' || state === 'UNLAUNCHED') {
            isClientReady = false;
        }
    });

    client.on('message', async (message) => {
        if (!isClientReady) {
            logger.warn('Received message but client not ready, skipping');
            return;
        }

        try {
            await handleMessage(client, message);
        } catch (error) {
            logger.error('Error handling message:', error);
            try {
                await message.reply('Maaf, terjadi kesalahan. Silakan coba lagi.');
            } catch (replyError) {
                logger.error('Failed to send error reply:', replyError.message);
            }
        }
    });

    try {
        await client.initialize();
    } catch (error) {
        logger.error('Failed to initialize WhatsApp client:', error);
        handleReconnect('Initialization failed');
    }
}

function getClient() {
    return client;
}

// Logout function for web UI
async function logoutClient() {
    if (client) {
        try {
            currentStatus = 'disconnected';
            connectedPhone = null;
            currentQR = null;
            emitStatus();
            await client.logout();
            await client.destroy();
            logger.info('WhatsApp client logged out via web UI');
            // Reinitialize to get new QR
            setTimeout(() => initializeWhatsApp(), 2000);
            return true;
        } catch (e) {
            logger.error('Logout error:', e.message);
            return false;
        }
    }
    return false;
}

module.exports = {
    initializeWhatsApp,
    getClient,
    isReady,
    safeSendMessage,
    getWhatsAppStatus,
    getStatusEmitter,
    logoutClient
};