const logger = require('../utils/logger');

let waClient = null;
let safeSendFn = null;
let isReadyFn = null;

// Lazy load to avoid circular dependency
function getSafeSend() {
    if (!safeSendFn) {
        const wa = require('../bot/whatsapp');
        safeSendFn = wa.safeSendMessage;
        isReadyFn = wa.isReady;
    }
    return { safeSendMessage: safeSendFn, isReady: isReadyFn };
}

function setClient(client) {
    waClient = client;
}

function getAdminPhone() {
    return process.env.PAYMENT_ADMIN_WHATSAPP || null;
}

async function notifyAdmin(message) {
    const adminPhone = getAdminPhone();
    if (!adminPhone) {
        logger.warn('Admin phone not configured (PAYMENT_ADMIN_WHATSAPP)');
        return false;
    }
    
    const { safeSendMessage, isReady } = getSafeSend();
    
    if (!waClient || !isReady()) {
        logger.warn('WhatsApp client not available for admin notification');
        return false;
    }
    
    try {
        const contactId = await waClient.getNumberId(adminPhone);
        const chatId = contactId ? contactId._serialized : adminPhone + '@c.us';
        await safeSendMessage(chatId, message);
        logger.info('Admin notification sent successfully');
        return true;
    } catch (error) {
        logger.error('Failed to send admin notification:', error);
        return false;
    }
}

async function notifyNewTransaction(transaction, user) {
    const msg = '🔔 *TRANSAKSI BARU MASUK*\n' +
               '━━━━━━━━━━━━━━━━\n\n' +
               '🆔 ID: ' + transaction.id + '\n' +
               '👤 User: ' + (user ? user.name : 'Unknown') + '\n' +
               '💰 Nominal: Rp ' + transaction.amount.toLocaleString('id-ID') + '\n' +
               '⏰ Waktu: ' + new Date().toLocaleString('id-ID') + '\n\n' +
               '⚠️ Menunggu konfirmasi di Dashboard';
    
    return await notifyAdmin(msg);
}

async function notifyNewWithdrawal(withdrawal, user) {
    const msg = '💸 *PENARIKAN BARU*\n' +
               '━━━━━━━━━━━━━━━━\n\n' +
               '🆔 ID: #' + withdrawal.id + '\n' +
               '👤 User: ' + (user ? user.name : 'Unknown') + '\n' +
               '💰 Jumlah: Rp ' + withdrawal.amount.toLocaleString('id-ID') + '\n' +
               '🏦 Tujuan: ' + withdrawal.account_type + '\n' +
               '📝 ' + withdrawal.account_number + '\n' +
               '👤 a.n. ' + withdrawal.account_name + '\n\n' +
               '⚠️ Segera proses di Dashboard!';
    
    return await notifyAdmin(msg);
}

async function notifyScreenshotUploaded(transaction, user) {
    const msg = '📸 *BUKTI TRANSFER MASUK*\n' +
               '━━━━━━━━━━━━━━━━\n\n' +
               '🆔 Transaksi ID: ' + transaction.id + '\n' +
               '👤 User: ' + (user ? user.name : 'Unknown') + '\n' +
               '💰 Nominal: Rp ' + transaction.amount.toLocaleString('id-ID') + '\n\n' +
               '✅ Silakan cek dan konfirmasi di Dashboard';
    
    return await notifyAdmin(msg);
}

module.exports = {
    setClient,
    notifyAdmin,
    notifyNewTransaction,
    notifyNewWithdrawal,
    notifyScreenshotUploaded
};
