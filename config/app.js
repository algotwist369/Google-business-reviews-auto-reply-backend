require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const mongoSanitize = require('express-mongo-sanitize');

const configureApp = (app) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const logDirectory = process.env.LOG_DIRECTORY || path.join(__dirname, '..', 'logs');

    // Ensure log directory exists
    if (!fs.existsSync(logDirectory)) {
        fs.mkdirSync(logDirectory, { recursive: true });
    }

    // Security middleware
    app.use(helmet({
        crossOriginEmbedderPolicy: false,
        crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
    }));

    // Trust first proxy (needed for rate limiting / secure cookies behind load balancer)
    app.set('trust proxy', 1);

    // Request logging
    if (isProduction) {
        const accessLogStream = fs.createWriteStream(path.join(logDirectory, 'access.log'), { flags: 'a' });
        app.use(morgan('combined', { stream: accessLogStream }));
    } else {
        app.use(morgan('dev'));
    }
    
    // Compression middleware for better performance
    app.use(compression());

    // CORS configuration
    const corsOptions = {
        origin: process.env.CLIENT_URL || 'http://localhost:5173',
        credentials: true,
        optionsSuccessStatus: 200
    };
    app.use(cors(corsOptions));

    // Rate limiting
    const limiter = rateLimit({
        windowMs: Number(process.env.RATE_LIMIT_WINDOW_MINUTES || 15) * 60 * 1000,
        max: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 300),
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: {
            success: false,
            error: 'Too many requests. Please try again later.'
        }
    });
    app.use('/api', limiter);
    app.use('/auth', limiter);

    // Body parser middleware
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Sanitize payloads to prevent NoSQL injection without clobbering Express 5 getters
    const sanitizeOptions = { replaceWith: '_' };
    app.use((req, res, next) => {
        if (req.body) {
            mongoSanitize.sanitize(req.body, sanitizeOptions);
        }
        if (req.params) {
            mongoSanitize.sanitize(req.params, sanitizeOptions);
        }
        if (req.query) {
            mongoSanitize.sanitize(req.query, sanitizeOptions);
        }
        next();
    });

    // Request logging middleware (optional, for debugging)
    if (process.env.NODE_ENV === 'development') {
        app.use((req, res, next) => {
            console.log(`${req.method} ${req.path}`);
            next();
        });
    }
};

module.exports = configureApp;

