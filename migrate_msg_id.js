const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(process.env.DB_PATH || './data/database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.all("PRAGMA table_info(transactions)", (err, rows) => {
        if (err) return console.error(err);
        const msgIdExists = rows.some(row => row.name === 'message_id');
        if (!msgIdExists) {
            console.log('Adding message_id column...');
            db.run("ALTER TABLE transactions ADD COLUMN message_id TEXT", (err) => {
                if (!err) console.log('Done.');
                else console.error(err);
            });
        } else {
            console.log('message_id column exists.');
        }
    });
});
