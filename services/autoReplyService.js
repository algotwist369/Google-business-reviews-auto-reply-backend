const User = require('../models/User');
const AutoReplyTask = require('../models/AutoReplyTask');
const googleApiService = require('./googleApiService');
const reviewReplyGenerator = require('./reviewReplyGenerator');
const { AUTO_REPLY, RATING_MAP } = require('../utils/constants');
require('dotenv').config();

const SERVICE_ENABLED = process.env.AUTO_REPLY_SERVICE_ENABLED !== 'false';
const SCAN_INTERVAL_MS = Number(process.env.AUTO_REPLY_SCAN_INTERVAL_MS || 5 * 60 * 1000);
const MAX_GENERATIONS_PER_CYCLE = Number(process.env.AUTO_REPLY_MAX_GENERATE || AUTO_REPLY.MAX_GENERATIONS_PER_CYCLE);
const MAX_DISPATCH_PER_CYCLE = Number(process.env.AUTO_REPLY_MAX_DISPATCH || AUTO_REPLY.MAX_DISPATCH_PER_CYCLE);

class AutoReplyService {
    constructor() {
        this.interval = null;
        this.isRunning = false;
    }

    start() {
        if (!SERVICE_ENABLED) {
            console.log('Auto-reply service disabled via AUTO_REPLY_SERVICE_ENABLED flag.');
            return;
        }

        if (this.interval) {
            return;
        }

        console.log(`Auto-reply service online (interval: ${SCAN_INTERVAL_MS / 1000}s).`);
        this.interval = setInterval(() => this.runCycle('interval'), SCAN_INTERVAL_MS);
        this.runCycle('startup');
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    async triggerManualRun(userId) {
        const user = await User.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }
        const result = await this.runForUser(user, { manual: true });
        user.autoReplySettings = {
            ...this.normalizeSettings(user.autoReplySettings),
            lastManualRunAt: new Date()
        };
        await user.save();
        return result;
    }

    async runCycle(reason = 'interval') {
        if (this.isRunning) {
            return;
        }
        this.isRunning = true;

        try {
            const users = await User.find({ 'autoReplySettings.enabled': true });
            for (const user of users) {
                await this.runForUser(user, { reason });
            }
        } catch (error) {
            console.error('Auto-reply cycle error:', error);
        } finally {
            this.isRunning = false;
        }
    }

    normalizeSettings(settings = {}) {
        return {
            enabled: settings.enabled ?? false,
            delayMinutes: settings.delayMinutes || AUTO_REPLY.DEFAULT_DELAY_MINUTES,
            tone: settings.tone || 'friendly',
            respondToPositive: settings.respondToPositive ?? true,
            respondToNeutral: settings.respondToNeutral ?? true,
            respondToNegative: settings.respondToNegative ?? true,
            lastRunAt: settings.lastRunAt,
            lastManualRunAt: settings.lastManualRunAt
        };
    }

    bucketByRating(ratingValue) {
        if (ratingValue >= 4) return 'positive';
        if (ratingValue === 3) return 'neutral';
        return 'negative';
    }

    async runForUser(user, { manual = false, reason = 'interval' } = {}) {
        const settings = this.normalizeSettings(user.autoReplySettings);
        if (!settings.enabled) {
            return { skipped: true, reason: 'disabled' };
        }

        if (!user.googleAccessToken) {
            console.warn(`Auto-reply skipped (missing token) for user ${user._id}`);
            return { skipped: true, reason: 'missing-token' };
        }

        if (!process.env.OPENAI_API_KEY) {
            console.warn('Auto-reply skipped (missing OPENAI_API_KEY).');
            return { skipped: true, reason: 'missing-openai-key' };
        }

        const delayMs = settings.delayMinutes * 60 * 1000;

        const { account, locationsWithReviews } = await this.fetchReviews(user);
        if (!account) {
            return { skipped: true, reason: 'no-account' };
        }

        await this.syncTasks(user, locationsWithReviews, delayMs, settings);
        await this.generateReplies(user, settings);
        await this.dispatchReplies(user);

        user.autoReplySettings = {
            ...settings,
            lastRunAt: new Date(),
            lastManualRunAt: manual ? new Date() : settings.lastManualRunAt
        };
        await user.save();

        return { success: true, account: account.name, reason };
    }

    async fetchReviews(user) {
        try {
            const accountResponse = await googleApiService.getAccounts(user.googleAccessToken);
            const account = accountResponse.accounts?.[0];
            if (!account) {
                return { account: null, locationsWithReviews: [] };
            }

            const locations = await googleApiService.getLocations(user.googleAccessToken, account.name);
            if (!locations.length) {
                return { account, locationsWithReviews: [] };
            }

            const locationsWithReviews = await googleApiService.batchFetchReviews(
                user.googleAccessToken,
                account.name,
                locations
            );

            return { account, locationsWithReviews };
        } catch (error) {
            console.error(`Failed to fetch reviews for user ${user._id}:`, error.message);
            return { account: null, locationsWithReviews: [] };
        }
    }

    async syncTasks(user, locationsWithReviews, delayMs, settings) {
        const respondMap = {
            positive: settings.respondToPositive,
            neutral: settings.respondToNeutral,
            negative: settings.respondToNegative
        };

        const existingTasks = await AutoReplyTask.find({ userId: user._id })
            .select('reviewName tone status scheduledFor')
            .lean();
        const existingMap = new Map(existingTasks.map(task => [task.reviewName, task]));

        const referenceTimes = existingTasks
            .filter(task => task.status === 'detected' || task.status === 'scheduled')
            .map(task => task.scheduledFor?.getTime?.() || 0);

        let anchorTime = referenceTimes.length
            ? Math.max(...referenceTimes) + delayMs
            : Date.now();

        const newTasks = [];

        for (const location of locationsWithReviews) {
            for (const review of location.reviews || []) {
                const reviewName = review.name;
                const ratingValue = RATING_MAP[review.starRating] || 0;
                const sentimentBucket = this.bucketByRating(ratingValue);

                // If the review already has a reply, mark existing tasks as skipped
                if (review.reviewReply) {
                    await AutoReplyTask.updateOne(
                        { userId: user._id, reviewName },
                        {
                            $set: {
                                status: 'skipped',
                                sentAt: new Date(),
                                error: 'Reply already exists on Google',
                                metadata: {
                                    ...(review.reviewReply || {}),
                                    lastRemoteReply: review.reviewReply?.comment
                                }
                            }
                        }
                    );
                    continue;
                }

                if (!respondMap[sentimentBucket]) {
                    continue;
                }

                const existingTask = existingMap.get(reviewName);
                if (existingTask) {
                    if (existingTask.tone !== settings.tone) {
                        await AutoReplyTask.updateOne(
                            { _id: existingTask._id },
                            { $set: { tone: settings.tone } }
                        );
                    }
                    continue;
                }

                const scheduledFor = new Date(anchorTime);
                newTasks.push({
                    userId: user._id,
                    reviewId: review.reviewId || reviewName,
                    reviewName,
                    accountId: location.accountId,
                    locationId: location.locationId,
                    locationName: location.locationName,
                    reviewerName: review.reviewer?.displayName || review.reviewerName || 'Customer',
                    starRating: review.starRating,
                    ratingValue,
                    comment: review.comment || '',
                    scheduledFor,
                    sentiment: sentimentBucket,
                    tone: settings.tone,
                    metadata: {
                        source: 'google',
                        reviewCreateTime: review.createTime,
                        reviewUpdateTime: review.updateTime
                    }
                });
                anchorTime += delayMs;
            }
        }

        if (newTasks.length) {
            await AutoReplyTask.insertMany(newTasks, { ordered: false });
        }
    }

    async generateReplies(user, settings) {
        const tasks = await AutoReplyTask.find({
            userId: user._id,
            status: 'detected'
        })
            .sort({ createdAt: 1 })
            .limit(MAX_GENERATIONS_PER_CYCLE);

        for (const task of tasks) {
            try {
                const result = await reviewReplyGenerator.generateReply({
                    businessName: user.name || 'our team',
                    locationName: task.locationName || 'our business',
                    reviewerName: task.reviewerName || 'there',
                    ratingValue: task.ratingValue || 0,
                    reviewText: task.comment || '',
                    tone: settings.tone
                });

                await AutoReplyTask.findByIdAndUpdate(task._id, {
                    $set: {
                        generatedReply: result.reply,
                        status: 'scheduled',
                        sentiment: result.sentiment || task.sentiment,
                        tone: result.style || settings.tone,
                        analysis: {
                            summary: result.summary,
                            tone: result.style,
                            sentiment: result.sentiment,
                            addressedName: result.customerName
                        },
                        customerName: result.customerName
                    }
                });
            } catch (error) {
                console.error('Failed to generate reply:', error.message);
                await AutoReplyTask.findByIdAndUpdate(task._id, {
                    $set: {
                        status: 'generation_failed',
                        error: error.message,
                        lastTriedAt: new Date()
                    }
                });
            }
        }
    }

    async dispatchReplies(user) {
        const now = new Date();
        const tasks = await AutoReplyTask.find({
            userId: user._id,
            status: 'scheduled',
            scheduledFor: { $lte: now }
        })
            .sort({ scheduledFor: 1 })
            .limit(MAX_DISPATCH_PER_CYCLE);

        for (const task of tasks) {
            try {
                if (!task.generatedReply) {
                    throw new Error('Missing generated reply');
                }

                await googleApiService.replyToReview(
                    user.googleAccessToken,
                    task.reviewName,
                    task.generatedReply
                );

                await AutoReplyTask.findByIdAndUpdate(task._id, {
                    $set: {
                        status: 'sent',
                        sentAt: new Date(),
                        lastTriedAt: new Date()
                    }
                });
            } catch (error) {
                console.error('Failed to post auto-reply:', error.message);
                await AutoReplyTask.findByIdAndUpdate(task._id, {
                    $set: {
                        status: 'delivery_failed',
                        error: error.message,
                        lastTriedAt: new Date()
                    }
                });
            }
        }
    }

    async getStatsForUser(userId) {
        const pipeline = [
            { $match: { userId } },
            { $group: { _id: '$status', total: { $sum: 1 } } }
        ];
        const aggregates = await AutoReplyTask.aggregate(pipeline);
        const stats = aggregates.reduce((acc, item) => {
            acc[item._id] = item.total;
            return acc;
        }, {});

        const sentLast7d = await AutoReplyTask.countDocuments({
            userId,
            status: 'sent',
            sentAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        });

        return {
            totals: stats,
            sentLast7d
        };
    }
}

module.exports = new AutoReplyService();


