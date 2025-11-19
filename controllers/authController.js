const jwt = require('jsonwebtoken');
const { AppError } = require('../utils/errorHandler');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Generate JWT token
 */
const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.SESSION_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '1d'
    });
};

/**
 * Google OAuth callback handler
 */
const googleCallback = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new AppError('Authentication failed.', 401);
    }

    const token = generateToken(req.user._id);
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

    // Redirect to client with token
    res.redirect(`${clientUrl}/auth-success?token=${token}`);
});

module.exports = {
    googleCallback
};

