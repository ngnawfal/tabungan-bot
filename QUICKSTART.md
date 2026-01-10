# 🚀 QUICK START GUIDE

## Cara Menjalankan Bot

### 1. Install Dependencies
\\\ash
npm install --legacy-peer-deps
\\\

Jika ada error, install dependencies satu per satu:
\\\ash
npm install express sqlite3 dotenv axios qrcode qrcode-terminal
npm install @google/generative-ai multer node-cron moment bcrypt jsonwebtoken cors
npm install whatsapp-web.js --legacy-peer-deps
\\\

### 2. Setup Environment
Edit file .env dan tambahkan API keys Anda:
- GEMINI_API_KEY: Dapatkan dari https://makersuite.google.com/app/apikey
- ADMIN_USERNAME dan ADMIN_PASSWORD untuk dashboard

### 3. Initialize Database
\\\ash
node src/database/migrations.js
\\\

### 4. Start Bot
\\\ash
npm start
\\\

### 5. Scan QR Code
- Scan QR code yang muncul di terminal dengan WhatsApp
- Bot siap digunakan!

## Testing Bot

1. Kirim /start ke bot
2. Daftar dengan /daftar NamaAnda
3. Coba menabung dengan /nabung 100000
4. Cek saldo dengan /saldo

## Dashboard Admin
Buka browser: http://localhost:3847/dashboard
Login dengan username dan password dari .env

## Troubleshooting

### Error saat npm install?
Skip package yang error dan jalankan bot tanpa fitur tersebut.

### WhatsApp tidak connect?
1. Pastikan internet stabil
2. Restart bot
3. Hapus folder .wwebjs_auth dan scan ulang

### Database error?
Jalankan: node src/database/migrations.js

## Perintah Bot

- /start - Welcome message
- /daftar [nama] - Daftar akun
- /nabung [nominal] - Menabung
- /saldo - Cek saldo
- /history - Riwayat transaksi
- /goal [nama] [target] - Set target
- /quote - Quote motivasi
- /ai [pertanyaan] - Tanya AI
- /help - Bantuan

## Support
Hubungi developer untuk bantuan lebih lanjut.
