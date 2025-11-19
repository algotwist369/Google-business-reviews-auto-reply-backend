const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    accountId: { type: String, required: true },
    locationId: { type: String, required: true },
    locationName: { type: String }, // Store name for display (denormalization for speed)

    // Google Data
    reviewId: { type: String, required: true, unique: true }, // Google's unique ID
    reviewerName: { type: String },
    reviewerPhoto: { type: String },
    starRating: { type: String, enum: ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'], index: true },
    comment: { type: String },
    createTime: { type: Date, index: true }, // Index for "Newest/Oldest" sort
    updateTime: { type: Date },

    // Reply Data
    replyComment: { type: String },
    replyTime: { type: Date },
    isReplied: { type: Boolean, default: false, index: true } // Index for "Replied/Unreplied" filter
}, { timestamps: true });

// Compound index for efficient querying per user
ReviewSchema.index({ userId: 1, createTime: -1 });
ReviewSchema.index({ userId: 1, isReplied: 1 });

module.exports = mongoose.model('Review', ReviewSchema);