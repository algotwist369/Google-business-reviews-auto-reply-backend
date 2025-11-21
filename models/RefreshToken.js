const mongoose = require('mongoose');

const RefreshTokenSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revoked: { type: Boolean, default: false },
    revokedAt: { type: Date },
    replacedByTokenHash: { type: String },
    createdAt: { type: Date, default: Date.now }
});

RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
RefreshTokenSchema.index({ user: 1 });

module.exports = mongoose.model('RefreshToken', RefreshTokenSchema);


