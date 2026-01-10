const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(process.env.DB_PATH || './data/database.sqlite');
const db = new sqlite3.Database(dbPath);

// Badge definitions
const BADGES = [
    // Streak badges
    { code: 'streak_7', name: 'Konsisten 7 Hari', description: 'Menabung 7 hari berturut-turut', icon: '🔥', category: 'streak', requirement_type: 'streak', requirement_value: 7 },
    { code: 'streak_30', name: 'Konsisten 30 Hari', description: 'Menabung 30 hari berturut-turut', icon: '💪', category: 'streak', requirement_type: 'streak', requirement_value: 30 },
    { code: 'streak_100', name: 'Legenda 100 Hari', description: 'Menabung 100 hari berturut-turut', icon: '👑', category: 'streak', requirement_type: 'streak', requirement_value: 100 },
    
    // Amount milestones
    { code: 'saver_100k', name: 'Penabung Pemula', description: 'Total tabungan mencapai Rp 100.000', icon: '🌱', category: 'milestone', requirement_type: 'total_amount', requirement_value: 100000 },
    { code: 'saver_500k', name: 'Penabung Aktif', description: 'Total tabungan mencapai Rp 500.000', icon: '🌿', category: 'milestone', requirement_type: 'total_amount', requirement_value: 500000 },
    { code: 'saver_1m', name: 'Jutawan Pertama', description: 'Total tabungan mencapai Rp 1.000.000', icon: '💰', category: 'milestone', requirement_type: 'total_amount', requirement_value: 1000000 },
    { code: 'saver_5m', name: 'Super Saver', description: 'Total tabungan mencapai Rp 5.000.000', icon: '💎', category: 'milestone', requirement_type: 'total_amount', requirement_value: 5000000 },
    { code: 'saver_10m', name: 'Tabungan Emas', description: 'Total tabungan mencapai Rp 10.000.000', icon: '🏆', category: 'milestone', requirement_type: 'total_amount', requirement_value: 10000000 },
    
    // Transaction count
    { code: 'tx_10', name: 'Mulai Rajin', description: '10 kali transaksi menabung', icon: '⭐', category: 'activity', requirement_type: 'tx_count', requirement_value: 10 },
    { code: 'tx_50', name: 'Penabung Setia', description: '50 kali transaksi menabung', icon: '🌟', category: 'activity', requirement_type: 'tx_count', requirement_value: 50 },
    { code: 'tx_100', name: 'Master Saver', description: '100 kali transaksi menabung', icon: '✨', category: 'activity', requirement_type: 'tx_count', requirement_value: 100 },
    
    // First time
    { code: 'first_save', name: 'Langkah Pertama', description: 'Transaksi pertama berhasil', icon: '🎉', category: 'first', requirement_type: 'first_tx', requirement_value: 1 },
    { code: 'first_goal', name: 'Punya Target', description: 'Membuat target tabungan pertama', icon: '🎯', category: 'first', requirement_type: 'first_goal', requirement_value: 1 },
    { code: 'goal_complete', name: 'Target Tercapai', description: 'Berhasil mencapai target tabungan', icon: '🏅', category: 'goal', requirement_type: 'goal_complete', requirement_value: 1 }
];

// Initialize badges in database
async function initializeBadges() {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(`INSERT OR IGNORE INTO badges (code, name, description, icon, category, requirement_type, requirement_value) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        BADGES.forEach(badge => {
            stmt.run(badge.code, badge.name, badge.description, badge.icon, badge.category, badge.requirement_type, badge.requirement_value);
        });
        stmt.finalize((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Get or create user streak
async function getOrCreateStreak(userId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM user_streaks WHERE user_id = ?', [userId], (err, row) => {
            if (err) return reject(err);
            if (row) return resolve(row);
            
            db.run('INSERT INTO user_streaks (user_id, current_streak, longest_streak, total_saving_days) VALUES (?, 0, 0, 0)', [userId], function(err) {
                if (err) return reject(err);
                resolve({ id: this.lastID, user_id: userId, current_streak: 0, longest_streak: 0, total_saving_days: 0, last_saving_date: null });
            });
        });
    });
}

// Update streak when user saves
async function updateStreak(userId) {
    const streak = await getOrCreateStreak(userId);
    const today = new Date().toISOString().split('T')[0];
    const lastDate = streak.last_saving_date;
    
    let newStreak = streak.current_streak;
    let newTotal = streak.total_saving_days;
    
    if (lastDate === today) {
        // Already saved today
        return streak;
    }
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    if (lastDate === yesterdayStr) {
        // Consecutive day
        newStreak += 1;
    } else if (!lastDate) {
        // First save
        newStreak = 1;
    } else {
        // Streak broken
        newStreak = 1;
    }
    
    newTotal += 1;
    const longestStreak = Math.max(streak.longest_streak, newStreak);
    
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE user_streaks SET current_streak = ?, longest_streak = ?, last_saving_date = ?, total_saving_days = ? WHERE user_id = ?',
            [newStreak, longestStreak, today, newTotal, userId],
            function(err) {
                if (err) reject(err);
                else resolve({ ...streak, current_streak: newStreak, longest_streak: longestStreak, last_saving_date: today, total_saving_days: newTotal });
            }
        );
    });
}

// Check and award badges
async function checkAndAwardBadges(userId, balance, txCount, streak, hasGoal, goalComplete) {
    const newBadges = [];
    
    return new Promise((resolve, reject) => {
        db.all('SELECT b.* FROM badges b LEFT JOIN user_badges ub ON b.id = ub.badge_id AND ub.user_id = ? WHERE ub.id IS NULL', [userId], async (err, availableBadges) => {
            if (err) return reject(err);
            
            for (const badge of availableBadges) {
                let earned = false;
                
                switch (badge.requirement_type) {
                    case 'streak':
                        earned = streak.current_streak >= badge.requirement_value;
                        break;
                    case 'total_amount':
                        earned = balance >= badge.requirement_value;
                        break;
                    case 'tx_count':
                        earned = txCount >= badge.requirement_value;
                        break;
                    case 'first_tx':
                        earned = txCount >= 1;
                        break;
                    case 'first_goal':
                        earned = hasGoal;
                        break;
                    case 'goal_complete':
                        earned = goalComplete;
                        break;
                }
                
                if (earned) {
                    await awardBadge(userId, badge.id);
                    newBadges.push(badge);
                }
            }
            
            resolve(newBadges);
        });
    });
}

// Award badge to user
function awardBadge(userId, badgeId) {
    return new Promise((resolve, reject) => {
        db.run('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)', [userId, badgeId], function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

// Get user badges
function getUserBadges(userId) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT b.*, ub.earned_at 
            FROM user_badges ub 
            JOIN badges b ON ub.badge_id = b.id 
            WHERE ub.user_id = ? 
            ORDER BY ub.earned_at DESC
        `, [userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

// Get user streak info
function getUserStreak(userId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM user_streaks WHERE user_id = ?', [userId], (err, row) => {
            if (err) reject(err);
            else resolve(row || { current_streak: 0, longest_streak: 0, total_saving_days: 0 });
        });
    });
}

// Format badges for WhatsApp message
function formatBadgesMessage(badges, streak) {
    let msg = '🏆 *BADGE & ACHIEVEMENT*\n';
    msg += '━━━━━━━━━━━━━━━━\n\n';
    
    msg += '🔥 *Streak Saat Ini:* ' + streak.current_streak + ' hari\n';
    msg += '👑 *Streak Terlama:* ' + streak.longest_streak + ' hari\n';
    msg += '📅 *Total Hari Nabung:* ' + streak.total_saving_days + ' hari\n\n';
    
    if (badges.length === 0) {
        msg += '_Belum ada badge. Terus menabung untuk mendapatkan badge!_\n';
    } else {
        msg += '*Badge Terkumpul:* (' + badges.length + ')\n\n';
        badges.forEach(b => {
            msg += b.icon + ' *' + b.name + '*\n';
            msg += '   _' + b.description + '_\n\n';
        });
    }
    
    msg += '━━━━━━━━━━━━━━━━\n';
    msg += '💡 Terus konsisten menabung!';
    
    return msg;
}

// Format new badge notification (single badge)
function formatNewBadgeMessage(badge) {
    return '🎊 *SELAMAT! BADGE BARU!*\n\n' +
           badge.icon + ' *' + badge.name + '*\n\n' +
           '📝 ' + badge.description + '\n\n' +
           'Terus semangat menabung! 💪';
}

// Format multiple new badges notification with balance (combined into 1 message)
function formatNewBadgesMessage(badges, balance) {
    if (!badges || badges.length === 0) return null;
    
    let msg = '🎊 *SELAMAT! BADGE BARU!*\n';
    msg += '━━━━━━━━━━━━━━━━\n\n';
    
    badges.forEach(badge => {
        msg += badge.icon + ' *' + badge.name + '*\n';
        msg += '   📝 ' + badge.description + '\n\n';
    });
    
    msg += '━━━━━━━━━━━━━━━━\n';
    msg += '💰 Total Tabungan: Rp ' + balance.toLocaleString('id-ID') + '\n\n';
    msg += 'Terus semangat menabung! 💪';
    
    return msg;
}

module.exports = {
    initializeBadges,
    updateStreak,
    checkAndAwardBadges,
    getUserBadges,
    getUserStreak,
    formatBadgesMessage,
    formatNewBadgeMessage,
    formatNewBadgesMessage,
    getOrCreateStreak
};
