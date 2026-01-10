const fs = require('fs').promises;
const path = require('path');
const Tesseract = require('tesseract.js');

async function processScreenshot(imageData, userId) {
    try {
        const uploadPath = process.env.UPLOAD_PATH || './uploads';
        const fileName = `screenshot_${userId}_${Date.now()}.jpg`;
        const filePath = path.join(uploadPath, fileName);
        
        // Ensure upload directory exists
        await fs.mkdir(uploadPath, { recursive: true });
        
        // Save base64 image data to file
        const buffer = Buffer.from(imageData, 'base64');
        await fs.writeFile(filePath, buffer);
        
        console.log(`[OCR] Scanning ${fileName}...`);
        
        // Perform OCR
        const { data: { text } } = await Tesseract.recognize(
            buffer,
            'eng',
            { logger: m => {} }
        );
        
        const lowerText = text.toLowerCase();
        
        // Validation Logic
        const successKeywords = ['berhasil', 'sukses', 'success', 'successful', 'completed', 'selesai', 'transfer'];
        const isSuccess = successKeywords.some(word => lowerText.includes(word));
        
        return {
            valid: true,
            isSuccessKeywordFound: isSuccess,
            extractedText: lowerText,
            filePath: fileName
        };
    } catch (error) {
        console.error('Screenshot processing error:', error);
        return { valid: false, error: error.message };
    }
}

module.exports = { processScreenshot };
