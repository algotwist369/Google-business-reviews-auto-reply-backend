const jwt = require('jsonwebtoken');
const { AppError } = require('../utils/errorHandler');
const asyncHandler = require('../utils/asyncHandler');
const RefreshToken = require('../models/RefreshToken');
const BlacklistedToken = require('../models/BlacklistedToken');
const { generateSecureToken, hashToken } = require('../utils/tokenUtils');
require('dotenv').config();

const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRES_IN || '1d';
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.JWT_REFRESH_EXPIRES_IN_DAYS || 30);

/**
 * Generate JWT token
 */
const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.SESSION_SECRET, {
        expiresIn: ACCESS_TOKEN_TTL
    });
};

const createRefreshToken = async (userId) => {
    const token = generateSecureToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await RefreshToken.create({
        user: userId,
        tokenHash: hashToken(token),
        expiresAt
    });

    return token;
};

/**
 * Google OAuth callback handler
 */
const googleCallback = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new AppError('Authentication failed.', 401);
    }

    const token = generateToken(req.user._id);
    const refreshToken = await createRefreshToken(req.user._id);
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const params = new URLSearchParams({ token, refreshToken }).toString();

    // Redirect to client with tokens
    res.redirect(`${clientUrl}/auth-success?${params}`);
});

const refreshAccessToken = asyncHandler(async (req, res) => {
    const { refreshToken } = req.body || {};

    if (!refreshToken) {
        throw new AppError('Refresh token is required.', 400);
    }

    const tokenHash = hashToken(refreshToken);
    const existingToken = await RefreshToken.findOne({ tokenHash });

    if (!existingToken || existingToken.revoked || existingToken.expiresAt <= new Date()) {
        throw new AppError('Invalid or expired refresh token.', 401);
    }

    existingToken.revoked = true;
    existingToken.revokedAt = new Date();

    const newRefreshToken = await createRefreshToken(existingToken.user);
    existingToken.replacedByTokenHash = hashToken(newRefreshToken);
    await existingToken.save();

    const newAccessToken = generateToken(existingToken.user);

    res.json({
        success: true,
        token: newAccessToken,
        refreshToken: newRefreshToken
    });
});

const logout = asyncHandler(async (req, res) => {
    const authHeader = req.headers.authorization;
    const { refreshToken } = req.body || {};

    if (!authHeader) {
        throw new AppError('Authorization header missing.', 400);
    }

    const accessToken = authHeader.split(' ')[1];

    if (!accessToken) {
        throw new AppError('Access token missing.', 400);
    }

    let expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    try {
        const decoded = jwt.decode(accessToken);
        if (decoded?.exp) {
            expiresAt = new Date(decoded.exp * 1000);
        }
    } catch (error) {
        // fallback already set
    }

    const accessTokenHash = hashToken(accessToken);
    await BlacklistedToken.updateOne(
        { tokenHash: accessTokenHash },
        { tokenHash: accessTokenHash, expiresAt, reason: 'logout' },
        { upsert: true }
    );

    if (refreshToken) {
        const refreshTokenHash = hashToken(refreshToken);
        await RefreshToken.findOneAndUpdate(
            { tokenHash: refreshTokenHash },
            { revoked: true, revokedAt: new Date() }
        );
    }

    res.json({
        success: true,
        message: 'Logged out successfully.'
    });
});

module.exports = {
    googleCallback,
    refreshAccessToken,
    logout
};


