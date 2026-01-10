const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cron = require('node-cron');

const dbPath = path.resolve(process.env.DB_PATH || './data/database.sqlite');
const db = new sqlite3.Database(dbPath);

const FINANCIAL_TIPS = [
    'Sisihkan minimal 20% dari pendapatan untuk tabungan sebelum digunakan untuk hal lain.',
    'Gunakan aturan 50/30/20: 50% kebutuhan, 30% keinginan, 20% tabungan.',
    'Hindari utang konsumtif. Cicilan sebaiknya tidak lebih dari 30% pendapatan.',
    'Buat dana darurat minimal 3-6 bulan pengeluaran bulanan.',
    'Catat semua pengeluaran harian untuk mengetahui ke mana uang pergi.',
    'Tunggu 24 jam sebelum membeli barang non-esensial untuk hindari impulse buying.',
    'Bandingkan harga di beberapa tempat sebelum membeli barang besar.',
    'Manfaatkan promo dan diskon dengan bijak, jangan beli hanya karena diskon.',
    'Bawa bekal dari rumah untuk hemat pengeluaran makan siang.',
    'Gunakan transportasi umum atau carpool untuk hemat biaya transportasi.',
    'Batasi langganan streaming/apps yang jarang dipakai.',
    'Masak di rumah lebih sering daripada makan di luar.',
    'Review tagihan bulanan dan cari yang bisa dikurangi.',
    'Investasikan uang daripada hanya ditabung agar berkembang.',
    'Mulai investasi dari nominal kecil, yang penting konsisten.',
    'Pelajari literasi keuangan melalui buku, podcast, atau YouTube.',
    'Set target tabungan yang spesifik dan terukur.',
    'Gunakan auto-debit untuk tabungan agar tidak lupa.',
    'Hindari gaya hidup boros yang mengikuti tren.',
    'Beli berdasarkan kebutuhan, bukan keinginan sesaat.',
    'Simpan bonus atau THR minimal 50% untuk tabungan.',
    'Cari sumber penghasilan tambahan jika memungkinkan.',
    'Review dan evaluasi keuangan setiap bulan.',
    'Jangan malu untuk menabung dalam nominal kecil. Konsistensi lebih penting!',
    'Nabung itu bukan soal berapa besar, tapi seberapa rutin.',
    'Uang yang tidak terlihat cenderung tidak dibelanjakan. Pisahkan tabungan.',
    'Buat wishlist dan prioritaskan mana yang benar-benar dibutuhkan.',
    'Hindari FOMO (Fear Of Missing Out) dalam pengeluaran.',
    'Quality over quantity - lebih baik sedikit tapi berkualitas.',
    'Jangan lupa sisihkan untuk asuransi kesehatan dan proteksi diri.'
];

function getRandomTip() {
    return new Promise((resolve) => {
        const randomIndex = Math.floor(Math.random() * FINANCIAL_TIPS.length);
        resolve(FINANCIAL_TIPS[randomIndex]);
    });
}

async function checkMilestones(userId, goals, currentBalance) {
    const messages = [];
    const milestones = [25, 50, 75, 100];
    
    for (const goal of goals) {
        const progress = goal.target_amount > 0 
            ? Math.floor((currentBalance / goal.target_amount) * 100) 
            : 0;
        
        for (const milestone of milestones) {
            if (progress >= milestone) {
                const alreadyNotified = await checkMilestoneNotified(userId, goal.id, milestone);
                
                if (!alreadyNotified) {
                    await recordMilestoneNotification(userId, goal.id, milestone);
                    
                    let msg = '';
                    if (milestone === 100) {
                        msg = '🎉🎊 *SELAMAT! TARGET TERCAPAI!* 🎊🎉\n\n';
                        msg += '🏆 Goal: *' + goal.title + '*\n';
                        msg += '💰 Target: Rp ' + goal.target_amount.toLocaleString('id-ID') + '\n';
                        msg += '✅ Progress: 100%\n\n';
                        msg += 'Luar biasa! Kamu berhasil mencapai targetmu! 🌟\n';
                        msg += 'Set target baru dengan /goal untuk terus berkembang!';
                    } else {
                        msg = '🎯 *MILESTONE ' + milestone + '% TERCAPAI!*\n\n';
                        msg += '📌 Goal: *' + goal.title + '*\n';
                        msg += '💰 Target: Rp ' + goal.target_amount.toLocaleString('id-ID') + '\n';
                        msg += '📊 Progress: ' + progress + '%\n';
                        msg += '💵 Terkumpul: Rp ' + currentBalance.toLocaleString('id-ID') + '\n\n';
                        
                        if (milestone === 25) {
                            msg += 'Awal yang bagus! Terus semangat! 💪';
                        } else if (milestone === 50) {
                            msg += 'Sudah setengah jalan! Kamu keren! 🌟';
                        } else if (milestone === 75) {
                            msg += 'Hampir sampai! Sedikit lagi! 🔥';
                        }
                    }
                    
                    messages.push(msg);
                }
            }
        }
    }
    
    return messages;
}

function checkMilestoneNotified(userId, goalId, milestonePercent) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT id FROM milestone_notifications WHERE user_id = ? AND goal_id = ? AND milestone_percent = ?',
            [userId, goalId, milestonePercent],
            (err, row) => {
                if (err) reject(err);
                else resolve(!!row);
            }
        );
    });
}

function recordMilestoneNotification(userId, goalId, milestonePercent) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT OR IGNORE INTO milestone_notifications (user_id, goal_id, milestone_percent) VALUES (?, ?, ?)',
            [userId, goalId, milestonePercent],
            function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
}

async function generateWeeklyReport(userId) {
    return new Promise((resolve, reject) => {
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        const query = `
            SELECT 
                u.name,
                u.phone_number,
                COALESCE(SUM(CASE WHEN t.type = 'deposit' AND t.confirmed = 1 THEN t.amount ELSE 0 END), 0) as week_deposits,
                COALESCE(SUM(CASE WHEN t.type = 'withdrawal' AND t.confirmed = 1 THEN t.amount ELSE 0 END), 0) as week_withdrawals,
                COUNT(CASE WHEN t.type = 'deposit' AND t.confirmed = 1 THEN 1 END) as deposit_count,
                (SELECT COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE -amount END), 0) 
                 FROM transactions WHERE user_id = ? AND confirmed = 1) as total_balance
            FROM users u
            LEFT JOIN transactions t ON t.user_id = u.id 
                AND t.created_at >= ?
                AND t.created_at <= ?
            WHERE u.id = ?
            GROUP BY u.id
        `;
        
        db.get(query, [userId, weekAgo.toISOString(), now.toISOString(), userId], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(null);
            
            const twoWeeksAgo = new Date(weekAgo.getTime() - 7 * 24 * 60 * 60 * 1000);
            
            db.get(`
                SELECT COALESCE(SUM(CASE WHEN type = 'deposit' AND confirmed = 1 THEN amount ELSE 0 END), 0) as prev_week_deposits
                FROM transactions 
                WHERE user_id = ? 
                AND created_at >= ?
                AND created_at < ?
            `, [userId, twoWeeksAgo.toISOString(), weekAgo.toISOString()], (err2, prevRow) => {
                if (err2) return reject(err2);
                
                const prevWeekDeposits = prevRow ? prevRow.prev_week_deposits : 0;
                const comparison = row.week_deposits - prevWeekDeposits;
                const comparisonPercent = prevWeekDeposits > 0 
                    ? Math.round((comparison / prevWeekDeposits) * 100) 
                    : (row.week_deposits > 0 ? 100 : 0);
                
                resolve({
                    name: row.name,
                    phone_number: row.phone_number,
                    weekDeposits: row.week_deposits,
                    weekWithdrawals: row.week_withdrawals,
                    depositCount: row.deposit_count,
                    totalBalance: row.total_balance,
                    comparison: comparison,
                    comparisonPercent: comparisonPercent
                });
            });
        });
    });
}

function formatWeeklyReportMessage(report) {
    let msg = '📊 *LAPORAN MINGGUAN*\n';
    msg += '━━━━━━━━━━━━━━━━\n\n';
    msg += '👤 Hai ' + (report.name || 'Sahabat') + '!\n\n';
    msg += '📅 Ringkasan 7 hari terakhir:\n\n';
    msg += '💰 Total Menabung: Rp ' + report.weekDeposits.toLocaleString('id-ID') + '\n';
    msg += '📝 Jumlah Transaksi: ' + report.depositCount + 'x\n';
    
    if (report.weekWithdrawals > 0) {
        msg += '💸 Total Penarikan: Rp ' + report.weekWithdrawals.toLocaleString('id-ID') + '\n';
    }
    
    msg += '\n📈 *Perbandingan Minggu Lalu:*\n';
    if (report.comparison > 0) {
        msg += '✅ Naik ' + report.comparisonPercent + '% (+Rp ' + report.comparison.toLocaleString('id-ID') + ')\n';
        msg += '🎉 Keren! Terus tingkatkan!\n';
    } else if (report.comparison < 0) {
        msg += '📉 Turun ' + Math.abs(report.comparisonPercent) + '% (-Rp ' + Math.abs(report.comparison).toLocaleString('id-ID') + ')\n';
        msg += '💪 Semangat! Minggu ini bisa lebih baik!\n';
    } else {
        msg += '➡️ Sama dengan minggu lalu\n';
        msg += '📌 Coba tingkatkan lagi ya!\n';
    }
    
    msg += '\n💵 *Saldo Saat Ini:*\n';
    msg += 'Rp ' + report.totalBalance.toLocaleString('id-ID') + '\n\n';
    msg += '━━━━━━━━━━━━━━━━\n';
    msg += '🎯 Tetap konsisten menabung!';
    
    return msg;
}

function getAllUsersForWeeklyReport() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT DISTINCT u.id, u.phone_number, u.name 
             FROM users u 
             WHERE u.is_logged_in = 1 OR EXISTS (
                 SELECT 1 FROM transactions t WHERE t.user_id = u.id AND t.confirmed = 1
             )`,
            [],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });
}

let weeklyReportClient = null;

function setWeeklyReportClient(client) {
    weeklyReportClient = client;
}

async function sendWeeklyReports() {
    if (!weeklyReportClient) {
        console.log('Weekly report client not set');
        return;
    }
    
    try {
        const { isReady, safeSendMessage } = require('../bot/whatsapp');
        if (!isReady()) {
            console.warn('WhatsApp client not ready, skipping weekly reports');
            return;
        }
        
        const users = await getAllUsersForWeeklyReport();
        console.log('Sending weekly reports to ' + users.length + ' users...');
        
        for (const user of users) {
            try {
                const report = await generateWeeklyReport(user.id);
                if (report && report.phone_number) {
                    const message = formatWeeklyReportMessage(report);
                    const chatId = report.phone_number + '@c.us';
                    await safeSendMessage(chatId, message);
                    console.log('Weekly report sent to:', report.phone_number);
                }
            } catch (e) {
                console.error('Failed to send weekly report to user ' + user.id + ':', e.message);
            }
        }
    } catch (error) {
        console.error('Error in sendWeeklyReports:', error);
    }
}

let dailyTipsClient = null;

function setDailyTipsClient(client) {
    dailyTipsClient = client;
}

async function sendDailyTips() {
    if (!dailyTipsClient) {
        console.log('Daily tips client not set');
        return;
    }
    
    try {
        const { isReady, safeSendMessage } = require('../bot/whatsapp');
        if (!isReady()) {
            console.warn('WhatsApp client not ready, skipping daily tips');
            return;
        }
        
        const users = await getAllUsersForWeeklyReport();
        const tip = await getRandomTip();
        
        console.log('Sending daily tips to ' + users.length + ' users...');
        
        for (const user of users) {
            try {
                if (user.phone_number) {
                    let msg = '💡 *TIPS KEUANGAN HARI INI*\n';
                    msg += '━━━━━━━━━━━━━━━━\n\n';
                    msg += '📌 ' + tip + '\n\n';
                    msg += '━━━━━━━━━━━━━━━━\n';
                    msg += '🎯 Selamat beraktivitas!';
                    
                    const chatId = user.phone_number + '@c.us';
                    await safeSendMessage(chatId, msg);
                }
            } catch (e) {
                console.error('Failed to send daily tip to user ' + user.id + ':', e.message);
            }
        }
    } catch (error) {
        console.error('Error in sendDailyTips:', error);
    }
}

function startWeeklyReportScheduler() {
    cron.schedule('0 8 * * 0', () => {
        console.log('Running weekly report scheduler...');
        sendWeeklyReports();
    });
    console.log('📊 Weekly report scheduler started (Minggu jam 08:00)');
}

function startDailyTipsScheduler() {
    cron.schedule('0 7 * * *', () => {
        console.log('Running daily tips scheduler...');
        sendDailyTips();
    });
    console.log('💡 Daily tips scheduler started (setiap hari jam 07:00)');
}

module.exports = {
    getRandomTip,
    checkMilestones,
    generateWeeklyReport,
    formatWeeklyReportMessage,
    setWeeklyReportClient,
    setDailyTipsClient,
    startWeeklyReportScheduler,
    startDailyTipsScheduler,
    sendWeeklyReports,
    sendDailyTips
};