require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { makeString } = require("@agungjsp/qris-dinamis");
const qrcode = require("qrcode");

// Path ke gambar QRIS statis
const QRIS_DIR = path.join(__dirname, "../../qris-images");

function findQRISImage() {
    const possibleFiles = [
        { path: path.join(QRIS_DIR, "Screenshot 2025-11-27 220704.png"), mime: "image/png" },
        { path: path.join(QRIS_DIR, "qris-default.png"), mime: "image/png" },
        { path: path.join(QRIS_DIR, "qris-default.jpg"), mime: "image/jpeg" },
        { path: path.join(QRIS_DIR, "qris-default.jpeg"), mime: "image/jpeg" },
        { path: path.join(QRIS_DIR, "qris-backup.jpg"), mime: "image/jpeg" }
    ];
    
    for (const file of possibleFiles) {
        if (fs.existsSync(file.path)) {
            return file;
        }
    }
    return null;
}

async function generateQRIS(amount, userId) {
    try {
        const transactionId = "TRX_" + Date.now() + "_" + userId;
        const bankName = process.env.PAYMENT_BANK_NAME || "Bank/E-Wallet";
        const accountName = process.env.PAYMENT_ACCOUNT_NAME || "NAMA PENERIMA";
        const accountNumber = process.env.PAYMENT_ACCOUNT_NUMBER || "081234567890";
        
        let qrisImage = null;
        let isDynamic = false;

        // 1. Coba pakai Library @agungjsp/qris-dinamis
        const rawQris = process.env.QRIS_RAW_STRING;
        if (rawQris) {
            try {
                console.log("Generating Dynamic QRIS with @agungjsp/qris-dinamis...");
                
                // FIX: Nominal HARUS string agar library tidak error 'toString of undefined'
                const dynamicString = makeString(rawQris, { nominal: String(amount) });
                
                if (dynamicString) {
                    // Generate QR Image dari string baru
                    qrisImage = await qrcode.toDataURL(dynamicString, {
                        errorCorrectionLevel: 'M',
                        margin: 2,
                        scale: 8
                    });
                    isDynamic = true;
                    console.log("Dynamic QRIS Generated Successfully!");
                }
            } catch (libError) {
                console.error("Library QRIS Error:", libError.message);
                // Lanjut ke fallback static
            }
        }

        // 2. Fallback ke Gambar Statis jika gagal
        if (!qrisImage) {
            const qrisFile = findQRISImage();
            if (qrisFile) {
                const imageBuffer = fs.readFileSync(qrisFile.path);
                qrisImage = "data:" + qrisFile.mime + ";base64," + imageBuffer.toString("base64");
                console.log("Using Static QRIS image (Fallback)");
            } else {
                console.warn("No QRIS image found!");
            }
        }

        // Instruksi
        let instructions = [];
        if (isDynamic) {
            instructions = [
                "1. Scan QRIS di atas dengan aplikasi " + bankName,
                "2. Nominal Rp " + amount.toLocaleString("id-ID") + " akan muncul OTOMATIS",
                "3. Cek nama penerima: " + accountName,
                "4. Lanjutkan pembayaran",
                "5. Kirim screenshot bukti transfer ke sini"
            ];
        } else {
            instructions = [
                "1. Scan QRIS di atas dengan aplikasi " + bankName,
                "2. ⚠️ Masukkan NOMINAL MANUAL: Rp " + amount.toLocaleString("id-ID"),
                "3. Pastikan Nama Penerima: " + accountName,
                "4. Tulis Catatan/Berita: " + transactionId,
                "5. Kirim screenshot bukti transfer ke sini"
            ];
        }
        
        const qrisData = {
            id: transactionId,
            amount: amount,
            merchant: "Tabungan Bersama",
            bank: bankName,
            account_info: accountName + " - " + accountNumber,
            qr_image: qrisImage,
            instructions: instructions.join("\n"),
            transaction_code: transactionId,
            expired_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        };
        
        return qrisData;
    } catch (error) {
        console.error("QRIS generation error:", error);
        throw error;
    }
}

async function validatePayment(transactionId, amount) {
    return {
        valid: false,
        message: "Menunggu konfirmasi admin. Pastikan sudah kirim screenshot bukti transfer.",
        transaction_id: transactionId,
        amount: amount,
        timestamp: new Date().toISOString()
    };
}

async function confirmPayment(transactionId, userId) {
    return {
        valid: true,
        transaction_id: transactionId,
        user_id: userId,
        confirmed_at: new Date().toISOString(),
        confirmed_by: "admin"
    };
}

async function getPendingPayments() {
    return [];
}

module.exports = { 
    generateQRIS, 
    validatePayment, 
    confirmPayment,
    getPendingPayments
};
