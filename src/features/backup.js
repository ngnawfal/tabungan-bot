const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const unzipper = require('unzipper');
const cron = require('node-cron');

const DATA_DIR = path.resolve('./data');
const UPLOADS_DIR = path.resolve('./uploads');
const BACKUP_DIR = path.resolve('./backups');
const TEMP_DIR = path.resolve('./temp');

// Ensure directories exist
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Generate backup filename with timestamp
function getBackupFilename() {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `backup_${timestamp}.zip`;
}

// Create backup
function createBackup() {
    return new Promise((resolve, reject) => {
        ensureDir(BACKUP_DIR);
        
        const filename = getBackupFilename();
        const backupPath = path.join(BACKUP_DIR, filename);
        const output = fs.createWriteStream(backupPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            const stats = {
                filename,
                path: backupPath,
                size: archive.pointer(),
                sizeFormatted: formatBytes(archive.pointer()),
                createdAt: new Date().toISOString()
            };
            console.log(`Backup created: ${filename} (${stats.sizeFormatted})`);
            resolve(stats);
        });

        archive.on('error', (err) => {
            console.error('Backup error:', err);
            reject(err);
        });

        archive.pipe(output);

        // Add database file
        const dbPath = path.join(DATA_DIR, 'database.sqlite');
        if (fs.existsSync(dbPath)) {
            archive.file(dbPath, { name: 'data/database.sqlite' });
        }

        // Add uploads folder
        if (fs.existsSync(UPLOADS_DIR)) {
            archive.directory(UPLOADS_DIR, 'uploads');
        }

        // Add backup info
        const backupInfo = {
            createdAt: new Date().toISOString(),
            version: '1.0',
            contents: ['database.sqlite', 'uploads/']
        };
        archive.append(JSON.stringify(backupInfo, null, 2), { name: 'backup-info.json' });

        archive.finalize();
    });
}

// Restore backup from uploaded file
function restoreBackup(zipFilePath) {
    return new Promise(async (resolve, reject) => {
        try {
            ensureDir(TEMP_DIR);
            const extractPath = path.join(TEMP_DIR, 'restore_' + Date.now());
            ensureDir(extractPath);

            // Extract zip file
            await fs.createReadStream(zipFilePath)
                .pipe(unzipper.Extract({ path: extractPath }))
                .promise();

            // Check if backup is valid
            const dbSource = path.join(extractPath, 'data', 'database.sqlite');
            if (!fs.existsSync(dbSource)) {
                // Clean up
                fs.rmSync(extractPath, { recursive: true, force: true });
                return reject(new Error('Invalid backup: database.sqlite not found'));
            }

            // Backup current data before restore
            const currentBackup = await createBackup();
            console.log(`Created safety backup before restore: ${currentBackup.filename}`);

            // Restore database
            ensureDir(DATA_DIR);
            const dbDest = path.join(DATA_DIR, 'database.sqlite');
            fs.copyFileSync(dbSource, dbDest);

            // Restore uploads folder
            const uploadsSource = path.join(extractPath, 'uploads');
            if (fs.existsSync(uploadsSource)) {
                // Clear existing uploads
                if (fs.existsSync(UPLOADS_DIR)) {
                    fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
                }
                // Copy restored uploads
                copyFolderSync(uploadsSource, UPLOADS_DIR);
            }

            // Clean up temp folder
            fs.rmSync(extractPath, { recursive: true, force: true });

            console.log('Backup restored successfully!');
            resolve({ 
                success: true, 
                message: 'Backup restored successfully',
                safetyBackup: currentBackup.filename 
            });
        } catch (err) {
            console.error('Restore error:', err);
            reject(err);
        }
    });
}

// Helper to copy folder recursively
function copyFolderSync(src, dest) {
    ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyFolderSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// List all backups
function listBackups() {
    ensureDir(BACKUP_DIR);
    
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.zip'))
        .map(f => {
            const filePath = path.join(BACKUP_DIR, f);
            const stats = fs.statSync(filePath);
            return {
                filename: f,
                size: stats.size,
                sizeFormatted: formatBytes(stats.size),
                createdAt: stats.mtime.toISOString()
            };
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    return files;
}

// Delete old backups (keep last N)
function cleanOldBackups(keepCount = 5) {
    const backups = listBackups();
    const toDelete = backups.slice(keepCount);
    
    toDelete.forEach(backup => {
        const filePath = path.join(BACKUP_DIR, backup.filename);
        fs.unlinkSync(filePath);
        console.log(`Deleted old backup: ${backup.filename}`);
    });
    
    return toDelete.length;
}

// Delete specific backup
function deleteBackup(filename) {
    const filePath = path.join(BACKUP_DIR, filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
    }
    return false;
}

// Get backup file path for download
function getBackupPath(filename) {
    const filePath = path.join(BACKUP_DIR, filename);
    if (fs.existsSync(filePath)) {
        return filePath;
    }
    return null;
}

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Start automatic backup scheduler
function startBackupScheduler(schedule = '0 2 * * *') {
    cron.schedule(schedule, async () => {
        console.log('Running scheduled backup...');
        try {
            await createBackup();
            cleanOldBackups(5);
        } catch (err) {
            console.error('Scheduled backup failed:', err);
        }
    });
    console.log('Backup scheduler started (daily at 2 AM)');
}

module.exports = {
    createBackup,
    restoreBackup,
    listBackups,
    cleanOldBackups,
    deleteBackup,
    getBackupPath,
    startBackupScheduler,
    BACKUP_DIR
};
