const { getUserByPhone, createUser, getBalance, getTransactionHistory, createTransaction, cancelTransaction, expireOldTransactions, getExpiredPendingTransactions, markAsExpired, updateTransactionMessageId, getUserById, updateTransactionScreenshot, getUserByUsername, getUserByVisitorId, linkVisitorToPhone, registerUser, loginUser, logoutUser, isUserLoggedIn, createWithdrawal, getWithdrawalsByUser, createExpense, getExpenses, getExpensesSummary, getTotalExpenses, getExpenseCategories, setBudget, getBudgets, getBudgetByCategory, checkBudgetStatus } = require("../database/models");
const { generateQRIS, confirmPayment } = require("../payments/qris");
const { processScreenshot } = require("../payments/screenshot");
const { getMotivationalQuote } = require("../features/quotes");
const { askGemini } = require("../features/gemini");
const { generateChart } = require("../features/charts");
const { setGoal, getGoals } = require("../features/reminders");
const { generateSavingsChart, calculateGoalProjection } = require("../features/charts");
const { MessageMedia } = require("whatsapp-web.js");
const logger = require("../utils/logger");
const { notifyNewTransaction, notifyNewWithdrawal, notifyScreenshotUploaded } = require("../features/adminNotify");
const { updateStreak, checkAndAwardBadges, getUserBadges, getUserStreak, formatBadgesMessage, formatNewBadgeMessage, formatNewBadgesMessage, getOrCreateStreak } = require("../features/gamification");
const { checkMilestones, getRandomTip } = require("../features/advancedFeatures");

// Track pending registrations, logins, and withdrawals
const pendingRegistrations = new Map(); // visitorId -> { step, data }
const pendingLogins = new Map(); // phone -> { step }
const pendingWithdrawals = new Map(); // visitorId -> { step, data }

// Normalize phone number to proper format
function normalizePhoneNumber(phone) {
    // Remove non-numeric characters
    let cleaned = phone.replace(/\D/g, '');

    // If starts with 0, replace with 62 (Indonesia)
    if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.substring(1);
    }

    // If doesn't start with country code, add 62
    if (!cleaned.startsWith('62') && cleaned.length <= 12) {
        cleaned = '62' + cleaned;
    }

    return cleaned;
}

async function handleMessage(client, message) {
    try {
        // Get visitor ID from message
        let visitorId = message.from.split('@')[0];
        let phoneNumber;

        // Try to find user by visitorId in database
        const userByVisitorId = await getUserByVisitorId(visitorId);
        if (userByVisitorId) {
            phoneNumber = userByVisitorId.phone_number;
            console.log('📱 Found linked user:', visitorId, '→', phoneNumber);
        } else {
            // Not linked yet - use visitorId temporarily
            phoneNumber = visitorId;
            console.log('📱 Visitor not linked:', visitorId);
        }

        // Normalize phone number
        phoneNumber = normalizePhoneNumber(phoneNumber);
        const messageBody = message.body.trim();

        // Handle pending registration flow (use visitorId as key)
        if (pendingRegistrations.has(visitorId)) {
            await handlePendingRegistration(message, visitorId, messageBody);
            return;
        }

        // Handle pending login flow
        if (pendingLogins.has(phoneNumber)) {
            await handlePendingLogin(message, phoneNumber, messageBody);
            return;
        }

        // Handle pending withdrawal flow
        if (pendingWithdrawals.has(visitorId)) {
            await handlePendingWithdrawal(message, visitorId, phoneNumber, messageBody);
            return;
        }

        // Handle media messages (screenshots)
        if (message.hasMedia) {
            const media = await message.downloadMedia();
            if (media && media.mimetype && media.mimetype.startsWith("image/")) {
                await handleScreenshotUpload(message, phoneNumber, media);
                return;
            }
        }

        // Handle commands
        if (messageBody.startsWith("/")) {
            const [command, ...args] = messageBody.split(" ");

            switch (command.toLowerCase()) {
                case "/start":
                    await message.reply("🏁 Selamat datang di Tabungan Bot Bersama!\n\n📝 Perintah Tersedia:\n/daftar - Daftar akun baru\n/login - Login ke akun\n/logout - Keluar dari akun\n/nabung [nominal] - Menabung dengan QRIS\n/tarik - Tarik/ambil tabungan\n/saldo - Cek saldo tabungan\n/history - Lihat riwayat\n/cancel [id] - Batalkan transaksi\n\n💸 PENGELUARAN:\n/catat [nominal] [kategori] - Catat pengeluaran\n/pengeluaran - Lihat ringkasan pengeluaran\n/kategori - Daftar kategori\n\n📊 LAINNYA:\n/laporan - Export laporan & grafik\n/goal - Set target tabungan\n/badge - Lihat badge & streak\n/tips - Tips keuangan harian\n/ai [chat] - Ngobrol sama AI Tabung 🤖\n/help - Bantuan\n\n⚠️ *User baru?* Ketik /daftar untuk mendaftar!");
                    break;

                case "/help":
                    await message.reply("📋 PANDUAN LENGKAP\n\n🔹 AKUN:\n/daftar - Daftar akun baru\n/login - Login ke akun\n/logout - Keluar dari akun\n\n🔹 TABUNGAN:\n/nabung [nominal] - Menabung\n/tarik - Tarik/ambil tabungan\n/saldo - Cek saldo\n/history - Riwayat transaksi\n\n💸 PENGELUARAN:\n/catat [nominal] [kategori] [ket] - Catat pengeluaran\n/pengeluaran - Ringkasan bulan ini\n/kategori - Lihat daftar kategori\n\n🔹 GAMIFIKASI:\n/badge - Lihat badge & streak\n/grafik - Grafik progress\n/proyeksi - Prediksi capai target\n/tips - Tips keuangan\n\n🔹 LAINNYA:\n/cancel [id] - Batalkan transaksi\n/goal [nama] [target] - Set target\n/laporan - Export laporan lengkap\n/quote - Quote motivasi\n/ai [chat] - Ngobrol/curhat sama AI 🤖");
                    break;

                case "/daftar":
                    await handleStartRegistration(message, visitorId);
                    break;

                case "/login":
                    await handleStartLogin(message, phoneNumber);
                    break;

                case "/logout":
                    await handleLogout(message, phoneNumber);
                    break;

                case "/link":
                    await handleLinkAccount(message, visitorId, args);
                    break;

                case "/nabung":
                    await handleSaving(client, message, phoneNumber, args);
                    break;

                case "/saldo":
                    await handleCheckBalance(message, phoneNumber);
                    break;

                case "/history":
                    await handleTransactionHistory(message, phoneNumber);
                    break;

                case "/cancel":
                    await handleCancelTransaction(message, phoneNumber);
                    break;


                case "/laporan":
                    await handleExportReport(message, phoneNumber);
                    break;

                case "/goal":
                    await handleSetGoal(message, phoneNumber, args);
                    break;

                case "/quote":
                    await handleMotivationalQuote(message);
                    break;

                case "/ai":
                    await handleAIAssistant(message, args);
                    break;

                case "/admin":
                    await message.reply("🔗 Dashboard Admin: http://localhost:3847/dashboard\n\n📊 Login dengan username dan password dari file .env");
                    break;

                case "/tarik":
                    await handleStartWithdrawal(message, visitorId, phoneNumber);
                    break;

                case "/badge":
                    await handleBadge(message, phoneNumber);
                    break;

                case "/grafik":
                    await handleGrafik(client, message, phoneNumber);
                    break;

                case "/proyeksi":
                    await handleProyeksi(message, phoneNumber);
                    break;

                case "/tips":
                    await handleTips(message);
                    break;

                case "/catat":
                    await handleCatatPengeluaran(message, phoneNumber, args);
                    break;

                case "/pengeluaran":
                    await handleLihatPengeluaran(message, phoneNumber);
                    break;

                case "/kategori":
                    await handleKategoriPengeluaran(message);
                    break;

                case "/budget":
                    await handleSetBudget(message, phoneNumber, args);
                    break;

                case "/budgets":
                    await handleLihatBudgets(message, phoneNumber);
                    break;

                default:
                    await message.reply("❌ Perintah tidak dikenal. Ketik /help untuk bantuan.");
            }
        }
    } catch (error) {
        console.error("Message handling error:", error);
        await message.reply("❌ Terjadi kesalahan. Silakan coba lagi.");
    }
}

// Start registration process
async function handleStartRegistration(message, visitorId) {
    try {
        // Check if this visitor already linked
        const existingByVisitor = await getUserByVisitorId(visitorId);
        if (existingByVisitor) {
            if (existingByVisitor.username) {
                await message.reply("✅ Anda sudah terdaftar dengan username: " + existingByVisitor.username + "\n\nSilakan /login untuk masuk.");
            } else {
                await message.reply("✅ Anda sudah terdaftar!\n\nSilakan /login untuk masuk.");
            }
            return;
        }

        pendingRegistrations.set(visitorId, { step: 'phone', data: { visitorId } });
        await message.reply("📝 *PENDAFTARAN AKUN BARU*\n\n📱 Masukkan *nomor HP* Anda:\n\n_(Format: 628xxxxxxxxxx)_\n_(Contoh: 6285172092965)_\n\n_(Ketik /batal untuk membatalkan)_");
    } catch (error) {
        console.error("Registration start error:", error);
        await message.reply("❌ Gagal memulai pendaftaran. Silakan coba lagi.");
    }
}

// Handle pending registration steps
async function handlePendingRegistration(message, visitorId, text) {
    try {
        const pending = pendingRegistrations.get(visitorId);

        if (text.toLowerCase() === '/batal') {
            pendingRegistrations.delete(visitorId);
            await message.reply("❌ Pendaftaran dibatalkan.");
            return;
        }

        switch (pending.step) {
            case 'phone':
                // Normalize phone number
                let inputPhone = text.replace(/\D/g, '');
                if (inputPhone.startsWith('0')) {
                    inputPhone = '62' + inputPhone.substring(1);
                }
                if (!inputPhone.startsWith('62')) {
                    inputPhone = '62' + inputPhone;
                }

                // Validate phone format
                if (inputPhone.length < 10 || inputPhone.length > 15) {
                    await message.reply("❌ Format nomor HP tidak valid.\n\nMasukkan nomor dengan format: 628xxxxxxxxxx\nContoh: 6285172092965");
                    return;
                }

                // Check if phone already registered
                const existingPhone = await getUserByPhone(inputPhone);
                if (existingPhone) {
                    await message.reply("❌ Nomor HP " + inputPhone + " sudah terdaftar.\n\nGunakan /login untuk masuk atau hubungi admin.");
                    return;
                }

                pending.data.phone = inputPhone;
                pending.step = 'username';
                pendingRegistrations.set(visitorId, pending);
                await message.reply("✅ Nomor HP: *" + inputPhone + "*\n\n👤 Sekarang masukkan *username* yang diinginkan:\n\n_(Contoh: john123)_");
                break;

            case 'username':
                const existingUsername = await getUserByUsername(text);
                if (existingUsername) {
                    await message.reply("❌ Username sudah digunakan. Silakan pilih username lain:");
                    return;
                }
                if (text.length < 3) {
                    await message.reply("❌ Username minimal 3 karakter. Silakan coba lagi:");
                    return;
                }
                pending.data.username = text;
                pending.step = 'password';
                pendingRegistrations.set(visitorId, pending);
                await message.reply("🔐 Username: *" + text + "*\n\nSekarang masukkan *password* Anda:\n\n_(Minimal 4 karakter)_");
                break;

            case 'password':
                if (text.length < 4) {
                    await message.reply("❌ Password minimal 4 karakter. Silakan coba lagi:");
                    return;
                }
                pending.data.password = text;
                pending.step = 'name';
                pendingRegistrations.set(visitorId, pending);
                await message.reply("✅ Password tersimpan!\n\n👤 Terakhir, masukkan *nama lengkap* Anda:");
                break;

            case 'name':
                const name = text || 'User';
                const phoneNumber = pending.data.phone;

                // Register user with phone number
                const user = await registerUser(phoneNumber, pending.data.username, pending.data.password, name);

                // Link visitor_id to this user
                await linkVisitorToPhone(visitorId, phoneNumber);

                pendingRegistrations.delete(visitorId);

                console.log('🎉 New user registered:', phoneNumber, 'visitor_id:', visitorId);

                await message.reply("🎉 *PENDAFTARAN BERHASIL!*\n\n👤 Nama: " + name + "\n🔑 Username: " + pending.data.username + "\n📱 No. HP: " + phoneNumber + "\n\n✅ Anda sudah login otomatis!\n💰 Mulai menabung dengan /nabung [nominal]");
                break;
        }
    } catch (error) {
        console.error("Registration flow error:", error);
        pendingRegistrations.delete(visitorId);
        await message.reply("❌ Terjadi kesalahan. Silakan coba /daftar lagi.");
    }
}

// Start login process
async function handleStartLogin(message, phoneNumber) {
    try {
        const loggedInUser = await isUserLoggedIn(phoneNumber);
        if (loggedInUser) {
            await message.reply("✅ Anda sudah login sebagai *" + loggedInUser.name + "*\n\nGunakan /logout untuk keluar.");
            return;
        }

        const existingUser = await getUserByPhone(phoneNumber);
        if (!existingUser) {
            await message.reply("❌ Akun tidak ditemukan.\n\n📝 Silakan daftar terlebih dahulu dengan:\n/daftar");
            return;
        }

        if (!existingUser.username) {
            await message.reply("⚠️ Akun Anda belum memiliki username.\n\nSilakan hubungi admin untuk setup akun.");
            return;
        }

        pendingLogins.set(phoneNumber, { step: 'username' });
        await message.reply("🔐 *LOGIN*\n\n👤 Masukkan *username* Anda:\n\n_(Ketik /batal untuk membatalkan)_");
    } catch (error) {
        console.error("Login start error:", error);
        await message.reply("❌ Gagal memulai login. Silakan coba lagi.");
    }
}

// Handle pending login steps  
async function handlePendingLogin(message, phoneNumber, text) {
    try {
        const pending = pendingLogins.get(phoneNumber);

        if (text.toLowerCase() === '/batal') {
            pendingLogins.delete(phoneNumber);
            await message.reply("❌ Login dibatalkan.");
            return;
        }

        switch (pending.step) {
            case 'username':
                pending.username = text;
                pending.step = 'password';
                pendingLogins.set(phoneNumber, pending);
                await message.reply("🔐 Masukkan *password* Anda:");
                break;

            case 'password':
                const user = await loginUser(phoneNumber, pending.username, text);
                pendingLogins.delete(phoneNumber);

                if (user) {
                    await message.reply("✅ *LOGIN BERHASIL!*\n\n👋 Selamat datang kembali, *" + user.name + "*!\n\n💰 Mulai menabung dengan /nabung [nominal]");
                } else {
                    await message.reply("❌ Username atau password salah.\n\nSilakan coba /login lagi.");
                }
                break;
        }
    } catch (error) {
        console.error("Login flow error:", error);
        pendingLogins.delete(phoneNumber);
        await message.reply("❌ Terjadi kesalahan. Silakan coba /login lagi.");
    }
}

// Handle logout
async function handleLogout(message, phoneNumber) {
    try {
        const loggedInUser = await isUserLoggedIn(phoneNumber);
        if (!loggedInUser) {
            await message.reply("⚠️ Anda belum login.\n\nGunakan /login untuk masuk.");
            return;
        }

        await logoutUser(phoneNumber);
        await message.reply("👋 *LOGOUT BERHASIL*\n\nSampai jumpa lagi, *" + loggedInUser.name + "*!\n\nGunakan /login untuk masuk kembali.");
    } catch (error) {
        console.error("Logout error:", error);
        await message.reply("❌ Gagal logout. Silakan coba lagi.");
    }
}

// Handle link account (connect WhatsApp ID to phone number)
async function handleLinkAccount(message, visitorId, args) {
    try {
        if (args.length === 0) {
            await message.reply("🔗 *HUBUNGKAN AKUN*\n\nKetik:\n/link [nomor HP]\n\nContoh:\n/link 6285172092965\n\n_Gunakan nomor yang terdaftar di sistem_");
            return;
        }

        let phoneNumber = args[0].replace(/\D/g, '');

        // Normalize phone number
        if (phoneNumber.startsWith('0')) {
            phoneNumber = '62' + phoneNumber.substring(1);
        }
        if (!phoneNumber.startsWith('62')) {
            phoneNumber = '62' + phoneNumber;
        }

        // Check if user exists with this phone number
        const user = await getUserByPhone(phoneNumber);
        if (!user) {
            await message.reply("❌ Nomor " + phoneNumber + " tidak ditemukan di sistem.\n\nPastikan nomor sudah terdaftar atau hubungi admin.");
            return;
        }

        // Link visitor_id to this phone number
        await linkVisitorToPhone(visitorId, phoneNumber);

        await message.reply("✅ *BERHASIL DIHUBUNGKAN!*\n\n📱 Nomor: " + phoneNumber + "\n👤 Nama: " + user.name + "\n\nSekarang Anda bisa:\n• /login - Masuk ke akun\n• /daftar - Jika belum punya username");

        console.log('🔗 Linked visitor_id:', visitorId, '→', phoneNumber);
    } catch (error) {
        console.error("Link account error:", error);
        await message.reply("❌ Gagal menghubungkan akun. Silakan coba lagi.");
    }
}

async function handleSaving(client, message, phoneNumber, args) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        const amount = parseInt(args[0]);
        if (isNaN(amount) || amount <= 0) {
            await message.reply("❌ Nominal tidak valid!\n\n📝 Format yang benar:\n/nabung [nominal]\n\nContoh:\n/nabung 100000\n/nabung 50000");
            return;
        }

        // Generate QRIS data
        const qrisData = await generateQRIS(amount, user.id);

        // 1. Create transaction first to get the ID
        const transaction = await createTransaction({
            user_id: user.id,
            amount: amount,
            type: "deposit",
            payment_method: "qris",
            confirmed: false,
            qris_id: qrisData.id
        });

        // 2. Buat caption lengkap dengan ID
        let caption = "💰 *PEMBAYARAN TABUNGAN*\n";
        caption += "━━━━━━━━━━━━━━━━\n\n";
        caption += "🆔 ID Transaksi: " + transaction.id + "\n";
        caption += "📊 Nominal: Rp " + amount.toLocaleString("id-ID") + "\n";
        caption += "🏦 " + qrisData.account_info + "\n";
        caption += "🔖 Kode Referensi: " + qrisData.transaction_code + "\n\n";
        caption += "📱 *CARA PEMBAYARAN:*\n";
        caption += qrisData.instructions + "\n\n";
        caption += "⚠️ Batalkan: /cancel " + transaction.id + "\n";
        caption += "⏰ Berlaku 5 menit\n";
        caption += "━━━━━━━━━━━━━━━━\n";
        caption += "📸 Kirim screenshot setelah transfer!";

        let sentMessage;
        // 3. Kirim pesan
        if (qrisData.qr_image) {
            const media = new MessageMedia("image/jpeg", qrisData.qr_image.split(",")[1]);
            sentMessage = await client.sendMessage(message.from, media, { caption: caption });
        } else {
            sentMessage = await message.reply("ℹ️ Gambar QRIS belum tersedia.\n\n" + caption);
        }

        // 4. Update transaction with message_id
        if (sentMessage && sentMessage.id) {
            await updateTransactionMessageId(transaction.id, sentMessage.id._serialized);
        }

        // 5. Notify admin about new transaction
        notifyNewTransaction(transaction, user).catch(err => {
            logger.warn("Failed to notify admin about new transaction:", err.message);
        });

    } catch (error) {
        logger.error("Saving error:", error);
        await message.reply("Gagal membuat pembayaran. Silakan coba lagi.");
    }
}

async function handleCheckBalance(message, phoneNumber) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        const balance = await getBalance(user.id);
        const goals = await getGoals(user.id);

        let response = "💰 INFORMASI SALDO\n";
        response += "━━━━━━━━━━━━━━━━\n\n";
        response += "👤 Nama: " + user.name + "\n";
        response += "💵 Saldo: Rp " + balance.toLocaleString("id-ID") + "\n";

        if (goals && goals.length > 0) {
            response += "\n🎯 TARGET TABUNGAN:\n";
            goals.forEach(goal => {
                const currentAmount = goal.current_amount || 0;
                const progress = goal.target_amount > 0 ? (currentAmount / goal.target_amount * 100).toFixed(1) : 0;
                response += "• " + goal.title + ": " + progress + "%\n";
                response += "  Terkumpul: Rp " + currentAmount.toLocaleString("id-ID") + "\n";
                response += "  Target: Rp " + (goal.target_amount || 0).toLocaleString("id-ID") + "\n";
                if (goal.partner_name) {
                    response += "  👫 Bersama: " + goal.partner_name + "\n";
                }
            });
        }

        response += "\n━━━━━━━━━━━━━━━━";
        await message.reply(response);
    } catch (error) {
        console.error("Balance error:", error);
        await message.reply("❌ Gagal mengecek saldo. Silakan coba lagi.");
    }
}

async function handleTransactionHistory(message, phoneNumber) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        await expireOldTransactions(5);
        const transactions = await getTransactionHistory(user.id, 10);
        if (!transactions || transactions.length === 0) {
            await message.reply("📊 Belum ada transaksi.\n\nMulai menabung dengan /nabung [nominal]");
            return;
        }

        let response = "📊 RIWAYAT TRANSAKSI\n";
        response += "━━━━━━━━━━━━━━━━\n\n";

        transactions.forEach(tx => {
            const date = new Date(tx.created_at).toLocaleDateString("id-ID");
            const type = tx.type === "deposit" ? "➕ Menabung" : "➖ Penarikan";
            let status = "⏳";
            if (tx.confirmed) status = "✅";
            else if (tx.status === "cancelled") status = "❌";
            else if (tx.status === "expired") status = "⚠️";
            response += status + " (ID: " + tx.id + ") " + type + "\n";
            response += "   Rp " + tx.amount.toLocaleString("id-ID") + "\n";
            response += "   " + date + "\n\n";
        });

        response += "━━━━━━━━━━━━━━━━";
        await message.reply(response);
    } catch (error) {
        console.error("History error:", error);
        await message.reply("❌ Gagal mengambil riwayat.");
    }
}

async function handleSetGoal(message, phoneNumber, args) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        if (args.length < 2) {
            await message.reply("❌ Format salah!\n\n📝 Format yang benar:\n/goal [nama target] [nominal]\n\nContoh:\n/goal Rumah 500000000\n/goal Liburan 10000000\n/goal Nikah 100000000");
            return;
        }

        const title = args.slice(0, -1).join(" ");
        const target = parseInt(args[args.length - 1]);

        if (isNaN(target) || target <= 0) {
            await message.reply("❌ Nominal target tidak valid.\n\nPastikan nominal adalah angka tanpa titik atau koma.");
            return;
        }

        const result = await setGoal(user.id, {
            title: title,
            target_amount: target,
            reminder_frequency: "weekly"
        });

        let replyMsg = "🎯 TARGET BERHASIL DIBUAT!\n\n";
        replyMsg += "📌 Target: " + title + "\n";
        replyMsg += "💰 Nominal: Rp " + target.toLocaleString("id-ID") + "\n";

        // Check if partner is linked
        if (result.partner_user_id) {
            const partner = await getUserById(result.partner_user_id);
            if (partner) {
                replyMsg += "👫 Partner: " + partner.name + "\n";
                replyMsg += "📊 Progress: Gabungan saldo kamu & partner\n";
            }
        } else if (user.partner_phone) {
            replyMsg += "⚠️ Partner belum terdaftar di bot\n";
        }

        replyMsg += "📅 Reminder: Setiap minggu\n\n";
        replyMsg += "✨ Semangat menabung untuk mencapai target!";

        await message.reply(replyMsg);
    } catch (error) {
        console.error("Goal error:", error);
        await message.reply("❌ Gagal membuat target. Silakan coba lagi.");
    }
}

async function handleMotivationalQuote(message) {
    try {
        const quote = await getMotivationalQuote();
        await message.reply("💪 QUOTE MOTIVASI HARI INI\n\n✨ \"" + quote.text + "\"\n\n— " + quote.author + "\n\n🎯 Tetap semangat menabung!");
    } catch (error) {
        console.error("Quote error:", error);
        await message.reply("❌ Gagal mendapatkan quote.");
    }
}

async function handleAIAssistant(message, args) {
    try {
        if (args.length === 0) {
            await message.reply("🤖 *Hai! Gue Tabung, AI temen kamu!*\n\n📝 Cara ngobrol sama gue:\n/ai [apapun yang mau diobrolin]\n\n💬 Contoh:\n• /ai lagi sedih nih, butuh temen curhat\n• /ai tips nabung dong buat liburan\n• /ai gimana cara ngomong sama pacar soal keuangan\n• /ai recommend film dong\n• /ai lagi bosen nih\n\n✨ Gue bisa diajak ngobrol apa aja, curhat juga boleh!");
            return;
        }

        const question = args.join(" ");
        await message.reply("💭 Bentar ya, gue mikir dulu...");

        const response = await askGemini(question);
        await message.reply("🤖 *Tabung:*\n\n" + response);
    } catch (error) {
        console.error("AI error:", error);
        await message.reply("😅 Waduh, gue lagi error nih. Coba lagi bentar ya!");
    }
}

async function handleScreenshotUpload(message, phoneNumber, media) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        await message.reply("🔍 Memproses screenshot (OCR)...");

        const result = await processScreenshot(media.data, user.id);

        if (result.valid) {
            let replyMsg = "📸 Screenshot diterima!\n\n";

            // Link to latest pending transaction
            const history = await getTransactionHistory(user.id, 1);
            const latestTx = history.find(t => t.status === 'pending');

            if (latestTx) {
                await updateTransactionScreenshot(latestTx.id, result.filePath);
                replyMsg += "🔗 Bukti ditautkan ke Transaksi ID: " + latestTx.id + "\n";
            } else {
                replyMsg += "⚠️ Tidak ada transaksi pending yang ditemukan untuk ditautkan.\n";
            }

            if (result.isSuccessKeywordFound) {
                replyMsg += "✅ Terdeteksi status: BERHASIL/SUKSES\n";
                replyMsg += "⏳ Status: Menunggu konfirmasi admin (Prioritas)\n";
            } else {
                replyMsg += "⚠️ Tidak terdeteksi kata kunci 'Berhasil' atau 'Sukses'.\n";
                replyMsg += "⏳ Status: Menunggu pengecekan manual admin\n";
            }

            replyMsg += "\n✅ Admin akan mengkonfirmasi pembayaran Anda segera.";
            await message.reply(replyMsg);

            // Notify admin about screenshot upload
            if (latestTx) {
                notifyScreenshotUploaded(latestTx, user).catch(err => {
                    logger.warn("Failed to notify admin about screenshot:", err.message);
                });
            }
        } else {
            await message.reply("Gagal membaca gambar. Pastikan gambar jelas.");
        }

    } catch (error) {
        logger.error("Screenshot error:", error);
        await message.reply("Gagal memproses screenshot. Silakan coba lagi.");
    }
}


async function handleCancelTransaction(message, phoneNumber) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        // Parse arguments
        const args = message.body.trim().split(" ").slice(1);
        const transactionId = args.length > 0 ? args[0] : null;

        const count = await cancelTransaction(user.id, transactionId);

        if (count > 0) {
            if (transactionId) {
                await message.reply("✅ Transaksi ID " + transactionId + " berhasil dibatalkan.");
            } else {
                await message.reply("✅ Berhasil membatalkan " + count + " transaksi pending.\n\n(Gunakan /cancel [ID] untuk membatalkan transaksi tertentu)");
            }
        } else {
            if (transactionId) {
                await message.reply("❌ Transaksi ID " + transactionId + " tidak ditemukan atau statusnya bukan pending.");
            } else {
                await message.reply("ℹ️ Tidak ada transaksi pending yang perlu dibatalkan.");
            }
        }
    } catch (error) {
        console.error("Cancel error:", error);
        await message.reply("❌ Gagal membatalkan transaksi.");
    }
}


async function checkExpiredTransactions(client) {
    try {
        // Check transactions expired (older than 5 mins)
        const expiredTransactions = await getExpiredPendingTransactions(5);

        if (expiredTransactions.length > 0) {
            const ids = expiredTransactions.map(t => t.id);

            // Mark as expired in DB
            await markAsExpired(ids);
            console.log(`Marked ${ids.length} transactions as expired.`);

            for (const tx of expiredTransactions) {
                // Only notify if we have message_id tracked (meaning we sent a QRIS)
                // or just rely on user_id
                if (tx.user_id) {
                    try {
                        const user = await getUserById(tx.user_id);
                        if (user && user.phone_number) {
                            let chatId = user.phone_number + "@c.us";

                            // Try to ensure we have the correct ID format
                            // Sometimes numbers in DB might have different format?
                            // Assuming DB has "62812..." format.

                            // Safe send with catch
                            try {
                                await client.sendMessage(chatId, "⚠️ Transaksi ID " + tx.id + " telah kedaluwarsa (lebih dari 5 menit). Silakan ulangi /nabung jika ingin melanjutkan.");
                            } catch (sendError) {
                                console.error("Failed to send expiry notification to " + chatId + ":", sendError.message);
                            }
                        }
                    } catch (e) {
                        console.error("Error processing expiry for tx " + tx.id, e);
                    }
                }
            }
        }
    } catch (error) {
        console.error("Expiration check error:", error);
    }
}

function startExpirationService(client) {
    // Check every minute
    setInterval(() => checkExpiredTransactions(client), 60 * 1000);
    console.log("⏰ Expiration service started.");
}


async function handleExportReport(message, phoneNumber) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        await message.reply("📊 Sedang membuat laporan keuangan dan prediksi goals...");

        const transactions = await getTransactionHistory(user.id, 100); // Get last 100 for meaningful chart
        const balance = await getBalance(user.id);
        const goals = await getGoals(user.id);

        // Generate Chart
        const chartBase64 = await generateSavingsChart(transactions);

        // Generate Analysis
        const analysis = calculateGoalProjection(balance, goals, transactions);

        let report = "📊 *LAPORAN KEUANGAN & PREDIKSI*\n";
        report += "━━━━━━━━━━━━━━━━\n";
        report += "💰 Saldo Saat Ini: Rp " + balance.toLocaleString("id-ID") + "\n\n";
        report += analysis + "\n";
        report += "━━━━━━━━━━━━━━━━";

        if (chartBase64) {
            const media = new MessageMedia("image/png", chartBase64.split(",")[1]);
            await client.sendMessage(message.from, media, { caption: report });
        } else {
            await message.reply(report + "\n\n(Grafik tidak tersedia karena data belum cukup)");
        }

    } catch (error) {
        console.error("Export error:", error);
        await message.reply("❌ Gagal membuat laporan.");
    }
}

// ============ WITHDRAWAL HANDLERS ============

// Start withdrawal process
async function handleStartWithdrawal(message, visitorId, phoneNumber) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        // Check balance
        const balance = await getBalance(user.id);
        if (balance <= 0) {
            await message.reply("❌ Saldo Anda kosong.\n\nSaldo: Rp 0\n\nSilakan nabung terlebih dahulu dengan /nabung [nominal]");
            return;
        }

        // Start withdrawal flow
        pendingWithdrawals.set(visitorId, {
            step: 'amount',
            data: { userId: user.id, balance: balance }
        });

        let msg = "💸 *PENARIKAN TABUNGAN*\n";
        msg += "━━━━━━━━━━━━━━━━\n\n";
        msg += "💰 Saldo Anda: Rp " + balance.toLocaleString("id-ID") + "\n\n";
        msg += "📝 Masukkan *jumlah penarikan* (dalam angka):\n\n";
        msg += "_Contoh: 100000_\n\n";
        msg += "_(Ketik /batal untuk membatalkan)_";

        await message.reply(msg);
    } catch (error) {
        console.error("Withdrawal start error:", error);
        await message.reply("❌ Gagal memulai penarikan. Silakan coba lagi.");
    }
}

// Handle pending withdrawal steps
async function handlePendingWithdrawal(message, visitorId, phoneNumber, text) {
    try {
        const pending = pendingWithdrawals.get(visitorId);

        if (text.toLowerCase() === '/batal') {
            pendingWithdrawals.delete(visitorId);
            await message.reply("❌ Penarikan dibatalkan.");
            return;
        }

        switch (pending.step) {
            case 'amount':
                const amount = parseInt(text.replace(/\D/g, ''));
                if (isNaN(amount) || amount <= 0) {
                    await message.reply("❌ Jumlah tidak valid.\n\nMasukkan angka tanpa titik/koma.\nContoh: 100000");
                    return;
                }
                if (amount > pending.data.balance) {
                    await message.reply("❌ Jumlah melebihi saldo!\n\nSaldo Anda: Rp " + pending.data.balance.toLocaleString("id-ID") + "\n\nMasukkan jumlah yang lebih kecil:");
                    return;
                }
                if (amount < 10000) {
                    await message.reply("❌ Minimal penarikan Rp 10.000\n\nMasukkan jumlah yang lebih besar:");
                    return;
                }

                pending.data.amount = amount;
                pending.step = 'account_type';
                pendingWithdrawals.set(visitorId, pending);

                let typeMsg = "✅ Jumlah: Rp " + amount.toLocaleString("id-ID") + "\n\n";
                typeMsg += "🏦 Pilih *tujuan transfer*:\n\n";
                typeMsg += "1. Bank (BCA, BNI, BRI, Mandiri, dll)\n";
                typeMsg += "2. E-Wallet (GoPay, OVO, DANA, ShopeePay, dll)\n\n";
                typeMsg += "Ketik angka 1 atau 2:";
                await message.reply(typeMsg);
                break;

            case 'account_type':
                let accountType = '';
                if (text === '1' || text.toLowerCase().includes('bank')) {
                    accountType = 'bank';
                } else if (text === '2' || text.toLowerCase().includes('wallet') || text.toLowerCase().includes('ewallet')) {
                    accountType = 'e-wallet';
                } else {
                    await message.reply("❌ Pilihan tidak valid.\n\nKetik 1 untuk Bank atau 2 untuk E-Wallet:");
                    return;
                }

                pending.data.accountType = accountType;
                pending.step = 'account_number';
                pendingWithdrawals.set(visitorId, pending);

                if (accountType === 'bank') {
                    await message.reply("🏦 Masukkan *nomor rekening* dan *nama bank*:\n\n_Contoh: BCA 1234567890_");
                } else {
                    await message.reply("📱 Masukkan *nomor E-Wallet* dan *nama platform*:\n\n_Contoh: DANA 085172092965_");
                }
                break;

            case 'account_number':
                if (text.length < 5) {
                    await message.reply("❌ Data tidak valid. Masukkan nomor rekening/e-wallet beserta nama bank/platform.\n\n_Contoh: BCA 1234567890_");
                    return;
                }

                pending.data.accountNumber = text;
                pending.step = 'account_name';
                pendingWithdrawals.set(visitorId, pending);

                await message.reply("👤 Masukkan *nama pemilik rekening/akun*:\n\n_Nama harus sesuai dengan rekening tujuan_");
                break;

            case 'account_name':
                if (text.length < 2) {
                    await message.reply("❌ Nama tidak valid. Masukkan nama lengkap pemilik rekening:");
                    return;
                }

                pending.data.accountName = text;

                // Create withdrawal request
                const withdrawal = await createWithdrawal(
                    pending.data.userId,
                    pending.data.amount,
                    pending.data.accountType,
                    pending.data.accountNumber,
                    pending.data.accountName
                );

                pendingWithdrawals.delete(visitorId);

                let confirmMsg = "✅ *PERMINTAAN PENARIKAN DITERIMA*\n";
                confirmMsg += "━━━━━━━━━━━━━━━━\n\n";
                confirmMsg += "🆔 ID Penarikan: #" + withdrawal.id + "\n";
                confirmMsg += "💰 Jumlah: Rp " + pending.data.amount.toLocaleString("id-ID") + "\n";
                confirmMsg += "🏦 Tujuan: " + pending.data.accountType.toUpperCase() + "\n";
                confirmMsg += "📝 " + pending.data.accountNumber + "\n";
                confirmMsg += "👤 a.n. " + pending.data.accountName + "\n\n";
                confirmMsg += "⏳ Status: *MENUNGGU KONFIRMASI ADMIN*\n\n";
                confirmMsg += "📌 Admin akan memproses dan mentransfer dana Anda.\n";
                confirmMsg += "📱 Anda akan mendapat notifikasi setelah transfer berhasil/gagal.\n";
                confirmMsg += "━━━━━━━━━━━━━━━━";

                await message.reply(confirmMsg);
                logger.info("New withdrawal request: " + JSON.stringify(withdrawal));

                // Notify admin about new withdrawal
                const user = await getUserById(pending.data.userId);
                notifyNewWithdrawal(withdrawal, user).catch(err => {
                    logger.warn("Failed to notify admin about withdrawal:", err.message);
                });
                break;
        }
    } catch (error) {
        logger.error("Withdrawal flow error:", error);
        pendingWithdrawals.delete(visitorId);
        await message.reply("Terjadi kesalahan. Silakan coba /tarik lagi.");
    }
}

// ============ GAMIFICATION HANDLERS ============

// Handle badge command
async function handleBadge(message, phoneNumber) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        const badges = await getUserBadges(user.id);
        const streak = await getUserStreak(user.id);

        const response = formatBadgesMessage(badges, streak);
        await message.reply(response);
    } catch (error) {
        console.error("Badge error:", error);
        await message.reply("❌ Gagal mengambil data badge.");
    }
}

// Handle grafik command
async function handleGrafik(client, message, phoneNumber) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        await message.reply("📊 Sedang membuat grafik progress...");

        const transactions = await getTransactionHistory(user.id, 100);
        const balance = await getBalance(user.id);

        const chartBase64 = await generateSavingsChart(transactions);

        if (chartBase64) {
            let caption = "📈 *GRAFIK PROGRESS TABUNGAN*\n";
            caption += "━━━━━━━━━━━━━━━━\n\n";
            caption += "💰 Saldo Saat Ini: Rp " + balance.toLocaleString("id-ID") + "\n";
            caption += "📊 Total Transaksi: " + transactions.filter(t => t.confirmed).length + "\n\n";
            caption += "━━━━━━━━━━━━━━━━\n";
            caption += "💡 Terus konsisten menabung!";

            const media = new MessageMedia("image/png", chartBase64.split(",")[1]);
            await client.sendMessage(message.from, media, { caption: caption });
        } else {
            await message.reply("📊 Data belum cukup untuk membuat grafik.\n\nMulai menabung dengan /nabung [nominal]");
        }
    } catch (error) {
        console.error("Grafik error:", error);
        await message.reply("❌ Gagal membuat grafik.");
    }
}

// Handle proyeksi command
async function handleProyeksi(message, phoneNumber) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        const transactions = await getTransactionHistory(user.id, 100);
        const balance = await getBalance(user.id);
        const goals = await getGoals(user.id);

        const analysis = calculateGoalProjection(balance, goals, transactions);

        let response = "🧮 *KALKULATOR PROYEKSI*\n";
        response += "━━━━━━━━━━━━━━━━\n\n";
        response += "💰 Saldo: Rp " + balance.toLocaleString("id-ID") + "\n\n";
        response += analysis + "\n\n";
        response += "━━━━━━━━━━━━━━━━\n";
        response += "💡 Set target dengan /goal [nama] [nominal]";

        await message.reply(response);
    } catch (error) {
        console.error("Proyeksi error:", error);
        await message.reply("❌ Gagal menghitung proyeksi.");
    }
}

// Handle tips command
async function handleTips(message) {
    try {
        const tip = await getRandomTip();

        let response = "💡 *TIPS KEUANGAN HARI INI*\n";
        response += "━━━━━━━━━━━━━━━━\n\n";
        response += "📌 " + tip + "\n\n";
        response += "━━━━━━━━━━━━━━━━\n";
        response += "🎯 Tetap semangat menabung!";

        await message.reply(response);
    } catch (error) {
        console.error("Tips error:", error);
        await message.reply("❌ Gagal mengambil tips.");
    }
}

// Process gamification after successful deposit
async function processGamificationOnDeposit(client, user, balance, txCount) {
    try {
        // Update streak
        const streak = await updateStreak(user.id);

        // Check for goals
        const goals = await getGoals(user.id);
        const hasGoal = goals && goals.length > 0;
        const goalComplete = goals.some(g => (g.current_amount || 0) >= g.target_amount);

        // Check and award badges
        const newBadges = await checkAndAwardBadges(user.id, balance, txCount, streak, hasGoal, goalComplete);

        // Send combined badge notification (1 message for all new badges)
        if (newBadges && newBadges.length > 0) {
            const badgeMsg = formatNewBadgesMessage(newBadges, balance);
            if (badgeMsg) {
                try {
                    const chatId = user.phone_number + "@c.us";
                    await client.sendMessage(chatId, badgeMsg);
                } catch (e) {
                    console.error("Failed to send badge notification:", e.message);
                }
            }
        }

        // Check milestones
        if (goals && goals.length > 0) {
            const milestoneMessages = await checkMilestones(user.id, goals, balance);
            for (const msg of milestoneMessages) {
                try {
                    const chatId = user.phone_number + "@c.us";
                    await client.sendMessage(chatId, msg);
                } catch (e) {
                    console.error("Failed to send milestone notification:", e.message);
                }
            }
        }

        return { streak, newBadges };
    } catch (error) {
        console.error("Gamification processing error:", error);
        return { streak: null, newBadges: [] };
    }
}

// ============ EXPENSE HANDLERS ============

// Handle /catat command - Record expense
async function handleCatatPengeluaran(message, phoneNumber, args) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        if (args.length < 2) {
            await message.reply("❌ Format salah!\n\n📝 Format yang benar:\n/catat [nominal] [kategori] [keterangan]\n\nContoh:\n/catat 50000 makanan makan siang\n/catat 150000 transport bensin motor\n/catat 500000 tagihan listrik\n\n📋 Lihat kategori dengan /kategori");
            return;
        }

        const amount = parseInt(args[0]);
        if (isNaN(amount) || amount <= 0) {
            await message.reply("❌ Nominal tidak valid!\n\nGunakan angka positif tanpa titik/koma.\nContoh: /catat 50000 makanan");
            return;
        }

        const category = args[1].toLowerCase();
        const description = args.slice(2).join(" ") || null;

        // Validate category
        const categories = await getExpenseCategories();
        const validCategories = categories.map(c => c.code);

        if (!validCategories.includes(category)) {
            const catList = categories.map(c => `${c.icon} ${c.code}`).join("\n");
            await message.reply("❌ Kategori tidak valid!\n\n📋 Kategori tersedia:\n" + catList + "\n\nContoh: /catat 50000 makanan");
            return;
        }

        // Create expense
        const expense = await createExpense(user.id, amount, category, description);
        const catInfo = categories.find(c => c.code === category);

        let reply = "✅ *PENGELUARAN TERCATAT!*\n\n";
        reply += `🆔 ID: ${expense.id}\n`;
        reply += `💸 Nominal: Rp ${amount.toLocaleString("id-ID")}\n`;
        reply += `${catInfo.icon} Kategori: ${catInfo.name}\n`;
        if (description) reply += `📝 Keterangan: ${description}\n`;

        // Check budget for this category
        const budget = await getBudgetByCategory(user.id, category);
        if (budget) {
            const now = new Date();
            const currentMonth = now.toISOString().slice(0, 7);
            const totalSpent = await getTotalExpenses(user.id, currentMonth);
            const categoryExpenses = await getExpenses(user.id, { category, month: currentMonth });
            const categorySpent = categoryExpenses.reduce((sum, e) => sum + e.amount, 0);

            const percent = ((categorySpent / budget.monthly_limit) * 100).toFixed(1);
            const remaining = budget.monthly_limit - categorySpent;

            if (categorySpent > budget.monthly_limit) {
                reply += `\n🚨 *PERINGATAN: BUDGET TERLAMPAUI!*\n`;
                reply += `   Limit: Rp ${budget.monthly_limit.toLocaleString("id-ID")}\n`;
                reply += `   Terpakai: Rp ${categorySpent.toLocaleString("id-ID")} (${percent}%)\n`;
                reply += `   Lebih: Rp ${Math.abs(remaining).toLocaleString("id-ID")}\n`;
            } else if (percent >= 80) {
                reply += `\n⚠️ *Perhatian: Budget hampir habis!*\n`;
                reply += `   Terpakai: ${percent}% | Sisa: Rp ${remaining.toLocaleString("id-ID")}\n`;
            }
        }

        reply += `\n📊 Lihat ringkasan: /pengeluaran`;

        await message.reply(reply);
    } catch (error) {
        console.error("Catat pengeluaran error:", error);
        await message.reply("❌ Gagal mencatat pengeluaran. Silakan coba lagi.");
    }
}

// Handle /pengeluaran command - View expense summary
async function handleLihatPengeluaran(message, phoneNumber) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        const now = new Date();
        const currentMonth = now.toISOString().slice(0, 7); // Format: YYYY-MM

        // Get summary and total
        const summary = await getExpensesSummary(user.id, currentMonth);
        const total = await getTotalExpenses(user.id, currentMonth);
        const recentExpenses = await getExpenses(user.id, { limit: 5, month: currentMonth });

        const monthName = now.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

        let reply = `💸 *PENGELUARAN ${monthName.toUpperCase()}*\n`;
        reply += "━━━━━━━━━━━━━━━━\n\n";
        reply += `💰 Total: *Rp ${total.toLocaleString("id-ID")}*\n\n`;

        if (summary.length > 0) {
            reply += "📊 *Per Kategori:*\n";
            summary.forEach(s => {
                const percent = total > 0 ? ((s.total / total) * 100).toFixed(1) : 0;
                reply += `${s.category_icon || "•"} ${s.category_name || s.category}: Rp ${s.total.toLocaleString("id-ID")} (${percent}%)\n`;
            });
        } else {
            reply += "📊 Belum ada pengeluaran bulan ini.\n";
        }

        if (recentExpenses.length > 0) {
            reply += "\n📝 *5 Pengeluaran Terakhir:*\n";
            recentExpenses.forEach(e => {
                const date = new Date(e.created_at).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
                reply += `• ${e.category_icon || ""} Rp ${e.amount.toLocaleString("id-ID")} - ${e.description || e.category} (${date})\n`;
            });
        }

        reply += "\n━━━━━━━━━━━━━━━━\n";
        reply += "📝 Catat baru: /catat [nominal] [kategori] [ket]";

        await message.reply(reply);
    } catch (error) {
        console.error("Lihat pengeluaran error:", error);
        await message.reply("❌ Gagal mengambil data pengeluaran.");
    }
}

// Handle /kategori command - Show expense categories
async function handleKategoriPengeluaran(message) {
    try {
        const categories = await getExpenseCategories();

        let reply = "📋 *KATEGORI PENGELUARAN*\n";
        reply += "━━━━━━━━━━━━━━━━\n\n";

        if (categories.length > 0) {
            categories.forEach(cat => {
                reply += `${cat.icon} *${cat.code}* - ${cat.name}\n`;
            });
        } else {
            reply += "🍔 makanan - Makanan & Minuman\n";
            reply += "🚗 transport - Transportasi\n";
            reply += "🛒 belanja - Belanja\n";
            reply += "💡 tagihan - Tagihan\n";
            reply += "🎮 hiburan - Hiburan\n";
            reply += "💊 kesehatan - Kesehatan\n";
            reply += "📚 pendidikan - Pendidikan\n";
            reply += "🏠 rumah - Rumah Tangga\n";
            reply += "💼 bisnis - Bisnis\n";
            reply += "❓ lainnya - Lainnya\n";
        }

        reply += "\n━━━━━━━━━━━━━━━━\n";
        reply += "📝 Contoh: /catat 50000 makanan nasi goreng";

        await message.reply(reply);
    } catch (error) {
        console.error("Kategori error:", error);
        await message.reply("❌ Gagal mengambil daftar kategori.");
    }
}

// ============ BUDGET HANDLERS ============

// Handle /budget command - Set budget limit
async function handleSetBudget(message, phoneNumber, args) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        if (args.length < 2) {
            await message.reply("❌ Format salah!\n\n📝 Format yang benar:\n/budget [kategori] [limit]\n\nContoh:\n/budget makanan 500000\n/budget transport 300000\n\n📋 Lihat kategori: /kategori\n📊 Lihat budget: /budgets");
            return;
        }

        const category = args[0].toLowerCase();
        const limit = parseInt(args[1]);

        if (isNaN(limit) || limit <= 0) {
            await message.reply("❌ Limit harus angka positif!\n\nContoh: /budget makanan 500000");
            return;
        }

        // Validate category
        const categories = await getExpenseCategories();
        const validCategories = categories.map(c => c.code);

        if (!validCategories.includes(category)) {
            const catList = categories.map(c => `${c.icon} ${c.code}`).join("\n");
            await message.reply("❌ Kategori tidak valid!\n\n📋 Kategori tersedia:\n" + catList);
            return;
        }

        // Set budget
        await setBudget(user.id, category, limit);
        const catInfo = categories.find(c => c.code === category);

        let reply = "✅ *BUDGET BERHASIL DISET!*\n\n";
        reply += `${catInfo.icon} Kategori: ${catInfo.name}\n`;
        reply += `💰 Limit Bulanan: Rp ${limit.toLocaleString("id-ID")}\n\n`;
        reply += `📊 Lihat semua budget: /budgets`;

        await message.reply(reply);
    } catch (error) {
        console.error("Set budget error:", error);
        await message.reply("❌ Gagal set budget. Silakan coba lagi.");
    }
}

// Handle /budgets command - View all budgets
async function handleLihatBudgets(message, phoneNumber) {
    try {
        const user = await isUserLoggedIn(phoneNumber);
        if (!user) {
            await message.reply("❌ Anda belum login.\n\nSilakan /login terlebih dahulu.");
            return;
        }

        const now = new Date();
        const currentMonth = now.toISOString().slice(0, 7);
        const monthName = now.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

        // Get budget status with spending
        const budgetStatus = await checkBudgetStatus(user.id, currentMonth);

        if (budgetStatus.length === 0) {
            await message.reply("📊 *BUDGET BULANAN*\n\nBelum ada budget yang diset.\n\n📝 Set budget:\n/budget [kategori] [limit]\n\nContoh:\n/budget makanan 500000");
            return;
        }

        let reply = `📊 *BUDGET ${monthName.toUpperCase()}*\n`;
        reply += "━━━━━━━━━━━━━━━━\n\n";

        budgetStatus.forEach(b => {
            const spent = b.spent || 0;
            const limit = b.monthly_limit;
            const percent = limit > 0 ? ((spent / limit) * 100).toFixed(1) : 0;
            const remaining = limit - spent;

            let status = "✅";
            if (percent >= 100) status = "🚨";
            else if (percent >= 80) status = "⚠️";

            reply += `${b.category_icon || "•"} *${b.category_name || b.category}*\n`;
            reply += `   💸 Terpakai: Rp ${spent.toLocaleString("id-ID")} (${percent}%)\n`;
            reply += `   💰 Limit: Rp ${limit.toLocaleString("id-ID")}\n`;
            reply += `   ${status} Sisa: Rp ${remaining.toLocaleString("id-ID")}\n\n`;
        });

        reply += "━━━━━━━━━━━━━━━━\n";
        reply += "📝 Ubah: /budget [kategori] [limit]";

        await message.reply(reply);
    } catch (error) {
        console.error("Lihat budgets error:", error);
        await message.reply("❌ Gagal mengambil data budget.");
    }
}

module.exports = { handleMessage, startExpirationService, processGamificationOnDeposit };
