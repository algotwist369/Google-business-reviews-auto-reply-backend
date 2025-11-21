const crypto = require('crypto');

/**
 * Generate a cryptographically secure random token string
 */
const generateSecureToken = () => crypto.randomBytes(48).toString('hex');

/**
 * Generate a SHA-256 hash for storing tokens securely
 */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = {
    generateSecureToken,
    hashToken
};


