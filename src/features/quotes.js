const { getDatabase } = require('../database/migrations');

async function getMotivationalQuote() {
    const quotes = [
        { text: 'Setiap langkah kecil adalah kemajuan menuju impian besar.', author: 'Anonymous' },
        { text: 'Menabung itu seperti membangun masa depan, satu rupiah demi satu rupiah.', author: 'Anonymous' },
        { text: 'Jangan menunggu waktu yang tepat untuk menabung. Mulailah sekarang!', author: 'Anonymous' }
    ];
    return quotes[Math.floor(Math.random() * quotes.length)];
}

module.exports = { getMotivationalQuote };
