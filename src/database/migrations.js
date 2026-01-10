const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(process.env.DB_PATH || './data/database.sqlite');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Create tables
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT UNIQUE NOT NULL,
                username TEXT,
                password TEXT,
                name TEXT NOT NULL,
                partner_phone TEXT,
                is_logged_in INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Add new columns if not exists (for existing databases)
            db.run(`ALTER TABLE users ADD COLUMN username TEXT`, (err) => { });
            db.run(`ALTER TABLE users ADD COLUMN password TEXT`, (err) => { });
            db.run(`ALTER TABLE users ADD COLUMN is_logged_in INTEGER DEFAULT 0`, (err) => { });

            db.run(`CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                type TEXT CHECK(type IN ('deposit', 'withdrawal')) NOT NULL,
                payment_method TEXT DEFAULT 'qris',
                screenshot_path TEXT,
                confirmed BOOLEAN DEFAULT 0,
                qris_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS goals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                partner_user_id INTEGER,
                title TEXT NOT NULL,
                target_amount DECIMAL(10, 2) NOT NULL,
                current_amount DECIMAL(10, 2) DEFAULT 0,
                target_date DATE,
                reminder_frequency TEXT DEFAULT 'weekly',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (partner_user_id) REFERENCES users(id)
            )`);

            db.run(`ALTER TABLE goals ADD COLUMN partner_user_id INTEGER REFERENCES users(id)`, (err) => { });

            db.run(`CREATE TABLE IF NOT EXISTS quotes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                author TEXT,
                category TEXT DEFAULT 'motivation'
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                goal_id INTEGER,
                frequency TEXT DEFAULT 'daily',
                custom_message TEXT,
                is_active INTEGER DEFAULT 1,
                send_time TEXT DEFAULT '09:00',
                last_sent DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (goal_id) REFERENCES goals(id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS qris_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id TEXT UNIQUE NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                status TEXT DEFAULT 'pending',
                user_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);



            // Badges/Achievements table
            db.run(`CREATE TABLE IF NOT EXISTS badges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                icon TEXT,
                category TEXT DEFAULT 'achievement',
                requirement_type TEXT,
                requirement_value INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // User badges (earned achievements)
            db.run(`CREATE TABLE IF NOT EXISTS user_badges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                badge_id INTEGER NOT NULL,
                earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                notified INTEGER DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (badge_id) REFERENCES badges(id),
                UNIQUE(user_id, badge_id)
            )`);

            // User streaks tracking
            db.run(`CREATE TABLE IF NOT EXISTS user_streaks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER UNIQUE NOT NULL,
                current_streak INTEGER DEFAULT 0,
                longest_streak INTEGER DEFAULT 0,
                last_saving_date DATE,
                total_saving_days INTEGER DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )`);

            // Financial tips
            db.run(`CREATE TABLE IF NOT EXISTS financial_tips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tip TEXT NOT NULL,
                category TEXT DEFAULT 'general',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Milestone notifications tracking
            db.run(`CREATE TABLE IF NOT EXISTS milestone_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                goal_id INTEGER NOT NULL,
                milestone_percent INTEGER NOT NULL,
                notified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (goal_id) REFERENCES goals(id),
                UNIQUE(user_id, goal_id, milestone_percent)
            )`);

            // Weekly report tracking
            db.run(`CREATE TABLE IF NOT EXISTS weekly_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                week_start DATE NOT NULL,
                week_end DATE NOT NULL,
                total_saved DECIMAL(10,2) DEFAULT 0,
                transaction_count INTEGER DEFAULT 0,
                sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                account_type TEXT NOT NULL,
                account_number TEXT NOT NULL,
                account_name TEXT NOT NULL,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'success', 'failed')),
                admin_notes TEXT,
                processed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )`);

            // Expenses table for tracking user spending
            db.run(`CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                category TEXT NOT NULL DEFAULT 'lainnya',
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )`);

            // Default expense categories
            db.run(`CREATE TABLE IF NOT EXISTS expense_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                icon TEXT NOT NULL,
                color TEXT DEFAULT '#6b7280'
            )`);

            // Insert default expense categories if empty
            db.get("SELECT count(*) as count FROM expense_categories", (err, row) => {
                if (!err && row && row.count === 0) {
                    const defaultCategories = [
                        { code: 'makanan', name: 'Makanan & Minuman', icon: '🍔', color: '#ef4444' },
                        { code: 'transport', name: 'Transportasi', icon: '🚗', color: '#f97316' },
                        { code: 'belanja', name: 'Belanja', icon: '🛒', color: '#eab308' },
                        { code: 'tagihan', name: 'Tagihan', icon: '💡', color: '#22c55e' },
                        { code: 'hiburan', name: 'Hiburan', icon: '🎮', color: '#3b82f6' },
                        { code: 'kesehatan', name: 'Kesehatan', icon: '💊', color: '#ec4899' },
                        { code: 'pendidikan', name: 'Pendidikan', icon: '📚', color: '#8b5cf6' },
                        { code: 'rumah', name: 'Rumah Tangga', icon: '🏠', color: '#14b8a6' },
                        { code: 'bisnis', name: 'Bisnis', icon: '💼', color: '#6366f1' },
                        { code: 'lainnya', name: 'Lainnya', icon: '❓', color: '#6b7280' }
                    ];

                    const stmt = db.prepare("INSERT INTO expense_categories (code, name, icon, color) VALUES (?, ?, ?, ?)");
                    defaultCategories.forEach(cat => {
                        stmt.run(cat.code, cat.name, cat.icon, cat.color);
                    });
                    stmt.finalize();
                    console.log("Default expense categories inserted.");
                }
            });

            // Budgets table for monthly spending limits
            db.run(`CREATE TABLE IF NOT EXISTS budgets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                category TEXT NOT NULL,
                monthly_limit DECIMAL(10, 2) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, category)
            )`);

            // Insert default quotes if empty
            db.get("SELECT count(*) as count FROM quotes", (err, row) => {
                if (!err && row.count === 0) {
                    const defaultQuotes = [
                        { text: "Hemat pangkal kaya.", author: "Pepatah" },
                        { text: "Sedikit demi sedikit, lama-lama menjadi bukit.", author: "Pepatah" },
                        { text: "Jangan menabung apa yang tersisa setelah belanja, tapi belanjakan apa yang tersisa setelah menabung.", author: "Warren Buffett" },
                        { text: "Kekayaan bukan tentang memiliki banyak uang, tapi tentang memiliki banyak pilihan.", author: "Chris Rock" },
                        { text: "Masa depan diciptakan oleh apa yang kau lakukan hari ini, bukan besok.", author: "Robert Kiyosaki" }
                    ];

                    const stmt = db.prepare("INSERT INTO quotes (text, author) VALUES (?, ?)");
                    defaultQuotes.forEach(quote => {
                        stmt.run(quote.text, quote.author);
                    });
                    stmt.finalize();
                    console.log("Default quotes inserted.");
                }
            });

            console.log('Database initialized successfully');
            resolve();
        });
    });
}

function getDatabase() {
    return db;
}

if (require.main === module) {
    initializeDatabase().catch(console.error);
}

module.exports = { initializeDatabase, getDatabase };
