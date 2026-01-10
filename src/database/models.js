const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

const dbPath = path.resolve(process.env.DB_PATH || './data/database.sqlite');
const db = new sqlite3.Database(dbPath);

function getUserByPhone(phoneNumber) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE phone_number = ?', [phoneNumber], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function createUser(userData) {
    return new Promise((resolve, reject) => {
        const { phone_number, name, partner_phone } = userData;
        db.run(
            'INSERT INTO users (phone_number, name, partner_phone) VALUES (?, ?, ?)',
            [phone_number, name, partner_phone],
            function (err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, ...userData });
            }
        );
    });
}

function getBalance(userId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE -amount END), 0) as balance 
             FROM transactions WHERE user_id = ? AND confirmed = 1`,
            [userId],
            (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.balance : 0);
            }
        );
    });
}

function getTransactionHistory(userId, limit = 10) {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
            [userId, limit],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

function createTransaction(transData) {
    return new Promise((resolve, reject) => {
        const { user_id, amount, type, payment_method, confirmed, qris_id, message_id } = transData;
        const status = transData.status || (confirmed ? 'success' : 'pending');

        db.run(
            `INSERT INTO transactions (user_id, amount, type, payment_method, confirmed, qris_id, status, message_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user_id, amount, type, payment_method, confirmed || false, qris_id, status, message_id || null],
            function (err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, status, ...transData });
            }
        );
    });
}

function cancelTransaction(userId, transactionId = null) {
    return new Promise((resolve, reject) => {
        let query = "UPDATE transactions SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'";
        let params = [userId];

        if (transactionId) {
            query += " AND id = ?";
            params.push(transactionId);
        }

        db.run(query, params, function (err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

function expireOldTransactions(timeoutMinutes = 60) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE transactions SET status = 'expired' 
             WHERE status = 'pending' AND created_at < datetime('now', '-' || ? || ' minutes')`,
            [timeoutMinutes],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}


function getExpiredPendingTransactions(timeoutMinutes = 5) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT * FROM transactions 
             WHERE status = 'pending' AND created_at < datetime('now', '-' || ? || ' minutes')`,
            [timeoutMinutes],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

function markAsExpired(ids) {
    if (!ids || ids.length === 0) return Promise.resolve(0);
    return new Promise((resolve, reject) => {
        const placeholders = ids.map(() => '?').join(',');
        db.run(
            `UPDATE transactions SET status = 'expired' WHERE id IN (${placeholders})`,
            ids,
            function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}


function updateTransactionMessageId(transactionId, messageId) {
    return new Promise((resolve, reject) => {
        db.run(
            "UPDATE transactions SET message_id = ? WHERE id = ?",
            [messageId, transactionId],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}


function getUserById(userId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}


function getSystemStats() {
    return new Promise((resolve, reject) => {
        const stats = {
            totalUsers: 0,
            totalSavings: 0,
            totalTransactions: 0,
            activeGoals: 0
        };

        // Run queries in parallel logic (but sqlite is sequential usually)
        db.serialize(() => {
            db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
                if (!err && row) stats.totalUsers = row.count;
            });

            db.get("SELECT COUNT(*) as count FROM transactions", (err, row) => {
                if (!err && row) stats.totalTransactions = row.count;
            });

            db.get("SELECT COUNT(*) as count FROM goals WHERE current_amount < target_amount", (err, row) => {
                if (!err && row) stats.activeGoals = row.count;
            });

            db.get("SELECT SUM(CASE WHEN type = 'deposit' THEN amount ELSE -amount END) as total FROM transactions WHERE confirmed = 1", (err, row) => {
                if (!err && row) stats.totalSavings = row.total || 0;
                resolve(stats);
            });
        });
    });
}

function getAllTransactions(limit = 100) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT t.*, u.name as user_name, u.phone_number 
            FROM transactions t 
            LEFT JOIN users u ON t.user_id = u.id 
            ORDER BY t.created_at DESC 
            LIMIT ?
        `;

        db.all(query, [limit], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}


function getFinancialAnalysis() {
    return new Promise((resolve, reject) => {
        const analysis = {
            monthly: [],
            paymentMethods: [],
            goalProgress: []
        };

        db.serialize(() => {
            // 1. Monthly Income vs Expense (Last 6 months)
            // Using strftime for sqlite to group by Month-Year
            const monthlyQuery = `
                SELECT 
                    strftime('%Y-%m', created_at) as month,
                    SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) as income,
                    SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END) as expense
                FROM transactions 
                WHERE confirmed = 1 
                GROUP BY month 
                ORDER BY month DESC 
                LIMIT 6
            `;

            db.all(monthlyQuery, (err, rows) => {
                if (!err) analysis.monthly = rows ? rows.reverse() : [];
            });

            // 2. Payment Method Distribution
            const methodQuery = `
                SELECT payment_method, COUNT(*) as count 
                FROM transactions 
                WHERE confirmed = 1 
                GROUP BY payment_method
            `;

            db.all(methodQuery, (err, rows) => {
                if (!err) analysis.paymentMethods = rows || [];
            });

            // 3. Goal Progress - Calculate current_amount dynamically from both user and partner balance
            const goalQuery = `
                SELECT g.id, g.title, g.target_amount, g.user_id, g.partner_user_id,
                       u1.name as user_name, u2.name as partner_name,
                       COALESCE((SELECT SUM(CASE WHEN t.type = 'deposit' THEN t.amount ELSE -t.amount END) 
                                 FROM transactions t 
                                 WHERE t.confirmed = 1 
                                 AND (t.user_id = g.user_id OR t.user_id = g.partner_user_id)), 0) as current_amount
                FROM goals g 
                LEFT JOIN users u1 ON g.user_id = u1.id
                LEFT JOIN users u2 ON g.partner_user_id = u2.id
                ORDER BY g.created_at DESC 
                LIMIT 10
            `;

            db.all(goalQuery, (err, rows) => {
                if (!err) {
                    analysis.goalProgress = rows || [];
                }
                resolve(analysis);
            });
        });
    });
}


function updateTransactionStatus(transactionId, status) {
    return new Promise((resolve, reject) => {
        const confirmed = status === 'success' ? 1 : 0;
        db.run(
            "UPDATE transactions SET status = ?, confirmed = ? WHERE id = ?",
            [status, confirmed, transactionId],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}


function getTransactionById(id) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM transactions WHERE id = ?', [id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}


function updateTransactionScreenshot(transactionId, screenshotPath) {
    return new Promise((resolve, reject) => {
        db.run(
            "UPDATE transactions SET screenshot_path = ? WHERE id = ?",
            [screenshotPath, transactionId],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}

function getAllUsers() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT u.*, 
                    COALESCE(SUM(CASE WHEN t.type = 'deposit' AND t.confirmed = 1 THEN t.amount 
                                      WHEN t.type = 'withdraw' AND t.confirmed = 1 THEN -t.amount 
                                      ELSE 0 END), 0) as balance,
                    COUNT(t.id) as total_transactions
             FROM users u
             LEFT JOIN transactions t ON u.id = t.user_id
             GROUP BY u.id
             ORDER BY u.created_at DESC`,
            [],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

function updateUser(userId, data) {
    return new Promise((resolve, reject) => {
        const { name, phone_number, partner_phone, username, password, visitor_id } = data;

        // Build dynamic query based on provided fields
        let query = 'UPDATE users SET name = ?, partner_phone = ?';
        let params = [name, partner_phone];

        if (phone_number) {
            query += ', phone_number = ?';
            params.push(phone_number);
        }

        if (username !== undefined) {
            query += ', username = ?';
            params.push(username);
        }

        if (password) {
            query += ', password = ?';
            params.push(password);
        }

        if (visitor_id !== undefined) {
            query += ', visitor_id = ?';
            params.push(visitor_id);
        }

        query += ' WHERE id = ?';
        params.push(userId);

        db.run(
            query,
            params,
            function (err) {
                if (err) return reject(err);

                // Auto-sync: Update goals with partner when partner is set
                if (partner_phone) {
                    db.get(
                        'SELECT id FROM users WHERE phone_number = ?',
                        [partner_phone],
                        (err2, partnerUser) => {
                            if (!err2 && partnerUser) {
                                // Update user's goals to include this partner
                                db.run(
                                    'UPDATE goals SET partner_user_id = ? WHERE user_id = ? AND (partner_user_id IS NULL OR partner_user_id = 0)',
                                    [partnerUser.id, userId]
                                );
                                // Also update partner's goals to include this user
                                db.run(
                                    'UPDATE goals SET partner_user_id = ? WHERE user_id = ? AND (partner_user_id IS NULL OR partner_user_id = 0)',
                                    [userId, partnerUser.id]
                                );
                            }
                            resolve(this.changes);
                        }
                    );
                } else {
                    resolve(this.changes);
                }
            }
        );
    });
}

function deleteUser(userId) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM users WHERE id = ?', [userId], function (err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

function updateTransaction(transactionId, data) {
    return new Promise((resolve, reject) => {
        const { amount, type, payment_method, status } = data;
        const confirmed = status === 'success' ? 1 : 0;
        db.run(
            "UPDATE transactions SET amount = ?, type = ?, payment_method = ?, status = ?, confirmed = ? WHERE id = ?",
            [amount, type, payment_method, status, confirmed, transactionId],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}

function deleteTransaction(transactionId) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM transactions WHERE id = ?', [transactionId], function (err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

function deleteMultipleTransactions(ids) {
    if (!ids || ids.length === 0) return Promise.resolve(0);
    return new Promise((resolve, reject) => {
        const placeholders = ids.map(() => '?').join(',');
        db.run(`DELETE FROM transactions WHERE id IN (${placeholders})`, ids, function (err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

// Get user by username
function getUserByUsername(username) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// Get user by visitor_id (WhatsApp internal ID)
function getUserByVisitorId(visitorId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE visitor_id = ?', [visitorId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// Update user's visitor_id
function updateUserVisitorId(userId, visitorId) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET visitor_id = ? WHERE id = ?', [visitorId, visitorId], function (err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

// Link visitor_id to phone_number
function linkVisitorToPhone(visitorId, phoneNumber) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET visitor_id = ? WHERE phone_number = ?', [visitorId, phoneNumber], function (err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

// Register user with username and password (HASHED)
async function registerUser(phoneNumber, username, password, name) {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO users (phone_number, username, password, name, is_logged_in) VALUES (?, ?, ?, ?, 1)',
            [phoneNumber, username, hashedPassword, name],
            function (err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, phone_number: phoneNumber, username, name });
            }
        );
    });
}

// Login user (with bcrypt comparison)
async function loginUser(phoneNumber, username, password) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT * FROM users WHERE phone_number = ? AND username = ?',
            [phoneNumber, username],
            async (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);

                // Compare hashed password
                const isMatch = await bcrypt.compare(password, row.password);
                if (!isMatch) return resolve(null);

                db.run('UPDATE users SET is_logged_in = 1 WHERE id = ?', [row.id], (err2) => {
                    if (err2) reject(err2);
                    else resolve(row);
                });
            }
        );
    });
}

// Logout user
function logoutUser(phoneNumber) {
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE users SET is_logged_in = 0 WHERE phone_number = ?',
            [phoneNumber],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}

// Check if user is logged in
function isUserLoggedIn(phoneNumber) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT * FROM users WHERE phone_number = ? AND is_logged_in = 1',
            [phoneNumber],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });
}

// Update user credentials (with password hashing)
async function updateUserCredentials(userId, data) {
    const { username, password } = data;
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE users SET username = ?, password = ? WHERE id = ?',
            [username, hashedPassword, userId],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}

module.exports = {
    getUserByPhone,
    createUser,
    getBalance,
    getTransactionHistory,
    createTransaction,
    cancelTransaction,
    expireOldTransactions,
    getExpiredPendingTransactions,
    markAsExpired,
    updateTransactionMessageId,
    getUserById,
    getSystemStats,
    getAllTransactions,
    getFinancialAnalysis,
    updateTransactionStatus,
    getTransactionById,
    updateTransactionScreenshot,
    getAllUsers,
    updateUser,
    deleteUser,
    updateTransaction,
    deleteTransaction,
    deleteMultipleTransactions,
    getUserByUsername,
    getUserByVisitorId,
    updateUserVisitorId,
    linkVisitorToPhone,
    registerUser,
    loginUser,
    logoutUser,
    isUserLoggedIn,
    updateUserCredentials,
    // Withdrawal functions
    createWithdrawal,
    getWithdrawalsByUser,
    getAllWithdrawals,
    getWithdrawalById,
    updateWithdrawalStatus,
    getPendingWithdrawalsCount,
    // Reminder functions
    createReminder,
    getAllReminders,
    getReminderById,
    updateReminder,
    deleteReminder,
    getActiveReminders,
    updateReminderLastSent,
    // Expense functions
    createExpense,
    getExpenses,
    getExpensesSummary,
    getTotalExpenses,
    getExpenseCategories,
    deleteExpense,
    getAllExpenses,
    getGlobalExpensesSummary,
    // Budget functions
    setBudget,
    getBudgets,
    getBudgetByCategory,
    checkBudgetStatus,
    deleteBudget
};

// ============ WITHDRAWAL FUNCTIONS ============

// Create new withdrawal request
function createWithdrawal(userId, amount, accountType, accountNumber, accountName) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO withdrawals (user_id, amount, account_type, account_number, account_name, status) 
             VALUES (?, ?, ?, ?, ?, 'pending')`,
            [userId, amount, accountType, accountNumber, accountName],
            function (err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, user_id: userId, amount, account_type: accountType, account_number: accountNumber, account_name: accountName, status: 'pending' });
            }
        );
    });
}

// Get withdrawals by user
function getWithdrawalsByUser(userId) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC`,
            [userId],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

// Get all withdrawals with user info
function getAllWithdrawals() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT w.*, u.name as user_name, u.phone_number,
                    (SELECT COALESCE(SUM(CASE WHEN t.type = 'deposit' AND t.confirmed = 1 THEN t.amount 
                                              WHEN t.type = 'withdrawal' AND t.confirmed = 1 THEN -t.amount 
                                              ELSE 0 END), 0) 
                     FROM transactions t WHERE t.user_id = w.user_id) as user_balance
             FROM withdrawals w
             JOIN users u ON w.user_id = u.id
             ORDER BY 
                CASE w.status WHEN 'pending' THEN 0 ELSE 1 END,
                w.created_at DESC`,
            [],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

// Get withdrawal by ID
function getWithdrawalById(withdrawalId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT w.*, u.name as user_name, u.phone_number 
             FROM withdrawals w 
             JOIN users u ON w.user_id = u.id 
             WHERE w.id = ?`,
            [withdrawalId],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });
}

// Update withdrawal status
function updateWithdrawalStatus(withdrawalId, status, adminNotes) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE withdrawals SET status = ?, admin_notes = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [status, adminNotes, withdrawalId],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}

// Get pending withdrawals count
function getPendingWithdrawalsCount() {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT COUNT(*) as count FROM withdrawals WHERE status = 'pending'`,
            [],
            (err, row) => {
                if (err) reject(err);
                else resolve(row?.count || 0);
            }
        );
    });
}

// ============ REMINDER FUNCTIONS ============

// Create new reminder
function createReminder(data) {
    return new Promise((resolve, reject) => {
        const { user_id, frequency, custom_message, is_active, send_time } = data;
        db.run(
            `INSERT INTO reminders (user_id, frequency, custom_message, is_active, send_time) 
             VALUES (?, ?, ?, ?, ?)`,
            [user_id, frequency || 'daily', custom_message || null, is_active !== false ? 1 : 0, send_time || '09:00'],
            function (err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, ...data });
            }
        );
    });
}

// Get all reminders with user info
function getAllReminders() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT r.*, u.name as user_name, u.phone_number, u.partner_phone,
                    (SELECT name FROM users WHERE phone_number = u.partner_phone) as partner_name
             FROM reminders r
             JOIN users u ON r.user_id = u.id
             ORDER BY r.created_at DESC`,
            [],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

// Get reminder by ID
function getReminderById(reminderId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT r.*, u.name as user_name, u.phone_number 
             FROM reminders r 
             JOIN users u ON r.user_id = u.id 
             WHERE r.id = ?`,
            [reminderId],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });
}

// Update reminder
function updateReminder(reminderId, data) {
    return new Promise((resolve, reject) => {
        const { frequency, custom_message, is_active, send_time } = data;
        db.run(
            `UPDATE reminders SET frequency = ?, custom_message = ?, is_active = ?, send_time = ? WHERE id = ?`,
            [frequency, custom_message, is_active ? 1 : 0, send_time, reminderId],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}

// Delete reminder
function deleteReminder(reminderId) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM reminders WHERE id = ?', [reminderId], function (err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

// Get active reminders that need to be sent
function getActiveReminders() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT r.*, u.name as user_name, u.phone_number, u.partner_phone,
                    (SELECT name FROM users WHERE phone_number = u.partner_phone) as partner_name
             FROM reminders r
             JOIN users u ON r.user_id = u.id
             WHERE r.is_active = 1
             ORDER BY r.send_time`,
            [],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

// Update reminder last_sent timestamp
function updateReminderLastSent(reminderId) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE reminders SET last_sent = CURRENT_TIMESTAMP WHERE id = ?`,
            [reminderId],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}

// ============ EXPENSE FUNCTIONS ============

// Create new expense
function createExpense(userId, amount, category, description) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO expenses (user_id, amount, category, description) VALUES (?, ?, ?, ?)`,
            [userId, amount, category.toLowerCase(), description || null],
            function (err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, user_id: userId, amount, category, description });
            }
        );
    });
}

// Get expenses by user with optional filters
function getExpenses(userId, options = {}) {
    return new Promise((resolve, reject) => {
        const { limit = 50, category, month } = options;
        let query = `SELECT e.*, ec.name as category_name, ec.icon as category_icon, ec.color as category_color 
                     FROM expenses e 
                     LEFT JOIN expense_categories ec ON e.category = ec.code 
                     WHERE e.user_id = ?`;
        let params = [userId];

        if (category) {
            query += ` AND e.category = ?`;
            params.push(category);
        }

        if (month) {
            query += ` AND strftime('%Y-%m', e.created_at) = ?`;
            params.push(month);
        }

        query += ` ORDER BY e.created_at DESC LIMIT ?`;
        params.push(limit);

        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

// Get expense summary by category for a user
function getExpensesSummary(userId, month) {
    return new Promise((resolve, reject) => {
        let query = `SELECT e.category, 
                            ec.name as category_name, 
                            ec.icon as category_icon, 
                            ec.color as category_color,
                            SUM(e.amount) as total,
                            COUNT(*) as count
                     FROM expenses e
                     LEFT JOIN expense_categories ec ON e.category = ec.code
                     WHERE e.user_id = ?`;
        let params = [userId];

        if (month) {
            query += ` AND strftime('%Y-%m', e.created_at) = ?`;
            params.push(month);
        }

        query += ` GROUP BY e.category ORDER BY total DESC`;

        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

// Get total expenses for a user
function getTotalExpenses(userId, month) {
    return new Promise((resolve, reject) => {
        let query = `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE user_id = ?`;
        let params = [userId];

        if (month) {
            query += ` AND strftime('%Y-%m', created_at) = ?`;
            params.push(month);
        }

        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.total : 0);
        });
    });
}

// Get all expense categories
function getExpenseCategories() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM expense_categories ORDER BY name`, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

// Delete expense (if userId is null, admin can delete any)
function deleteExpense(expenseId, userId) {
    return new Promise((resolve, reject) => {
        let query = `DELETE FROM expenses WHERE id = ?`;
        let params = [expenseId];

        if (userId !== null) {
            query += ` AND user_id = ?`;
            params.push(userId);
        }

        db.run(query, params, function (err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

// Get all expenses (admin)
function getAllExpenses(limit = 100) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT e.*, u.name as user_name, u.phone_number,
                    ec.name as category_name, ec.icon as category_icon, ec.color as category_color
             FROM expenses e
             LEFT JOIN users u ON e.user_id = u.id
             LEFT JOIN expense_categories ec ON e.category = ec.code
             ORDER BY e.created_at DESC
             LIMIT ?`,
            [limit],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

// Get global expense summary (admin)
function getGlobalExpensesSummary(month) {
    return new Promise((resolve, reject) => {
        let query = `SELECT e.category, 
                            ec.name as category_name, 
                            ec.icon as category_icon, 
                            ec.color as category_color,
                            SUM(e.amount) as total,
                            COUNT(*) as count,
                            COUNT(DISTINCT e.user_id) as user_count
                     FROM expenses e
                     LEFT JOIN expense_categories ec ON e.category = ec.code`;
        let params = [];

        if (month) {
            query += ` WHERE strftime('%Y-%m', e.created_at) = ?`;
            params.push(month);
        }

        query += ` GROUP BY e.category ORDER BY total DESC`;

        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

// ============ BUDGET FUNCTIONS ============

// Set or update budget for a category
function setBudget(userId, category, monthlyLimit) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO budgets (user_id, category, monthly_limit, updated_at) 
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, category) 
             DO UPDATE SET monthly_limit = ?, updated_at = CURRENT_TIMESTAMP`,
            [userId, category.toLowerCase(), monthlyLimit, monthlyLimit],
            function (err) {
                if (err) reject(err);
                else resolve({ user_id: userId, category, monthly_limit: monthlyLimit });
            }
        );
    });
}

// Get all budgets for a user
function getBudgets(userId) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT b.*, ec.name as category_name, ec.icon as category_icon
             FROM budgets b
             LEFT JOIN expense_categories ec ON b.category = ec.code
             WHERE b.user_id = ?
             ORDER BY b.category`,
            [userId],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

// Get budget for specific category
function getBudgetByCategory(userId, category) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT b.*, ec.name as category_name, ec.icon as category_icon
             FROM budgets b
             LEFT JOIN expense_categories ec ON b.category = ec.code
             WHERE b.user_id = ? AND b.category = ?`,
            [userId, category.toLowerCase()],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });
}

// Check budget status for a user (all categories with spending vs limit)
function checkBudgetStatus(userId, month) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT b.category, b.monthly_limit,
                   ec.name as category_name, ec.icon as category_icon,
                   COALESCE(SUM(e.amount), 0) as spent
            FROM budgets b
            LEFT JOIN expense_categories ec ON b.category = ec.code
            LEFT JOIN expenses e ON b.user_id = e.user_id 
                AND b.category = e.category
                AND strftime('%Y-%m', e.created_at) = ?
            WHERE b.user_id = ?
            GROUP BY b.category, b.monthly_limit
        `;
        db.all(query, [month, userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

// Delete budget
function deleteBudget(userId, category) {
    return new Promise((resolve, reject) => {
        db.run(
            `DELETE FROM budgets WHERE user_id = ? AND category = ?`,
            [userId, category.toLowerCase()],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}
