const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const dbPath = path.resolve(process.env.DB_PATH || './data/database.sqlite');
const db = new sqlite3.Database(dbPath);

// Initialize session table
function initSessionTable() {
    return new Promise((resolve, reject) => {
        db.run(`
            CREATE TABLE IF NOT EXISTS whatsapp_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT UNIQUE NOT NULL,
                session_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) reject(err);
            else {
                logger.info('WhatsApp session table initialized');
                resolve();
            }
        });
    });
}

// Save session data
function saveSession(sessionId, sessionData) {
    return new Promise((resolve, reject) => {
        const data = typeof sessionData === 'string' ? sessionData : JSON.stringify(sessionData);
        db.run(
            `INSERT INTO whatsapp_sessions (session_id, session_data, updated_at) 
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(session_id) DO UPDATE SET 
             session_data = excluded.session_data,
             updated_at = CURRENT_TIMESTAMP`,
            [sessionId, data],
            function(err) {
                if (err) {
                    logger.error('Failed to save session:', err);
                    reject(err);
                } else {
                    logger.info('Session saved to database');
                    resolve(this.changes);
                }
            }
        );
    });
}

// Get session data
function getSession(sessionId) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT session_data FROM whatsapp_sessions WHERE session_id = ?',
            [sessionId],
            (err, row) => {
                if (err) {
                    logger.error('Failed to get session:', err);
                    reject(err);
                } else {
                    if (row && row.session_data) {
                        try {
                            resolve(JSON.parse(row.session_data));
                        } catch (e) {
                            resolve(row.session_data);
                        }
                    } else {
                        resolve(null);
                    }
                }
            }
        );
    });
}

// Delete session
function deleteSession(sessionId) {
    return new Promise((resolve, reject) => {
        db.run(
            'DELETE FROM whatsapp_sessions WHERE session_id = ?',
            [sessionId],
            function(err) {
                if (err) {
                    logger.error('Failed to delete session:', err);
                    reject(err);
                } else {
                    logger.info('Session deleted from database');
                    resolve(this.changes);
                }
            }
        );
    });
}

// Check if session exists
function sessionExists(sessionId) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT 1 FROM whatsapp_sessions WHERE session_id = ?',
            [sessionId],
            (err, row) => {
                if (err) reject(err);
                else resolve(!!row);
            }
        );
    });
}

module.exports = {
    initSessionTable,
    saveSession,
    getSession,
    deleteSession,
    sessionExists
};
