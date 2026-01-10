const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(process.env.DB_PATH || './data/database.sqlite');
const db = new sqlite3.Database(dbPath);

// Helper to find partner user
function findPartnerUser(userId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT u2.id as partner_id 
             FROM users u1 
             LEFT JOIN users u2 ON u1.partner_phone = u2.phone_number 
             WHERE u1.id = ?`,
            [userId],
            (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.partner_id : null);
            }
        );
    });
}

function setGoal(userId, goalData) {
    return new Promise(async (resolve, reject) => {
        try {
            const { title, target_amount, target_date, reminder_frequency } = goalData;
            
            // Find partner user if exists
            const partnerUserId = await findPartnerUser(userId);
            
            db.get(
                'SELECT id FROM goals WHERE user_id = ? AND title = ?',
                [userId, title],
                (err, existing) => {
                    if (err) return reject(err);
                    
                    if (existing) {
                        db.run(
                            'UPDATE goals SET target_amount = ?, target_date = ?, reminder_frequency = ?, partner_user_id = ? WHERE id = ?',
                            [target_amount, target_date || null, reminder_frequency || 'weekly', partnerUserId, existing.id],
                            function(err) {
                                if (err) reject(err);
                                else resolve({ id: existing.id, ...goalData, partner_user_id: partnerUserId, updated: true });
                            }
                        );
                    } else {
                        db.run(
                            'INSERT INTO goals (user_id, partner_user_id, title, target_amount, current_amount, target_date, reminder_frequency) VALUES (?, ?, ?, ?, 0, ?, ?)',
                            [userId, partnerUserId, title, target_amount, target_date || null, reminder_frequency || 'weekly'],
                            function(err) {
                                if (err) reject(err);
                                else resolve({ id: this.lastID, ...goalData, partner_user_id: partnerUserId });
                            }
                        );
                    }
                }
            );
        } catch (error) {
            reject(error);
        }
    });
}

function getGoals(userId) {
    return new Promise((resolve, reject) => {
        // Get goals where user is either owner or partner, with combined balance
        const query = `
            SELECT g.*, 
                   u1.name as owner_name,
                   u2.name as partner_name,
                   COALESCE(
                       (SELECT SUM(CASE WHEN t.type = 'deposit' THEN t.amount ELSE -t.amount END) 
                        FROM transactions t 
                        WHERE t.confirmed = 1 
                        AND (t.user_id = g.user_id OR t.user_id = g.partner_user_id)
                       ), 0
                   ) as current_amount
            FROM goals g 
            LEFT JOIN users u1 ON g.user_id = u1.id
            LEFT JOIN users u2 ON g.partner_user_id = u2.id
            WHERE g.user_id = ? OR g.partner_user_id = ?
            ORDER BY g.created_at DESC
        `;
        db.all(query, [userId, userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function getAllGoalsWithProgress() {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT g.*, 
                   u1.name as user_name,
                   u2.name as partner_name,
                   COALESCE(
                       (SELECT SUM(CASE WHEN t.type = 'deposit' THEN t.amount ELSE -t.amount END) 
                        FROM transactions t 
                        WHERE t.confirmed = 1 
                        AND (t.user_id = g.user_id OR t.user_id = g.partner_user_id)
                       ), 0
                   ) as current_amount
            FROM goals g 
            LEFT JOIN users u1 ON g.user_id = u1.id
            LEFT JOIN users u2 ON g.partner_user_id = u2.id
            ORDER BY g.created_at DESC 
            LIMIT 10
        `;
        db.all(query, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function deleteGoal(goalId) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM goals WHERE id = ?', [goalId], function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

let waClient = null;

function setReminderClient(client) {
    waClient = client;
}

async function sendScheduledReminders() {
    const { getActiveReminders, updateReminderLastSent, getBalance } = require('../database/models');
    
    try {
        const reminders = await getActiveReminders();
        const now = new Date();
        const currentTime = now.toTimeString().slice(0, 5);
        const currentDay = now.getDay();
        const currentDate = now.getDate();
        
        for (const reminder of reminders) {
            const sendTime = reminder.send_time || '09:00';
            if (currentTime !== sendTime) continue;
            
            const lastSent = reminder.last_sent ? new Date(reminder.last_sent) : null;
            let shouldSend = false;
            
            if (reminder.frequency === 'daily') {
                shouldSend = !lastSent || lastSent.toDateString() !== now.toDateString();
            } else if (reminder.frequency === 'weekly') {
                if (currentDay === 1) {
                    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    shouldSend = !lastSent || lastSent < weekAgo;
                }
            } else if (reminder.frequency === 'monthly') {
                if (currentDate === 1) {
                    shouldSend = !lastSent || lastSent.getMonth() !== now.getMonth();
                }
            }
            
            if (!shouldSend) continue;
            
            const balance = await getBalance(reminder.user_id);
            let message = reminder.custom_message;
            if (!message) {
                message = '⏰ *REMINDER MENABUNG*\n\n' +
                         'Hai ' + (reminder.user_name || 'Sahabat') + '! 👋\n\n' +
                         '💰 Saldo: Rp ' + balance.toLocaleString('id-ID') + '\n\n' +
                         'Jangan lupa menabung!\nKetik /nabung [nominal]\n\nSemangat! 💪';
            }
            // Replace variables
            message = message.replace(/{name}/g, reminder.user_name || 'User');
            message = message.replace(/{saldo}/g, 'Rp ' + balance.toLocaleString('id-ID'));
            
            if (waClient && reminder.phone_number) {
                try {
                    const { isReady, safeSendMessage } = require('../bot/whatsapp');
                    if (!isReady()) {
                        console.warn('WhatsApp client not ready, skipping reminder');
                        continue;
                    }
                    const contactId = await waClient.getNumberId(reminder.phone_number);
                    const chatId = contactId ? contactId._serialized : reminder.phone_number + '@c.us';
                    await safeSendMessage(chatId, message);
                    await updateReminderLastSent(reminder.id);
                    console.log('Reminder sent to:', reminder.phone_number);
                } catch (e) {
                    console.error('Failed to send reminder:', e.message);
                }
            }
        }
    } catch (error) {
        console.error('Error in sendScheduledReminders:', error);
    }
}

function startReminderService() {
    console.log('Reminder service started');
    cron.schedule('* * * * *', () => {
        sendScheduledReminders();
    });
}

module.exports = { setGoal, getGoals, getAllGoalsWithProgress, deleteGoal, startReminderService, setReminderClient };
