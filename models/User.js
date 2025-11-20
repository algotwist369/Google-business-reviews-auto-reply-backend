const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    googleId: { type: String, required: true, unique: true }, // unique: true automatically creates an index
    name: { type: String },
    email: { type: String },
    avatar: { type: String },
    // We store the access token to make API calls on behalf of the user
    googleAccessToken: { type: String },
    googleRefreshToken: { type: String }, // Refresh token for token renewal

    // Role management
    role: {
        type: String,
        enum: ['user', 'admin', 'super_admin'],
        default: 'user'
        // Index defined below to avoid duplicate (removed index: true to prevent duplicate)
    },

    // Trial management
    trial: {
        enabled: { type: Boolean, default: false },
        startDate: { type: Date },
        endDate: { type: Date },
        days: { type: Number, default: 1 }, // Default 1-day trial
        status: {
            type: String,
            enum: ['not_started', 'active', 'expired', 'converted'],
            default: 'not_started'
        }
    },

    // Subscription/Plan info
    subscription: {
        plan: {
            type: String,
            enum: ['trial', 'free', 'basic', 'pro', 'enterprise'],
            default: 'free'
        },
        status: {
            type: String,
            enum: ['active', 'cancelled', 'expired', 'suspended'],
            default: 'active'
        },
        freeSwitchUsed: { type: Boolean, default: false },
        freeSwitchUsedAt: { type: Date },
        expiresAt: { type: Date },
        paymentProvider: { type: String, enum: ['razorpay', 'manual', 'none'], default: 'none' },
        razorpayCustomerId: { type: String },
        razorpayPaymentId: { type: String },
        razorpayOrderId: { type: String },
        pendingOrder: {
            orderId: { type: String },
            plan: { type: String },
            amount: { type: Number },
            currency: { type: String },
            createdAt: { type: Date }
        }
    },

    autoReplySettings: {
        enabled: { type: Boolean, default: false },
        delayMinutes: { type: Number, default: 3 },
        tone: {
            type: String,
            enum: ['friendly', 'empathetic', 'professional', 'concise'],
            default: 'friendly'
        },
        respondToPositive: { type: Boolean, default: true },
        respondToNeutral: { type: Boolean, default: true },
        respondToNegative: { type: Boolean, default: true },
        lastRunAt: { type: Date },
        lastManualRunAt: { type: Date },
        lastReviewSyncAt: { type: Date }
    },
    autoReplyStats: {
        totals: {
            type: Map,
            of: Number,
            default: {}
        },
        sentLast7d: { type: Number, default: 0 },
        sentAllTime: { type: Number, default: 0 },
        failedTotal: { type: Number, default: 0 },
        updatedAt: { type: Date }
    }
}, { timestamps: true });

// Index for faster lookups
// Note: googleId index is automatically created by unique: true, so we don't need to define it again
UserSchema.index({ email: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ 'trial.status': 1 });
UserSchema.index({ 'subscription.status': 1 });
UserSchema.index({ 'autoReplySettings.enabled': 1 });
UserSchema.index({ 'subscription.pendingOrder.orderId': 1 }, { sparse: true });

module.exports = mongoose.model('User', UserSchema);