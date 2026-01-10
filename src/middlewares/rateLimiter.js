const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Terlalu banyak request, coba lagi nanti.' },
    handler: (req, res, next, options) => {
        logger.warn('Rate limit exceeded for IP: ' + req.ip);
        res.status(options.statusCode).json(options.message);
    },
    standardHeaders: true,
    legacyHeaders: false
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Terlalu banyak percobaan login, coba lagi dalam 15 menit.' },
    handler: (req, res, next, options) => {
        logger.warn('Login rate limit exceeded for IP: ' + req.ip);
        res.status(options.statusCode).json(options.message);
    },
    standardHeaders: true,
    legacyHeaders: false
});

const heavyOperationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Operasi terlalu sering, coba lagi nanti.' },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = { apiLimiter, loginLimiter, heavyOperationLimiter };
