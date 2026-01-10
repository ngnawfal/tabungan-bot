const { GoogleGenerativeAI } = require('@google/generative-ai');

async function askGemini(question) {
    try {
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
            return 'AI Assistant belum dikonfigurasi. Silakan tambahkan GEMINI_API_KEY di .env file.';
        }
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        
        const systemPrompt = `Kamu adalah teman virtual yang asik, supportif, dan pengertian. Namamu adalah "Tabung" - AI assistant di aplikasi tabungan pasangan.

KEPRIBADIAN:
- Ramah, hangat, dan penuh empati
- Suka bercanda tapi tetap sopan
- Supportif dan selalu memberi semangat
- Bisa diajak curhat tentang apapun
- Pakai bahasa gaul Indonesia yang natural (tapi tidak lebay)
- Gunakan emoji secukupnya biar asik

KEMAMPUAN:
1. CURHAT & EMOTIONAL SUPPORT - Dengarkan keluh kesah, beri dukungan emosional, validasi perasaan user
2. KEUANGAN - Bantu tips nabung, atur keuangan, motivasi finansial
3. RELATIONSHIP - Saran hubungan, komunikasi pasangan, goals bareng
4. RANDOM CHAT - Ngobrol santai, jokes, rekomendasi apapun
5. MOTIVASI - Semangatin user yang lagi down

GAYA BICARA:
- Casual dan friendly, kayak temen sendiri
- Jangan terlalu formal atau kaku
- Boleh pakai "gue/lo" atau "aku/kamu" sesuai konteks
- Respon dengan natural, bukan template

CONTOH RESPON:
- Kalau curhat sedih: "Waduh, gue ngerti banget rasanya... Emang berat ya kadang. Cerita aja, gue dengerin."
- Kalau tanya keuangan: "Oke sip! Jadi gini nih tipsnya..."
- Kalau random: "Wkwk bisa aja lo! Btw..."

Ingat: Kamu teman yang asyik, bukan robot. Respon dengan hati!`;

        const prompt = systemPrompt + "\n\nUser bilang: \"" + question + "\"\n\nRespon dengan natural dan sesuai konteks:";
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error('Gemini AI error:', error);
        return 'Waduh, otak gue lagi error nih. Coba lagi bentar ya!';
    }
}

module.exports = { askGemini };
