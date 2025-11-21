const jwt = require('jsonwebtoken');
const User = require('../models/User');
const BlacklistedToken = require('../models/BlacklistedToken');
const { AppError } = require('../utils/errorHandler');
const asyncHandler = require('../utils/asyncHandler');
const { hashToken } = require('../utils/tokenUtils');

/**
 * Verify JWT token and attach user to request
 */
const verifyToken = asyncHandler(async (req, res, next) => {
    let token;

    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return next(new AppError('No token provided. Access denied.', 401));
    }

    try {
        const tokenHash = hashToken(token);
        const isBlacklisted = await BlacklistedToken.exists({ tokenHash });
        if (isBlacklisted) {
            return next(new AppError('Session expired. Please log in again.', 401));
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.SESSION_SECRET);
        
        // Get user from token
        const user = await User.findById(decoded.id).select('-__v');
        
        if (!user) {
            return next(new AppError('User not found.', 404));
        }

        // Check if user has valid access token
        if (!user.googleAccessToken) {
            return next(new AppError('Google access token not found. Please re-authenticate.', 401));
        }

        // Attach user to request
        req.user = user;
        next();
    } catch (error) {
        // Log error details for debugging (but don't expose to client)
        if (error.name === 'JsonWebTokenError') {
            console.warn('JWT verification failed: Invalid token format');
            return next(new AppError('Invalid token. Please log in again.', 401));
        }
        if (error.name === 'TokenExpiredError') {
            console.warn('JWT verification failed: Token expired');
            return next(new AppError('Token expired. Please log in again.', 401));
        }
        console.error('Authentication error:', error.message);
        return next(new AppError('Authentication failed. Please log in again.', 401));
    }
});

module.exports = { verifyToken };

