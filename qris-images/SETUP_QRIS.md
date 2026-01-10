# 📱 CARA SETUP QRIS MANUAL

## Tanpa API Payment Gateway (Gratis)

Bot ini menggunakan sistem QRIS manual karena API payment gateway berbayar. Berikut cara setupnya:

## 1. Siapkan QRIS Anda

### Cara Mendapatkan QRIS:
1. **Dari Bank:**
   - BCA: Buka m-BCA > QRIS > Terima > Screenshot
   - BNI: Buka BNI Mobile > QRIS > Terima Pembayaran
   - Mandiri: Buka Livin' > QRIS > Tampilkan QR
   - BRI: Buka BRImo > QRIS > Terima

2. **Dari E-Wallet:**
   - GoPay: Profil > Kode QR Saya
   - OVO: Profil > QR Code
   - Dana: Profil > Kode QR
   - ShopeePay: Saya > Kode QR Saya
   - LinkAja: Profil > QR Code

## 2. Simpan QRIS ke Bot

1. Screenshot QRIS Anda
2. Simpan dengan nama: **qris-default.jpg**
3. Letakkan di folder: **qris-images/**

## 3. Update Informasi Rekening

Edit file: **src/payments/qris.js**

Ganti bagian ini dengan info Anda:
- account_info: 'NAMA ANDA - No Rekening/HP'
- bank: 'Nama Bank/E-Wallet Anda'

## 4. Alur Pembayaran Manual

1. User ketik /nabung 100000
2. Bot kirim gambar QRIS + instruksi
3. User scan & transfer
4. User kirim screenshot bukti transfer
5. Admin cek manual di app bank/e-wallet
6. Admin konfirmasi di dashboard
7. Saldo user terupdate

## 5. Tips Konfirmasi Pembayaran

**Hal yang perlu dicek admin:**
- Nominal sesuai
- Kode transaksi di catatan
- Waktu transfer
- Nama pengirim

## 6. Multiple QRIS (Opsional)

Untuk beberapa metode pembayaran:
- qris-gopay.jpg
- qris-ovo.jpg
- qris-bca.jpg
- dst

## 7. Keamanan

⚠️ **PENTING:**
- Jangan share QRIS pribadi sembarangan
- Gunakan rekening khusus tabungan
- Cek rutin mutasi rekening
- Backup data transaksi

## 8. Alternatif: Nomor Rekening Manual

Jika tidak mau pakai QRIS, bisa ganti dengan:
- Nomor rekening bank
- Nomor e-wallet
- Virtual account

Edit di handlers.js bagian handleSaving()

## Contoh Setup Lengkap:

1. Ambil QRIS dari GoPay
2. Save sebagai: qris-images/qris-default.jpg
3. Edit qris.js:
   - account_info: 'BUDI SANTOSO - 081234567890'
   - bank: 'GoPay'
4. Jalankan bot
5. Test dengan /nabung 10000

## FAQ

**Q: Aman pakai QRIS pribadi?**
A: Ya, QRIS hanya untuk terima uang, tidak bisa untuk ambil uang.

**Q: Bisa pakai beberapa QRIS?**
A: Bisa, tinggal modifikasi kode untuk pilih QRIS.

**Q: Bagaimana kalau salah konfirmasi?**
A: Bisa dibatalkan manual di database.

**Q: Bisa otomatis tanpa API?**
A: Tidak bisa. Butuh API berbayar untuk otomatis.

## Support

Untuk bantuan setup, hubungi developer.
