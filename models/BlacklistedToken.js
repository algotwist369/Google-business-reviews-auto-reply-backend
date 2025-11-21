const mongoose = require('mongoose');

const BlacklistedTokenSchema = new mongoose.Schema({
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    reason: { type: String },
    createdAt: { type: Date, default: Date.now }
});

BlacklistedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('BlacklistedToken', BlacklistedTokenSchema);


