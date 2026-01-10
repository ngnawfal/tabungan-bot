# 📱 Tabungan Bot

> Asisten keuangan berbasis WhatsApp untuk mengelola tabungan dan pengeluaran dengan mudah. Dilengkapi dashboard admin berbasis web untuk monitoring dan pengelolaan data.

![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)
![WhatsApp](https://img.shields.io/badge/WhatsApp-Bot-25D366?logo=whatsapp)
![SQLite](https://img.shields.io/badge/SQLite-Database-003B57?logo=sqlite)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## 📑 Daftar Isi

- [Fitur Utama](#-fitur-utama)
- [Quick Start](#-quick-start)
- [Konfigurasi](#-konfigurasi)
- [Perintah WhatsApp](#-perintah-whatsapp)
- [Dashboard Admin](#-dashboard-admin)
- [API Endpoints](#-api-endpoints)
- [Struktur Project](#-struktur-project)
- [Database Schema](#-database-schema)
- [Troubleshooting](#-troubleshooting)
- [Tech Stack](#-tech-stack)

---

## ✨ Fitur Utama

### 💰 Manajemen Tabungan

**Setoran via QRIS**
- Generate QR code pembayaran otomatis
- Verifikasi bukti transfer dengan screenshot
- Konfirmasi setoran real-time

**Penarikan Dana**
- Request penarikan dengan nominal
- Sistem approval oleh admin
- Notifikasi status penarikan

**Tracking Saldo**
- Cek saldo real-time
- Riwayat transaksi lengkap
- Filter berdasarkan tanggal/tipe

---

### 💸 Pencatatan Pengeluaran

**Catat Pengeluaran Harian**
```
/catat 50000 makanan makan siang
/catat 150000 transport bensin motor
/catat 500000 tagihan listrik bulan ini
```

**10 Kategori Default**
| Kode | Nama | Icon |
|------|------|------|
| `makanan` | Makanan & Minuman | 🍔 |
| `transport` | Transportasi | 🚗 |
| `belanja` | Belanja | 🛒 |
| `tagihan` | Tagihan | 💡 |
| `hiburan` | Hiburan | 🎮 |
| `kesehatan` | Kesehatan | 💊 |
| `pendidikan` | Pendidikan | 📚 |
| `rumah` | Rumah Tangga | 🏠 |
| `bisnis` | Bisnis | 💼 |
| `lainnya` | Lainnya | ❓ |

**Ringkasan Bulanan**
- Total pengeluaran per bulan
- Breakdown per kategori dengan persentase
- Riwayat 5 transaksi terakhir

---

### 📊 Budget Management

**Set Budget Bulanan**
```
/budget makanan 500000    # Limit makan 500rb/bulan
/budget transport 300000  # Limit transport 300rb/bulan
```

**Peringatan Otomatis**
- ⚠️ Warning saat penggunaan > 80%
- 🚨 Alert saat budget terlampaui
- Notifikasi setiap kali catat pengeluaran

**Monitoring Status**
```
/budgets  # Lihat semua budget dan status
```

---

### 🎯 Target Tabungan

- Buat target dengan nama dan nominal
- Progress bar visual
- Notifikasi saat target tercapai
- Multiple targets support

---

### 🎮 Gamifikasi

**Badge System**
- First Deposit Badge
- Consistency Badge (7 hari berturut)
- Milestone Badge (100rb, 500rb, 1jt)

**Daily Features**
- Motivational quotes harian (07:00)
- Weekly report (Minggu 08:00)
- Daily tips tentang finansial

---

### � Reminder System

- Pengingat tabungan otomatis
- Broadcast pesan ke semua user
- Jadwal reminder customizable

---

## 🚀 Quick Start

### Prerequisites

```bash
# Node.js 18 atau lebih baru
node --version  # v18.x.x atau lebih

# npm
npm --version   # 9.x.x atau lebih
```

### Installation

```bash
# 1. Clone repository
git clone https://github.com/your-repo/tabungan-bot.git
cd tabungan-bot

# 2. Install dependencies
npm install

# 3. Copy environment file
cp .env.example .env

# 4. Edit konfigurasi
# Buka .env dan sesuaikan

# 5. Jalankan
npm run dev
```

### First Run

1. **Terminal** akan menampilkan QR code
2. **Buka WhatsApp** di HP
3. **Scan QR code** (Settings → Linked Devices → Link a Device)
4. Bot siap digunakan!

---

## ⚙️ Konfigurasi

### Environment Variables

Buat file `.env` di root project:

```env
# ===== SERVER =====
PORT=3847
NODE_ENV=development

# ===== ADMIN DASHBOARD =====
ADMIN_USERNAME=admin
ADMIN_PASSWORD=rahasia123
JWT_SECRET=jwt_secret_key_yang_panjang_dan_aman

# ===== WHATSAPP =====
# Session akan tersimpan otomatis di .wwebjs_auth/

# ===== QRIS (Opsional) =====
QRIS_MERCHANT_ID=your_merchant_id
QRIS_API_KEY=your_api_key

# ===== BACKUP =====
BACKUP_PATH=./backups
AUTO_BACKUP=true
BACKUP_TIME=02:00
```

### Penjelasan Konfigurasi

| Variable | Deskripsi | Default |
|----------|-----------|---------|
| `PORT` | Port server | `3847` |
| `NODE_ENV` | Environment (development/production) | `development` |
| `ADMIN_USERNAME` | Username login dashboard | `admin` |
| `ADMIN_PASSWORD` | Password login dashboard | - |
| `JWT_SECRET` | Secret key untuk JWT token | - |
| `AUTO_BACKUP` | Aktifkan backup otomatis | `true` |
| `BACKUP_TIME` | Jam backup harian | `02:00` |

---

## 📋 Perintah WhatsApp

### Perintah Umum

| Perintah | Deskripsi | Contoh |
|----------|-----------|--------|
| `/start` | Mulai bot & panduan | `/start` |
| `/help` | Daftar semua perintah | `/help` |
| `/daftar [nama]` | Registrasi user baru | `/daftar Budi Santoso` |
| `/login` | Login ke akun | `/login` |
| `/logout` | Logout dari akun | `/logout` |

### Perintah Tabungan

| Perintah | Deskripsi | Contoh |
|----------|-----------|--------|
| `/setor [nominal]` | Setoran via QRIS | `/setor 100000` |
| `/tarik [nominal]` | Request penarikan | `/tarik 50000` |
| `/saldo` | Cek saldo terkini | `/saldo` |
| `/riwayat` | Riwayat transaksi | `/riwayat` |

### Perintah Pengeluaran

| Perintah | Deskripsi | Contoh |
|----------|-----------|--------|
| `/catat [nominal] [kategori] [ket]` | Catat pengeluaran | `/catat 50000 makanan nasi goreng` |
| `/pengeluaran` | Ringkasan bulanan | `/pengeluaran` |
| `/kategori` | Daftar kategori | `/kategori` |

### Perintah Budget

| Perintah | Deskripsi | Contoh |
|----------|-----------|--------|
| `/budget [kategori] [limit]` | Set budget bulanan | `/budget makanan 500000` |
| `/budgets` | Status semua budget | `/budgets` |

### Perintah Target

| Perintah | Deskripsi | Contoh |
|----------|-----------|--------|
| `/target` | Lihat target | `/target` |
| `/target buat [nama] [nominal]` | Buat target baru | `/target buat iPhone 15000000` |
| `/target hapus [id]` | Hapus target | `/target hapus 1` |

---

## 🖥️ Dashboard Admin

### Akses Dashboard

```
URL: http://localhost:3847/dashboard
Username: (sesuai .env)
Password: (sesuai .env)
```

### Fitur Dashboard

| Tab | Fungsi |
|-----|--------|
| **Dashboard** | Overview statistik: total saldo, user, transaksi, target aktif |
| **Analisis** | Grafik tren setoran/penarikan, breakdown per metode pembayaran |
| **Transaksi** | List semua transaksi, filter, edit status, hapus, export PDF/Excel |
| **Users** | Kelola user, edit data, broadcast pesan, hapus user |
| **Penarikan** | Approve/reject request penarikan |
| **Reminder** | Kirim pengingat ke user |
| **Backup** | Create backup, restore, download, delete backup |
| **Pengeluaran** | Pie chart kategori, tabel expense, export PDF/Excel |
| **WhatsApp** | Status koneksi, QR code, logout |

### Export Laporan

**PDF Export**
- Header profesional dengan judul
- Summary cards (Total, Setoran, Penarikan)
- Tabel transaksi dengan zebra striping
- Footer dengan timestamp

**Excel Export**
- Sheet 1: Ringkasan dengan statistik
- Sheet 2: Detail transaksi lengkap
- Color-coded cells
- Format angka Rupiah
- Frozen header row

---

## 🔌 API Endpoints

### Authentication

```http
POST /api/login
Content-Type: application/json

{
  "username": "admin",
  "password": "password"
}

Response: { "token": "jwt_token_here" }
```

### Statistics

```http
GET /api/stats
Authorization: Bearer <token>

Response: {
  "totalSavings": 5000000,
  "totalUsers": 25,
  "totalTransactions": 150,
  "activeGoals": 10
}
```

### Transactions

```http
# Get all transactions
GET /api/transactions

# Update status
PUT /api/transactions/:id/status
{ "status": "success" }

# Delete transaction
DELETE /api/transactions/:id

# Export PDF
GET /api/transactions/export/pdf?token=<jwt>

# Export Excel
GET /api/transactions/export/excel?token=<jwt>
```

### Users

```http
# Get all users
GET /api/users

# Update user
PUT /api/users/:id
{ "name": "New Name", "phone_number": "08xxx" }

# Delete user
DELETE /api/users/:id

# Broadcast message
POST /api/broadcast
{ "message": "Pengumuman...", "userIds": [1, 2, 3] }
```

### Expenses

```http
# Get all expenses
GET /api/expenses

# Get summary by category
GET /api/expenses/summary?month=2026-01

# Get categories
GET /api/expenses/categories

# Delete expense
DELETE /api/expenses/:id

# Export PDF
GET /api/expenses/export/pdf?token=<jwt>

# Export Excel
GET /api/expenses/export/excel?token=<jwt>
```

### Withdrawals

```http
# Get all withdrawals
GET /api/withdrawals

# Get pending count
GET /api/withdrawals/pending/count

# Approve/Reject
PUT /api/withdrawals/:id/status
{ "status": "approved" }  # atau "rejected"
```

### Backup

```http
# List backups
GET /api/backup/list

# Create backup
POST /api/backup/create

# Restore backup
POST /api/backup/restore
{ "filename": "backup_2026-01-01.db" }

# Delete backup
DELETE /api/backup/:filename
```

### WhatsApp

```http
# Get status
GET /api/whatsapp/status

# SSE Stream (realtime updates)
GET /api/whatsapp/stream?token=<jwt>

# Logout
POST /api/whatsapp/logout

# Test connection
POST /api/whatsapp/test
```

---

## 🗂️ Struktur Project

```
tabungan-bot/
│
├── server.js                 # Entry point & Express setup
├── package.json              # Dependencies
├── .env                      # Environment variables
├── .env.example              # Template environment
├── README.md                 # Dokumentasi
│
├── src/
│   ├── bot/
│   │   ├── whatsapp.js       # WhatsApp client initialization
│   │   └── handlers.js       # Command handlers (/setor, /catat, dll)
│   │
│   ├── database/
│   │   ├── database.db       # SQLite database file
│   │   ├── migrations.js     # Table schemas & migrations
│   │   └── models.js         # CRUD operations
│   │
│   ├── routes/
│   │   └── api.js            # REST API endpoints
│   │
│   ├── features/
│   │   ├── backup.js         # Backup & restore system
│   │   ├── quotes.js         # Motivational quotes
│   │   └── gamification.js   # Badge system
│   │
│   ├── payments/
│   │   ├── qris.js           # QRIS integration
│   │   └── screenshot.js     # Screenshot verification
│   │
│   ├── middlewares/
│   │   ├── rateLimiter.js    # Rate limiting
│   │   └── validators.js     # Input validation
│   │
│   └── utils/
│       └── logger.js         # Logging utility
│
├── public/
│   └── dashboard/
│       └── index.html        # Admin dashboard (SPA)
│
├── backups/                  # Backup files
│
└── .wwebjs_auth/             # WhatsApp session data
```

---

## �️ Database Schema

### Users Table
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT,
  phone_number TEXT UNIQUE,
  balance DECIMAL(10, 2) DEFAULT 0,
  visitor_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Transactions Table
```sql
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  type TEXT,              -- 'deposit' atau 'withdrawal'
  amount DECIMAL(10, 2),
  payment_method TEXT,
  status TEXT,            -- 'pending', 'success', 'failed'
  confirmed BOOLEAN DEFAULT 0,
  screenshot_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### Expenses Table
```sql
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  amount DECIMAL(10, 2),
  category TEXT,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### Expense Categories Table
```sql
CREATE TABLE expense_categories (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT,
  icon TEXT,
  color TEXT
);
```

### Budgets Table
```sql
CREATE TABLE budgets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  category TEXT,
  monthly_limit DECIMAL(10, 2),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, category)
);
```

### Goals Table
```sql
CREATE TABLE goals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  name TEXT,
  target_amount DECIMAL(10, 2),
  current_amount DECIMAL(10, 2) DEFAULT 0,
  deadline DATE,
  completed BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Withdrawals Table
```sql
CREATE TABLE withdrawals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  amount DECIMAL(10, 2),
  account_type TEXT,
  account_number TEXT,
  account_name TEXT,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🔧 Troubleshooting

### WhatsApp tidak konek

```bash
# Hapus session lama
rm -rf .wwebjs_auth

# Restart server
npm run dev

# Scan ulang QR code
```

### Error: Puppeteer/Chromium

```bash
# Windows - Install dependencies
npm install puppeteer

# Linux - Install Chromium
sudo apt install chromium-browser
```

### Database locked

```bash
# Stop semua proses
pkill -f "node server.js"

# Restart
npm run dev
```

### Port sudah digunakan

```bash
# Cari proses yang menggunakan port
netstat -ano | findstr :3847

# Kill proses (Windows)
taskkill /PID <PID> /F

# Atau ganti port di .env
PORT=3848
```

### Export PDF/Excel gagal

```bash
# Install dependencies
npm install pdfkit exceljs

# Restart server
npm run dev
```

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| **Runtime** | Node.js 18+ |
| **Framework** | Express 4.x |
| **Database** | SQLite3 |
| **WhatsApp** | whatsapp-web.js |
| **Authentication** | JWT (jsonwebtoken) |
| **PDF Export** | PDFKit |
| **Excel Export** | ExcelJS |
| **Charts** | Chart.js |
| **Validation** | express-validator |
| **Rate Limiting** | express-rate-limit |
| **File Upload** | Multer |

---

## 📦 Dependencies

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "whatsapp-web.js": "^1.23.0",
    "sqlite3": "^5.1.6",
    "jsonwebtoken": "^9.0.2",
    "pdfkit": "^0.14.0",
    "exceljs": "^4.4.0",
    "qrcode-terminal": "^0.12.0",
    "qrcode": "^1.5.3",
    "multer": "^1.4.5-lts.1",
    "express-rate-limit": "^7.1.5",
    "express-validator": "^7.0.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

---

## 📜 Scripts

```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "backup": "node scripts/backup.js"
  }
}
```

---

## 🔒 Security Features

- ✅ JWT Authentication untuk API
- ✅ Password hashing (bcrypt)
- ✅ Rate limiting pada endpoints
- ✅ Input validation & sanitization
- ✅ SQL injection protection (parameterized queries)
- ✅ XSS protection
- ✅ CORS configuration

---

## 📄 License

MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software.

---

## 🤝 Contributing

1. Fork repository ini
2. Buat branch fitur (`git checkout -b feature/FiturBaru`)
3. Commit perubahan (`git commit -m 'Tambah FiturBaru'`)
4. Push ke branch (`git push origin feature/FiturBaru`)
5. Buat Pull Request

---

## 📞 Support

Jika mengalami masalah:
- � Buka [Issue](https://github.com/your-repo/tabungan-bot/issues) di GitHub
- 📧 Email: support@example.com

---

## 🙏 Credits

- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) - WhatsApp Web API
- [Chart.js](https://www.chartjs.org/) - Charts library
- [Font Awesome](https://fontawesome.com/) - Icons

---

<p align="center">
  <b>Made with ❤️ in Indonesia</b><br>
  <sub>© 2026 Tabungan Bot. All rights reserved.</sub>
</p>
