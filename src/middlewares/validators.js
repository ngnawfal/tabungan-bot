const { body, param, query, validationResult } = require('express-validator');
const logger = require('../utils/logger');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logger.warn('Validation error: ' + JSON.stringify(errors.array()));
        return res.status(400).json({ 
            error: 'Validasi gagal', 
            details: errors.array() 
        });
    }
    next();
};

const loginValidation = [
    body('username')
        .trim()
        .notEmpty().withMessage('Username harus diisi')
        .isLength({ min: 3, max: 50 }).withMessage('Username harus 3-50 karakter'),
    body('password')
        .notEmpty().withMessage('Password harus diisi')
        .isLength({ min: 4, max: 100 }).withMessage('Password harus 4-100 karakter'),
    validate
];

const transactionValidation = [
    body('amount')
        .optional()
        .isInt({ min: 1000, max: 1000000000 }).withMessage('Nominal harus antara Rp 1.000 - Rp 1.000.000.000'),
    body('status')
        .optional()
        .isIn(['pending', 'success', 'cancelled', 'expired']).withMessage('Status tidak valid'),
    validate
];

const userUpdateValidation = [
    body('name')
        .optional()
        .trim()
        .isLength({ min: 2, max: 100 }).withMessage('Nama harus 2-100 karakter')
        .matches(/^[a-zA-Z\s]+$/).withMessage('Nama hanya boleh huruf dan spasi'),
    body('phone_number')
        .optional()
        .matches(/^62\d{9,13}$/).withMessage('Format nomor HP tidak valid (contoh: 628123456789)'),
    validate
];

const idParamValidation = [
    param('id')
        .isInt({ min: 1 }).withMessage('ID tidak valid'),
    validate
];

const messageValidation = [
    body('message')
        .trim()
        .notEmpty().withMessage('Pesan harus diisi')
        .isLength({ max: 5000 }).withMessage('Pesan maksimal 5000 karakter'),
    validate
];

const withdrawalValidation = [
    body('adminNotes')
        .optional()
        .trim()
        .isLength({ max: 500 }).withMessage('Catatan maksimal 500 karakter'),
    validate
];

module.exports = {
    validate,
    loginValidation,
    transactionValidation,
    userUpdateValidation,
    idParamValidation,
    messageValidation,
    withdrawalValidation
};
