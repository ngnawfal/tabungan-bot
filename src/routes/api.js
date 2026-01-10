const { getSystemStats, getAllTransactions, getFinancialAnalysis, updateTransactionStatus, getUserById, getTransactionById, getAllUsers, updateUser, deleteUser, updateTransaction, deleteTransaction, deleteMultipleTransactions, getAllWithdrawals, getWithdrawalById, updateWithdrawalStatus, getPendingWithdrawalsCount, createTransaction, createReminder, getAllReminders, getReminderById, updateReminder, deleteReminder, getBalance, getTransactionHistory, getAllExpenses, getGlobalExpensesSummary, getExpenseCategories, deleteExpense } = require('../database/models');
const { createBackup, restoreBackup, listBackups, deleteBackup, getBackupPath } = require('../features/backup');
const { processGamificationOnDeposit } = require('../bot/handlers');
const multer = require('multer');
const backupUpload = multer({ dest: './temp/uploads/' });
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const path = require('path');
const { getClient, getWhatsAppStatus, getStatusEmitter, logoutClient } = require('../bot/whatsapp');
const logger = require('../utils/logger');
const { loginLimiter, heavyOperationLimiter } = require('../middlewares/rateLimiter');
const { loginValidation, transactionValidation, userUpdateValidation, idParamValidation, messageValidation, withdrawalValidation } = require('../middlewares/validators');

// Simple authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    // Also check query string for download endpoints
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

    if (!token) {
        return res.sendStatus(401);
    }

    jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// Admin login with rate limiting
router.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username dan password harus diisi' });
    }

    if (username === (process.env.ADMIN_USERNAME || 'admin') &&
        password === (process.env.ADMIN_PASSWORD || 'admin')) {
        const token = jwt.sign({ username }, process.env.JWT_SECRET || 'secret');
        logger.info(`Admin login successful: ${username}`);
        res.json({ token });
    } else {
        logger.warn(`Failed login attempt for username: ${username}`);
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// Dashboard stats
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const stats = await getSystemStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Transaction History
router.get('/transactions', authenticateToken, async (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit) : 100;
        const transactions = await getAllTransactions(limit);
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// Financial Analysis
router.get('/analysis', authenticateToken, async (req, res) => {
    try {
        const analysis = await getFinancialAnalysis();
        res.json(analysis);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch analysis' });
    }
});

// Bulk Delete Transactions (must be before :id routes)
router.post('/transactions/bulk-delete', authenticateToken, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'No transaction IDs provided' });
        }

        const changes = await deleteMultipleTransactions(ids);
        res.json({ success: true, deleted: changes });
    } catch (error) {
        console.error('Bulk delete error:', error);
        res.status(500).json({ error: 'Failed to delete transactions' });
    }
});

// Confirm Transaction
router.post('/transactions/:id/confirm', authenticateToken, async (req, res) => {
    try {
        const txId = req.params.id;
        const tx = await getTransactionById(txId);

        if (!tx) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        const changes = await updateTransactionStatus(txId, 'success');

        if (changes > 0) {
            const client = getClient();
            if (client && tx.user_id) {
                const user = await getUserById(tx.user_id);
                if (user && user.phone_number) {
                    // Get updated balance
                    const balance = await getBalance(user.id);

                    // Notify user with total balance
                    const msg = "✅ *PEMBAYARAN DIKONFIRMASI*\n\n" +
                        "Transaksi ID: " + tx.id + "\n" +
                        "Nominal: Rp " + tx.amount.toLocaleString('id-ID') + "\n\n" +
                        "💰 *Total Tabungan: Rp " + balance.toLocaleString('id-ID') + "*\n\n" +
                        "Terima kasih! 🎉";

                    try {
                        const contactId = await client.getNumberId(user.phone_number);
                        if (contactId) {
                            await client.sendMessage(contactId._serialized, msg);
                        } else {
                            await client.sendMessage(user.phone_number + "@c.us", msg);
                        }
                    } catch (e) {
                        console.error("Failed to send confirmation notification:", e.message);
                    }

                    // Notify partner if exists
                    if (user.partner_phone) {
                        const partnerMsg = "💕 *PASANGANMU MENABUNG!*\n\n" +
                            "🎉 " + (user.name || "Pasanganmu") + " baru saja menabung!\n" +
                            "💰 Nominal: Rp " + tx.amount.toLocaleString('id-ID') + "\n\n" +
                            "Semangat nabung bareng! 💪✨";
                        try {
                            const partnerContactId = await client.getNumberId(user.partner_phone);
                            if (partnerContactId) {
                                await client.sendMessage(partnerContactId._serialized, partnerMsg);
                            } else {
                                await client.sendMessage(user.partner_phone + "@c.us", partnerMsg);
                            }
                            console.log("Partner notification sent to:", user.partner_phone);
                        } catch (e) {
                            console.error("Failed to send partner notification:", e.message);
                        }
                    }

                    // Process gamification (badges, streaks, milestones)
                    if (tx.type === 'deposit') {
                        try {
                            const history = await getTransactionHistory(user.id, 100);
                            const txCount = history.filter(t => t.confirmed && t.type === 'deposit').length;
                            await processGamificationOnDeposit(client, user, balance, txCount);
                        } catch (gamErr) {
                            console.error("Gamification processing error:", gamErr.message);
                        }
                    }
                }
            }
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'No changes made' });
        }
    } catch (error) {
        console.error("Confirmation error:", error);
        res.status(500).json({ error: 'Failed to confirm transaction' });
    }
});

// Reject Transaction
router.post('/transactions/:id/reject', authenticateToken, async (req, res) => {
    try {
        const txId = req.params.id;
        const changes = await updateTransactionStatus(txId, 'cancelled');

        if (changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Transaction not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to reject transaction' });
    }
});

// Update Transaction
router.put('/transactions/:id', authenticateToken, async (req, res) => {
    try {
        const txId = req.params.id;
        const changes = await updateTransaction(txId, req.body);

        if (changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Transaction not found' });
        }
    } catch (error) {
        console.error('Update transaction error:', error);
        res.status(500).json({ error: 'Failed to update transaction' });
    }
});

// Delete Transaction
router.delete('/transactions/:id', authenticateToken, async (req, res) => {
    try {
        const txId = req.params.id;
        const changes = await deleteTransaction(txId);

        if (changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Transaction not found' });
        }
    } catch (error) {
        console.error('Delete transaction error:', error);
        res.status(500).json({ error: 'Failed to delete transaction' });
    }
});

// Get All Users
router.get('/users', authenticateToken, async (req, res) => {
    try {
        const users = await getAllUsers();
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Get Single User
router.get('/users/:id', authenticateToken, async (req, res) => {
    try {
        const user = await getUserById(req.params.id);
        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// Update User
router.put('/users/:id', authenticateToken, async (req, res) => {
    try {
        const changes = await updateUser(req.params.id, req.body);
        if (changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Delete User
router.delete('/users/:id', authenticateToken, async (req, res) => {
    try {
        const changes = await deleteUser(req.params.id);
        if (changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// Export Transactions as JSON (for client-side PDF/Excel generation)
router.get('/export/transactions', authenticateToken, async (req, res) => {
    try {
        const transactions = await getAllTransactions(1000);
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ error: 'Failed to export transactions' });
    }
});

// Export Users as JSON
router.get('/export/users', authenticateToken, async (req, res) => {
    try {
        const users = await getAllUsers();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Failed to export users' });
    }
});

// ===== BACKUP ROUTES =====

// Create new backup with rate limiting for heavy operations
router.post('/backup/create', authenticateToken, heavyOperationLimiter, async (req, res) => {
    try {
        const result = await createBackup();
        logger.info('Backup created successfully: ' + result.filename);
        res.json({ success: true, backup: result });
    } catch (error) {
        logger.error('Backup creation error:', error);
        res.status(500).json({ error: 'Failed to create backup' });
    }
});

// List all backups
router.get('/backup/list', authenticateToken, async (req, res) => {
    try {
        const backups = listBackups();
        res.json(backups);
    } catch (error) {
        res.status(500).json({ error: 'Failed to list backups' });
    }
});

// Download backup (supports token in query for file download)
router.get('/backup/download/:filename', (req, res) => {
    try {
        // Check token from header or query string
        const token = req.headers['authorization']?.split(' ')[1] || req.query.token;
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err) => {
            if (err) {
                return res.status(403).json({ error: 'Invalid token' });
            }

            const filename = req.params.filename;
            const filePath = getBackupPath(filename);

            if (!filePath) {
                return res.status(404).json({ error: 'Backup not found' });
            }

            res.download(filePath, filename);
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to download backup' });
    }
});

// Delete backup
router.delete('/backup/:filename', authenticateToken, (req, res) => {
    try {
        const filename = req.params.filename;
        const deleted = deleteBackup(filename);

        if (deleted) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Backup not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete backup' });
    }
});

// Send WhatsApp message to user
router.post('/users/:id/send-message', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const user = await getUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const client = getClient();
        if (!client) {
            return res.status(500).json({ error: 'WhatsApp client not ready' });
        }

        try {
            const contactId = await client.getNumberId(user.phone_number);
            if (contactId) {
                await client.sendMessage(contactId._serialized, message);
            } else {
                await client.sendMessage(user.phone_number + "@c.us", message);
            }
            res.json({ success: true, message: 'Message sent successfully' });
        } catch (e) {
            console.error('Failed to send message:', e);
            res.status(500).json({ error: 'Failed to send WhatsApp message' });
        }
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Send login credentials to user
router.post('/users/:id/send-credentials', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await getUserById(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!user.username || !user.password) {
            return res.status(400).json({ error: 'User credentials not set' });
        }

        const client = getClient();
        if (!client) {
            return res.status(500).json({ error: 'WhatsApp client not ready' });
        }

        const message = "🔐 *INFORMASI LOGIN AKUN*\n\n" +
            "Hai " + (user.name || "User") + "! 👋\n\n" +
            "Berikut adalah informasi login akun tabungan Anda:\n\n" +
            "👤 Username: *" + user.username + "*\n" +
            "🔑 Password: *" + user.password + "*\n\n" +
            "📱 Cara login:\n" +
            "1. Ketik /login\n" +
            "2. Masukkan username\n" +
            "3. Masukkan password\n\n" +
            "⚠️ Jaga kerahasiaan password Anda!\n\n" +
            "- Admin Tabungan Bot";

        try {
            const contactId = await client.getNumberId(user.phone_number);
            if (contactId) {
                await client.sendMessage(contactId._serialized, message);
            } else {
                await client.sendMessage(user.phone_number + "@c.us", message);
            }
            res.json({ success: true, message: 'Credentials sent successfully' });
        } catch (e) {
            console.error('Failed to send credentials:', e);
            res.status(500).json({ error: 'Failed to send WhatsApp message' });
        }
    } catch (error) {
        console.error('Send credentials error:', error);
        res.status(500).json({ error: 'Failed to send credentials' });
    }
});

// Broadcast message to all users
router.post('/broadcast', authenticateToken, async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const users = await getAllUsers();
        const client = getClient();

        if (!client) {
            return res.status(500).json({ error: 'WhatsApp client not ready' });
        }

        let sent = 0;
        let failed = 0;

        for (const user of users) {
            try {
                const contactId = await client.getNumberId(user.phone_number);
                if (contactId) {
                    await client.sendMessage(contactId._serialized, message);
                } else {
                    await client.sendMessage(user.phone_number + "@c.us", message);
                }
                sent++;
                // Small delay to prevent spam detection
                await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                console.error('Failed to send to:', user.phone_number);
                failed++;
            }
        }

        res.json({ success: true, sent, failed, total: users.length });
    } catch (error) {
        console.error('Broadcast error:', error);
        res.status(500).json({ error: 'Failed to broadcast message' });
    }
});

// Import/Restore backup
router.post('/backup/restore', authenticateToken, backupUpload.single('backup'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No backup file uploaded' });
        }

        const result = await restoreBackup(req.file.path);

        // Clean up uploaded file
        const fs = require('fs');
        fs.unlinkSync(req.file.path);

        res.json(result);
    } catch (error) {
        console.error('Restore backup error:', error);
        res.status(500).json({ error: error.message || 'Failed to restore backup' });
    }
});

// ===== WITHDRAWAL ROUTES =====

// Get all withdrawals
router.get('/withdrawals', authenticateToken, async (req, res) => {
    try {
        const withdrawals = await getAllWithdrawals();
        res.json(withdrawals);
    } catch (error) {
        console.error('Error fetching withdrawals:', error);
        res.status(500).json({ error: 'Failed to fetch withdrawals' });
    }
});

// Get pending withdrawals count
router.get('/withdrawals/pending-count', authenticateToken, async (req, res) => {
    try {
        const count = await getPendingWithdrawalsCount();
        res.json({ count });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get count' });
    }
});

// Get single withdrawal
router.get('/withdrawals/:id', authenticateToken, async (req, res) => {
    try {
        const withdrawal = await getWithdrawalById(req.params.id);
        if (withdrawal) {
            res.json(withdrawal);
        } else {
            res.status(404).json({ error: 'Withdrawal not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch withdrawal' });
    }
});

// Approve withdrawal (mark as success)
router.post('/withdrawals/:id/approve', authenticateToken, async (req, res) => {
    try {
        const withdrawalId = req.params.id;
        const { adminNotes } = req.body;

        const withdrawal = await getWithdrawalById(withdrawalId);
        if (!withdrawal) {
            return res.status(404).json({ error: 'Withdrawal not found' });
        }

        if (withdrawal.status !== 'pending') {
            return res.status(400).json({ error: 'Withdrawal already processed' });
        }

        // Update withdrawal status
        await updateWithdrawalStatus(withdrawalId, 'success', adminNotes || 'Transfer berhasil');

        // Create a transaction record for the withdrawal
        await createTransaction({
            user_id: withdrawal.user_id,
            amount: withdrawal.amount,
            type: 'withdrawal',
            payment_method: withdrawal.account_type,
            confirmed: true,
            status: 'success'
        });

        // Send WhatsApp notification to user
        const client = getClient();
        if (client && withdrawal.phone_number) {
            const msg = "✅ *PENARIKAN BERHASIL!*\n\n" +
                "🆔 ID Penarikan: #" + withdrawal.id + "\n" +
                "💰 Jumlah: Rp " + withdrawal.amount.toLocaleString('id-ID') + "\n" +
                "🏦 Tujuan: " + withdrawal.account_type.toUpperCase() + "\n" +
                "📝 " + withdrawal.account_number + "\n" +
                "👤 a.n. " + withdrawal.account_name + "\n\n" +
                "💸 Dana telah ditransfer ke rekening/e-wallet Anda.\n" +
                "📌 Silakan cek saldo Anda.\n\n" +
                "Terima kasih! 🙏";

            try {
                const contactId = await client.getNumberId(withdrawal.phone_number);
                if (contactId) {
                    await client.sendMessage(contactId._serialized, msg);
                } else {
                    await client.sendMessage(withdrawal.phone_number + "@c.us", msg);
                }
            } catch (e) {
                console.error('Failed to send withdrawal success notification:', e.message);
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Withdrawal approval error:', error);
        res.status(500).json({ error: 'Failed to approve withdrawal' });
    }
});

// Reject withdrawal (mark as failed)
router.post('/withdrawals/:id/reject', authenticateToken, async (req, res) => {
    try {
        const withdrawalId = req.params.id;
        const { adminNotes } = req.body;

        const withdrawal = await getWithdrawalById(withdrawalId);
        if (!withdrawal) {
            return res.status(404).json({ error: 'Withdrawal not found' });
        }

        if (withdrawal.status !== 'pending') {
            return res.status(400).json({ error: 'Withdrawal already processed' });
        }

        // Update withdrawal status
        await updateWithdrawalStatus(withdrawalId, 'failed', adminNotes || 'Ditolak oleh admin');

        // Send WhatsApp notification to user
        const client = getClient();
        if (client && withdrawal.phone_number) {
            const msg = "❌ *PENARIKAN DITOLAK*\n\n" +
                "🆔 ID Penarikan: #" + withdrawal.id + "\n" +
                "💰 Jumlah: Rp " + withdrawal.amount.toLocaleString('id-ID') + "\n\n" +
                "📌 Alasan: " + (adminNotes || "Tidak memenuhi syarat") + "\n\n" +
                "💡 Silakan hubungi admin untuk info lebih lanjut atau coba ajukan penarikan lagi dengan /tarik";

            try {
                const contactId = await client.getNumberId(withdrawal.phone_number);
                if (contactId) {
                    await client.sendMessage(contactId._serialized, msg);
                } else {
                    await client.sendMessage(withdrawal.phone_number + "@c.us", msg);
                }
            } catch (e) {
                console.error('Failed to send withdrawal rejection notification:', e.message);
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Withdrawal rejection error:', error);
        res.status(500).json({ error: 'Failed to reject withdrawal' });
    }
});

// ===== REMINDER ROUTES =====

// Get all reminders
router.get('/reminders', authenticateToken, async (req, res) => {
    try {
        const reminders = await getAllReminders();
        res.json(reminders);
    } catch (error) {
        console.error('Error fetching reminders:', error);
        res.status(500).json({ error: 'Failed to fetch reminders' });
    }
});

// Create new reminder
router.post('/reminders', authenticateToken, async (req, res) => {
    try {
        const { user_id, frequency, custom_message, is_active, send_time } = req.body;

        if (!user_id) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const reminder = await createReminder({
            user_id,
            frequency: frequency || 'daily',
            custom_message: custom_message || null,
            is_active: is_active !== false,
            send_time: send_time || '09:00'
        });

        logger.info('Reminder created for user: ' + user_id);
        res.json({ success: true, reminder });
    } catch (error) {
        console.error('Create reminder error:', error);
        res.status(500).json({ error: 'Failed to create reminder' });
    }
});

// Get single reminder
router.get('/reminders/:id', authenticateToken, async (req, res) => {
    try {
        const reminder = await getReminderById(req.params.id);
        if (reminder) {
            res.json(reminder);
        } else {
            res.status(404).json({ error: 'Reminder not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch reminder' });
    }
});

// Update reminder
router.put('/reminders/:id', authenticateToken, async (req, res) => {
    try {
        const { frequency, custom_message, is_active, send_time } = req.body;
        const changes = await updateReminder(req.params.id, {
            frequency,
            custom_message,
            is_active,
            send_time
        });

        if (changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Reminder not found' });
        }
    } catch (error) {
        console.error('Update reminder error:', error);
        res.status(500).json({ error: 'Failed to update reminder' });
    }
});

// Delete reminder
router.delete('/reminders/:id', authenticateToken, async (req, res) => {
    try {
        const changes = await deleteReminder(req.params.id);
        if (changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Reminder not found' });
        }
    } catch (error) {
        console.error('Delete reminder error:', error);
        res.status(500).json({ error: 'Failed to delete reminder' });
    }
});

// Send reminder manually
router.post('/reminders/:id/send', authenticateToken, async (req, res) => {
    try {
        const reminder = await getReminderById(req.params.id);
        if (!reminder) {
            return res.status(404).json({ error: 'Reminder not found' });
        }

        const client = getClient();
        if (!client) {
            return res.status(500).json({ error: 'WhatsApp client not ready' });
        }

        // Get user balance for {saldo} variable
        const { getBalance } = require('../database/models');
        const balance = await getBalance(reminder.user_id);

        // Build reminder message
        let message = reminder.custom_message ||
            '⏰ *REMINDER MENABUNG*\n\n' +
            'Hai ' + (reminder.user_name || 'User') + '! 👋\n\n' +
            'Jangan lupa menabung hari ini ya! 💰\n\n' +
            'Saldo kamu: Rp ' + balance.toLocaleString('id-ID') + '\n\n' +
            'Ketik /nabung [nominal] untuk mulai menabung.\n\n' +
            'Semangat! 💪';

        // Replace variables in custom message
        message = message.replace(/{name}/g, reminder.user_name || 'User');
        message = message.replace(/{saldo}/g, 'Rp ' + balance.toLocaleString('id-ID'));

        try {
            const contactId = await client.getNumberId(reminder.phone_number);
            if (contactId) {
                await client.sendMessage(contactId._serialized, message);
            } else {
                await client.sendMessage(reminder.phone_number + '@c.us', message);
            }

            // Update last_sent
            const { updateReminderLastSent } = require('../database/models');
            await updateReminderLastSent(reminder.id);

            logger.info('Reminder sent manually to: ' + reminder.phone_number);
            res.json({ success: true, message: 'Reminder sent successfully' });
        } catch (e) {
            console.error('Failed to send reminder:', e);
            res.status(500).json({ error: 'Failed to send WhatsApp message' });
        }
    } catch (error) {
        console.error('Send reminder error:', error);
        res.status(500).json({ error: 'Failed to send reminder' });
    }
});

// ===== WHATSAPP CONNECTION ROUTES (for Web UI) =====

// Get current WhatsApp status (snapshot)
router.get('/whatsapp/status', authenticateToken, (req, res) => {
    try {
        const status = getWhatsAppStatus();
        res.json(status);
    } catch (error) {
        logger.error('Error getting WhatsApp status:', error);
        res.status(500).json({ error: 'Failed to get WhatsApp status' });
    }
});

// SSE endpoint for realtime WhatsApp status updates (supports token in query for EventSource)
router.get('/whatsapp/stream', (req, res) => {
    // Check token from header or query string (EventSource doesn't support custom headers)
    const token = req.headers['authorization']?.split(' ')[1] || req.query.token;
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'secret', (err) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.flushHeaders();

        // Send initial status
        const initialStatus = getWhatsAppStatus();
        res.write(`data: ${JSON.stringify(initialStatus)}\n\n`);

        // Listen for status changes
        const statusEmitter = getStatusEmitter();
        const onStatus = (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        statusEmitter.on('status', onStatus);

        // Send heartbeat every 30 seconds to keep connection alive
        const heartbeat = setInterval(() => {
            res.write(`: heartbeat\n\n`);
        }, 30000);

        // Cleanup on client disconnect
        req.on('close', () => {
            statusEmitter.off('status', onStatus);
            clearInterval(heartbeat);
        });
    });
});

// Logout WhatsApp and get new QR
router.post('/whatsapp/logout', authenticateToken, async (req, res) => {
    try {
        const result = await logoutClient();
        if (result) {
            logger.info('WhatsApp logout initiated via web UI');
            res.json({ success: true, message: 'Logout initiated, new QR will be generated' });
        } else {
            res.status(400).json({ error: 'No active WhatsApp client to logout' });
        }
    } catch (error) {
        logger.error('WhatsApp logout error:', error);
        res.status(500).json({ error: 'Failed to logout WhatsApp' });
    }
});

// Test WhatsApp connection by sending a test message
router.post('/whatsapp/test', authenticateToken, async (req, res) => {
    try {
        const status = getWhatsAppStatus();
        if (status.status !== 'ready' || !status.phone) {
            return res.status(400).json({ error: 'WhatsApp not connected' });
        }

        const client = getClient();
        if (!client) {
            return res.status(500).json({ error: 'WhatsApp client not available' });
        }

        const testMessage = "✅ *TEST KONEKSI BERHASIL!*\n\n" +
            "🤖 Bot WhatsApp TabunganBot berhasil terhubung.\n" +
            "📅 Waktu: " + new Date().toLocaleString('id-ID') + "\n\n" +
            "Bot siap menerima perintah! 🎉";

        try {
            await client.sendMessage(status.phone + '@c.us', testMessage);
            logger.info('Test message sent to: ' + status.phone);
            res.json({ success: true, message: 'Test message sent to +' + status.phone });
        } catch (sendErr) {
            logger.error('Failed to send test message:', sendErr);
            res.status(500).json({ error: 'Failed to send test message' });
        }
    } catch (error) {
        logger.error('Test connection error:', error);
        res.status(500).json({ error: 'Test connection failed' });
    }
});

// ===== EXPENSE ROUTES =====

// Get all expenses (admin view)
router.get('/expenses', authenticateToken, async (req, res) => {
    try {
        const expenses = await getAllExpenses(100);
        res.json(expenses);
    } catch (error) {
        logger.error('Get expenses error:', error);
        res.status(500).json({ error: 'Failed to get expenses' });
    }
});

// Get expense summary by category
router.get('/expenses/summary', authenticateToken, async (req, res) => {
    try {
        const { month } = req.query;
        const summary = await getGlobalExpensesSummary(month);

        // Calculate total
        const total = summary.reduce((sum, s) => sum + (s.total || 0), 0);

        res.json({ summary, total });
    } catch (error) {
        logger.error('Get expense summary error:', error);
        res.status(500).json({ error: 'Failed to get expense summary' });
    }
});

// Get expense categories
router.get('/expenses/categories', authenticateToken, async (req, res) => {
    try {
        const categories = await getExpenseCategories();
        res.json(categories);
    } catch (error) {
        logger.error('Get categories error:', error);
        res.status(500).json({ error: 'Failed to get categories' });
    }
});

// Delete expense (admin)
router.delete('/expenses/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        // For admin delete, we pass null as userId to bypass user check
        // Need to modify deleteExpense or create admin version
        const result = await deleteExpense(id, null);
        if (result > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Expense not found' });
        }
    } catch (error) {
        logger.error('Delete expense error:', error);
        res.status(500).json({ error: 'Failed to delete expense' });
    }
});

// ===== EXPORT ROUTES =====

// Export expenses to PDF
router.get('/expenses/export/pdf', authenticateToken, async (req, res) => {
    try {
        const PDFDocument = require('pdfkit');
        const { month } = req.query;

        const expenses = await getAllExpenses(500);
        const summaryData = await getGlobalExpensesSummary(month);
        const total = summaryData.reduce((sum, s) => sum + (s.total || 0), 0);

        // Create PDF
        const doc = new PDFDocument({ margin: 50, size: 'A4' });

        // Set response headers
        const filename = `laporan-pengeluaran-${new Date().toISOString().slice(0, 10)}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        doc.pipe(res);

        // Header
        doc.fontSize(24).fillColor('#1e40af').text('LAPORAN PENGELUARAN', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(12).fillColor('#6b7280').text('Tabungan Bot - Expense Report', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor('#9ca3af').text(`Dibuat: ${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`, { align: 'center' });

        // Divider
        doc.moveDown(1);
        doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(1);

        // Summary Section
        doc.fontSize(14).fillColor('#1f2937').text('RINGKASAN', { underline: true });
        doc.moveDown(0.5);

        doc.fontSize(11).fillColor('#374151');
        doc.text(`Total Pengeluaran: Rp ${total.toLocaleString('id-ID')}`, { continued: false });
        doc.text(`Jumlah Transaksi: ${expenses.length}`);
        doc.moveDown(0.5);

        // Category Summary
        if (summaryData.length > 0) {
            doc.fontSize(12).fillColor('#1f2937').text('Per Kategori:', { underline: true });
            doc.moveDown(0.3);

            summaryData.forEach(s => {
                const percent = total > 0 ? ((s.total / total) * 100).toFixed(1) : 0;
                doc.fontSize(10).fillColor('#4b5563');
                doc.text(`- ${s.category_name || s.category}: Rp ${s.total.toLocaleString('id-ID')} (${percent}%)`);
            });
        }

        doc.moveDown(1);
        doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(1);

        // Transaction Table
        doc.fontSize(14).fillColor('#1f2937').text('DETAIL TRANSAKSI', { underline: true });
        doc.moveDown(0.5);

        // Table header
        const tableTop = doc.y;
        const colWidths = [70, 100, 100, 150, 75];
        const headers = ['Tanggal', 'Kategori', 'Nominal', 'Keterangan', 'User'];

        doc.fontSize(9).fillColor('#ffffff');
        doc.rect(50, tableTop, 495, 20).fill('#3b82f6');
        headers.forEach((h, i) => {
            let x = 55;
            for (let j = 0; j < i; j++) x += colWidths[j];
            doc.text(h, x, tableTop + 6, { width: colWidths[i] - 10 });
        });

        // Table rows
        let y = tableTop + 25;
        doc.fillColor('#374151');

        expenses.slice(0, 30).forEach((e, idx) => {
            if (y > 750) {
                doc.addPage();
                y = 50;
            }

            const bgColor = idx % 2 === 0 ? '#f9fafb' : '#ffffff';
            doc.rect(50, y - 3, 495, 18).fill(bgColor);

            doc.fontSize(8).fillColor('#374151');
            const date = new Date(e.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' });
            const row = [date, e.category_name || e.category, `Rp ${e.amount.toLocaleString('id-ID')}`, (e.description || '-').slice(0, 25), e.user_name || '-'];

            row.forEach((cell, i) => {
                let x = 55;
                for (let j = 0; j < i; j++) x += colWidths[j];
                doc.text(cell, x, y, { width: colWidths[i] - 10 });
            });

            y += 18;
        });

        // Footer
        doc.moveDown(2);
        doc.fontSize(8).fillColor('#9ca3af').text('Generated by Tabungan Bot', 50, 780, { align: 'center' });

        doc.end();

    } catch (error) {
        logger.error('Export PDF error:', error);
        res.status(500).json({ error: 'Failed to export PDF' });
    }
});

// Export expenses to Excel
router.get('/expenses/export/excel', authenticateToken, async (req, res) => {
    try {
        const ExcelJS = require('exceljs');
        const { month } = req.query;

        const expenses = await getAllExpenses(500);
        const summaryData = await getGlobalExpensesSummary(month);
        const total = summaryData.reduce((sum, s) => sum + (s.total || 0), 0);

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Tabungan Bot';
        workbook.created = new Date();

        // ===== Summary Sheet =====
        const summarySheet = workbook.addWorksheet('Ringkasan', {
            properties: { tabColor: { argb: '3B82F6' } }
        });

        // Title
        summarySheet.mergeCells('A1:D1');
        summarySheet.getCell('A1').value = 'LAPORAN PENGELUARAN';
        summarySheet.getCell('A1').font = { size: 18, bold: true, color: { argb: '1E40AF' } };
        summarySheet.getCell('A1').alignment = { horizontal: 'center' };

        summarySheet.mergeCells('A2:D2');
        summarySheet.getCell('A2').value = `Dibuat: ${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;
        summarySheet.getCell('A2').font = { size: 10, color: { argb: '6B7280' } };
        summarySheet.getCell('A2').alignment = { horizontal: 'center' };

        // Summary stats
        summarySheet.getCell('A4').value = 'Total Pengeluaran';
        summarySheet.getCell('B4').value = total;
        summarySheet.getCell('B4').numFmt = '"Rp "#,##0';
        summarySheet.getCell('B4').font = { bold: true, size: 14, color: { argb: 'EF4444' } };

        summarySheet.getCell('A5').value = 'Jumlah Transaksi';
        summarySheet.getCell('B5').value = expenses.length;
        summarySheet.getCell('B5').font = { bold: true };

        // Category breakdown
        summarySheet.getCell('A7').value = 'Per Kategori';
        summarySheet.getCell('A7').font = { bold: true, size: 12 };

        const catHeaders = ['Kategori', 'Total', 'Jumlah', 'Persentase'];
        catHeaders.forEach((h, i) => {
            const cell = summarySheet.getCell(8, i + 1);
            cell.value = h;
            cell.font = { bold: true, color: { argb: 'FFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '3B82F6' } };
            cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
        });

        summaryData.forEach((s, idx) => {
            const row = idx + 9;
            const percent = total > 0 ? ((s.total / total) * 100) : 0;

            summarySheet.getCell(row, 1).value = s.category_name || s.category;
            summarySheet.getCell(row, 2).value = s.total;
            summarySheet.getCell(row, 2).numFmt = '"Rp "#,##0';
            summarySheet.getCell(row, 3).value = s.count;
            summarySheet.getCell(row, 4).value = percent / 100;
            summarySheet.getCell(row, 4).numFmt = '0.0%';

            // Zebra striping
            if (idx % 2 === 0) {
                for (let c = 1; c <= 4; c++) {
                    summarySheet.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
                }
            }
        });

        summarySheet.columns = [
            { width: 25 }, { width: 20 }, { width: 15 }, { width: 15 }
        ];

        // ===== Detail Sheet =====
        const detailSheet = workbook.addWorksheet('Detail Transaksi', {
            properties: { tabColor: { argb: '10B981' } }
        });

        // Headers
        const detailHeaders = ['No', 'Tanggal', 'Kategori', 'Nominal', 'Keterangan', 'User'];
        detailHeaders.forEach((h, i) => {
            const cell = detailSheet.getCell(1, i + 1);
            cell.value = h;
            cell.font = { bold: true, color: { argb: 'FFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '10B981' } };
            cell.alignment = { horizontal: 'center' };
            cell.border = { bottom: { style: 'medium' } };
        });

        // Data rows
        expenses.forEach((e, idx) => {
            const row = idx + 2;
            detailSheet.getCell(row, 1).value = idx + 1;
            detailSheet.getCell(row, 2).value = new Date(e.created_at);
            detailSheet.getCell(row, 2).numFmt = 'DD-MMM-YYYY';
            detailSheet.getCell(row, 3).value = e.category_name || e.category;
            detailSheet.getCell(row, 4).value = e.amount;
            detailSheet.getCell(row, 4).numFmt = '"Rp "#,##0';
            detailSheet.getCell(row, 4).font = { color: { argb: 'EF4444' } };
            detailSheet.getCell(row, 5).value = e.description || '-';
            detailSheet.getCell(row, 6).value = e.user_name || '-';

            // Zebra striping
            if (idx % 2 === 0) {
                for (let c = 1; c <= 6; c++) {
                    detailSheet.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F9FAFB' } };
                }
            }
        });

        detailSheet.columns = [
            { width: 6 }, { width: 15 }, { width: 20 }, { width: 18 }, { width: 35 }, { width: 15 }
        ];

        // Freeze header row
        detailSheet.views = [{ state: 'frozen', ySplit: 1 }];

        // Set response headers
        const filename = `laporan-pengeluaran-${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        logger.error('Export Excel error:', error);
        res.status(500).json({ error: 'Failed to export Excel' });
    }
});

// ===== TRANSACTION EXPORT ROUTES =====

// Export transactions to professional PDF
router.get('/transactions/export/pdf', authenticateToken, async (req, res) => {
    try {
        const PDFDocument = require('pdfkit');

        const transactions = await getAllTransactions(500);
        const stats = await getSystemStats();

        // Calculate totals
        const deposits = transactions.filter(t => t.type === 'deposit' && t.confirmed);
        const withdrawals = transactions.filter(t => t.type === 'withdrawal' && t.confirmed);
        const totalDeposit = deposits.reduce((sum, t) => sum + t.amount, 0);
        const totalWithdraw = withdrawals.reduce((sum, t) => sum + t.amount, 0);

        // Create PDF
        const doc = new PDFDocument({ margin: 50, size: 'A4' });

        const filename = `laporan-transaksi-${new Date().toISOString().slice(0, 10)}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        doc.pipe(res);

        // ===== HEADER =====
        doc.rect(0, 0, 612, 100).fill('#1e40af');
        doc.fontSize(28).fillColor('#ffffff').text('LAPORAN TRANSAKSI', 50, 35, { align: 'center' });
        doc.fontSize(11).text('Tabungan Bot - Financial Report', 50, 68, { align: 'center' });

        // Date
        doc.moveDown(4);
        doc.fontSize(10).fillColor('#6b7280').text(`Tanggal: ${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`, { align: 'right' });

        // ===== SUMMARY CARDS =====
        doc.moveDown(1);
        const cardY = doc.y;

        // Card 1: Total Saldo
        doc.rect(50, cardY, 160, 70).fill('#f0fdf4').stroke('#22c55e');
        doc.fontSize(10).fillColor('#166534').text('TOTAL SALDO', 60, cardY + 12);
        doc.fontSize(18).fillColor('#15803d').text(`Rp ${stats.totalSavings.toLocaleString('id-ID')}`, 60, cardY + 32);

        // Card 2: Total Setoran
        doc.rect(220, cardY, 160, 70).fill('#eff6ff').stroke('#3b82f6');
        doc.fontSize(10).fillColor('#1e40af').text('TOTAL SETORAN', 230, cardY + 12);
        doc.fontSize(18).fillColor('#1d4ed8').text(`Rp ${totalDeposit.toLocaleString('id-ID')}`, 230, cardY + 32);
        doc.fontSize(9).fillColor('#6b7280').text(`${deposits.length} transaksi`, 230, cardY + 52);

        // Card 3: Total Penarikan
        doc.rect(390, cardY, 155, 70).fill('#fef2f2').stroke('#ef4444');
        doc.fontSize(10).fillColor('#991b1b').text('TOTAL PENARIKAN', 400, cardY + 12);
        doc.fontSize(18).fillColor('#dc2626').text(`Rp ${totalWithdraw.toLocaleString('id-ID')}`, 400, cardY + 32);
        doc.fontSize(9).fillColor('#6b7280').text(`${withdrawals.length} transaksi`, 400, cardY + 52);

        doc.y = cardY + 90;

        // ===== STATS ROW =====
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#374151');
        doc.text(`Total User: ${stats.totalUsers}  |  Total Transaksi: ${stats.totalTransactions}  |  Target Aktif: ${stats.activeGoals}`, { align: 'center' });

        // Divider
        doc.moveDown(1);
        doc.strokeColor('#e5e7eb').lineWidth(2).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(1);

        // ===== TRANSACTION TABLE =====
        doc.fontSize(14).fillColor('#1f2937').text('RIWAYAT TRANSAKSI', { underline: true });
        doc.moveDown(0.5);

        // Table header
        const tableTop = doc.y;
        const colWidths = [35, 80, 95, 85, 70, 65, 65];
        const headers = ['No', 'Tanggal', 'User', 'Metode', 'Tipe', 'Jumlah', 'Status'];

        doc.fontSize(9).fillColor('#ffffff');
        doc.rect(50, tableTop, 495, 22).fill('#1e40af');

        let headerX = 55;
        headers.forEach((h, i) => {
            doc.text(h, headerX, tableTop + 7, { width: colWidths[i] - 5, align: 'center' });
            headerX += colWidths[i];
        });

        // Table rows
        let y = tableTop + 28;
        doc.fillColor('#374151');

        transactions.slice(0, 35).forEach((t, idx) => {
            if (y > 750) {
                doc.addPage();
                y = 50;
            }

            const bgColor = idx % 2 === 0 ? '#f8fafc' : '#ffffff';
            doc.rect(50, y - 3, 495, 20).fill(bgColor);

            const date = new Date(t.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
            const typeIcon = t.type === 'deposit' ? '+' : '-';
            const typeColor = t.type === 'deposit' ? '#22c55e' : '#ef4444';
            const statusBg = t.status === 'success' ? '#dcfce7' : (t.status === 'pending' ? '#fef9c3' : '#fee2e2');

            doc.fontSize(8);
            let rowX = 55;

            // No
            doc.fillColor('#374151').text(String(idx + 1), rowX, y, { width: colWidths[0] - 5, align: 'center' });
            rowX += colWidths[0];

            // Date
            doc.text(date.slice(0, 12), rowX, y, { width: colWidths[1] - 5 });
            rowX += colWidths[1];

            // User
            doc.text((t.user_name || '-').slice(0, 12), rowX, y, { width: colWidths[2] - 5 });
            rowX += colWidths[2];

            // Method
            doc.text((t.payment_method || '-').slice(0, 10), rowX, y, { width: colWidths[3] - 5 });
            rowX += colWidths[3];

            // Type
            doc.fillColor(typeColor).text(`${typeIcon} ${t.type === 'deposit' ? 'Setor' : 'Tarik'}`, rowX, y, { width: colWidths[4] - 5 });
            rowX += colWidths[4];

            // Amount
            doc.fillColor(typeColor).text(`Rp ${t.amount.toLocaleString('id-ID')}`, rowX, y, { width: colWidths[5] - 5 });
            rowX += colWidths[5];

            // Status
            doc.fillColor('#374151').text(t.status || '-', rowX, y, { width: colWidths[6] - 5 });

            y += 20;
        });

        // Footer
        doc.fontSize(8).fillColor('#9ca3af').text('Generated by Tabungan Bot © 2026', 50, 780, { align: 'center' });

        doc.end();

    } catch (error) {
        logger.error('Export transactions PDF error:', error);
        res.status(500).json({ error: 'Failed to export PDF' });
    }
});

// Export transactions to Excel
router.get('/transactions/export/excel', authenticateToken, async (req, res) => {
    try {
        const ExcelJS = require('exceljs');

        const transactions = await getAllTransactions(500);
        const stats = await getSystemStats();

        const deposits = transactions.filter(t => t.type === 'deposit' && t.confirmed);
        const withdrawals = transactions.filter(t => t.type === 'withdrawal' && t.confirmed);
        const totalDeposit = deposits.reduce((sum, t) => sum + t.amount, 0);
        const totalWithdraw = withdrawals.reduce((sum, t) => sum + t.amount, 0);

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Tabungan Bot';
        workbook.created = new Date();

        // ===== Summary Sheet =====
        const summarySheet = workbook.addWorksheet('Ringkasan', {
            properties: { tabColor: { argb: '1E40AF' } }
        });

        // Title
        summarySheet.mergeCells('A1:E1');
        summarySheet.getCell('A1').value = '📊 LAPORAN TRANSAKSI';
        summarySheet.getCell('A1').font = { size: 20, bold: true, color: { argb: '1E40AF' } };
        summarySheet.getCell('A1').alignment = { horizontal: 'center' };

        summarySheet.mergeCells('A2:E2');
        summarySheet.getCell('A2').value = `Dibuat: ${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;
        summarySheet.getCell('A2').font = { size: 10, color: { argb: '6B7280' } };
        summarySheet.getCell('A2').alignment = { horizontal: 'center' };

        // Summary stats
        summarySheet.getCell('A4').value = '💰 Total Saldo';
        summarySheet.getCell('A4').font = { bold: true };
        summarySheet.getCell('B4').value = stats.totalSavings;
        summarySheet.getCell('B4').numFmt = '"Rp "#,##0';
        summarySheet.getCell('B4').font = { bold: true, size: 14, color: { argb: '22C55E' } };

        summarySheet.getCell('A5').value = '⬆️ Total Setoran';
        summarySheet.getCell('B5').value = totalDeposit;
        summarySheet.getCell('B5').numFmt = '"Rp "#,##0';
        summarySheet.getCell('B5').font = { color: { argb: '3B82F6' } };
        summarySheet.getCell('C5').value = `${deposits.length} transaksi`;

        summarySheet.getCell('A6').value = '⬇️ Total Penarikan';
        summarySheet.getCell('B6').value = totalWithdraw;
        summarySheet.getCell('B6').numFmt = '"Rp "#,##0';
        summarySheet.getCell('B6').font = { color: { argb: 'EF4444' } };
        summarySheet.getCell('C6').value = `${withdrawals.length} transaksi`;

        summarySheet.getCell('A8').value = '📊 Total User';
        summarySheet.getCell('B8').value = stats.totalUsers;

        summarySheet.getCell('A9').value = '📝 Total Transaksi';
        summarySheet.getCell('B9').value = stats.totalTransactions;

        summarySheet.columns = [{ width: 25 }, { width: 22 }, { width: 18 }, { width: 15 }, { width: 15 }];

        // ===== Detail Sheet =====
        const detailSheet = workbook.addWorksheet('Detail Transaksi', {
            properties: { tabColor: { argb: '22C55E' } }
        });

        // Headers
        const headers = ['No', 'ID', 'Tanggal', 'User', 'No. HP', 'Metode', 'Tipe', 'Jumlah', 'Status'];
        headers.forEach((h, i) => {
            const cell = detailSheet.getCell(1, i + 1);
            cell.value = h;
            cell.font = { bold: true, color: { argb: 'FFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E40AF' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = { bottom: { style: 'medium' } };
        });
        detailSheet.getRow(1).height = 25;

        // Data rows
        transactions.forEach((t, idx) => {
            const row = idx + 2;

            detailSheet.getCell(row, 1).value = idx + 1;
            detailSheet.getCell(row, 1).alignment = { horizontal: 'center' };

            detailSheet.getCell(row, 2).value = t.id;

            detailSheet.getCell(row, 3).value = new Date(t.created_at);
            detailSheet.getCell(row, 3).numFmt = 'DD-MMM-YYYY HH:MM';

            detailSheet.getCell(row, 4).value = t.user_name || '-';
            detailSheet.getCell(row, 5).value = t.phone_number || '-';
            detailSheet.getCell(row, 6).value = t.payment_method || '-';

            detailSheet.getCell(row, 7).value = t.type === 'deposit' ? '⬆️ Setoran' : '⬇️ Penarikan';
            detailSheet.getCell(row, 7).font = { color: { argb: t.type === 'deposit' ? '22C55E' : 'EF4444' } };

            detailSheet.getCell(row, 8).value = t.amount;
            detailSheet.getCell(row, 8).numFmt = '"Rp "#,##0';
            detailSheet.getCell(row, 8).font = { bold: true, color: { argb: t.type === 'deposit' ? '22C55E' : 'EF4444' } };

            detailSheet.getCell(row, 9).value = t.status || '-';
            if (t.status === 'success') {
                detailSheet.getCell(row, 9).font = { color: { argb: '22C55E' } };
            } else if (t.status === 'pending') {
                detailSheet.getCell(row, 9).font = { color: { argb: 'F59E0B' } };
            }

            // Zebra striping
            if (idx % 2 === 0) {
                for (let c = 1; c <= 9; c++) {
                    detailSheet.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
                }
            }
        });

        detailSheet.columns = [
            { width: 6 }, { width: 8 }, { width: 18 }, { width: 18 }, { width: 16 },
            { width: 14 }, { width: 14 }, { width: 18 }, { width: 12 }
        ];

        // Freeze header
        detailSheet.views = [{ state: 'frozen', ySplit: 1 }];

        // Response
        const filename = `laporan-transaksi-${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        logger.error('Export transactions Excel error:', error);
        res.status(500).json({ error: 'Failed to export Excel' });
    }
});

module.exports = router;