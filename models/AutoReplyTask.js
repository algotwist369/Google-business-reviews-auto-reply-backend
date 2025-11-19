const mongoose = require('mongoose');

const AutoReplyTaskSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        reviewId: { type: String, required: true },
        reviewName: { type: String, required: true },
        accountId: { type: String },
        locationId: { type: String },
        locationName: { type: String },

        reviewerName: { type: String },
        customerName: { type: String },
        starRating: { type: String },
        ratingValue: { type: Number },
        comment: { type: String },
        sentiment: { type: String, enum: ['positive', 'neutral', 'negative'], default: 'neutral' },
        tone: { type: String, default: 'friendly' },

        generatedReply: { type: String },
        scheduledFor: { type: Date, index: true },
        sentAt: { type: Date },
        status: {
            type: String,
            enum: [
                'detected',
                'scheduled',
                'sent',
                'generation_failed',
                'delivery_failed',
                'skipped'
            ],
            default: 'detected',
            index: true
        },
        metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
        analysis: {
            summary: { type: String },
            tone: { type: String },
            sentiment: { type: String },
            addressedName: { type: String }
        },
        error: { type: String },
        lastTriedAt: { type: Date }
    },
    { timestamps: true }
);

AutoReplyTaskSchema.index({ userId: 1, reviewName: 1 }, { unique: true });

module.exports = mongoose.model('AutoReplyTask', AutoReplyTaskSchema);


