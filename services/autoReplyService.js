const User = require('../models/User');
const AutoReplyTask = require('../models/AutoReplyTask');
const googleApiService = require('./googleApiService');
const reviewReplyGenerator = require('./reviewReplyGenerator');
const { AUTO_REPLY, RATING_MAP } = require('../utils/constants');
const websocketService = require('./websocketService');
const cache = require('../utils/cache');
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

    clearReviewCache(userId) {
        if (!userId) return;
        try {
            cache.deleteByPrefix(`reviews:${userId.toString()}:`);
        } catch (error) {
            console.error('Failed to clear review cache for user', userId, error.message);
        }
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
        const user = await User.findById(userId).select('_id name googleAccessToken autoReplySettings');
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
            const users = await User.find({ 'autoReplySettings.enabled': true })
                .select('_id name googleAccessToken autoReplySettings');
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

        const { account, locationsWithReviews, latestReviewTime } = await this.fetchReviews(user);
        if (!account) {
            return { skipped: true, reason: 'no-account' };
        }

        await this.syncTasks(user, locationsWithReviews, delayMs, settings);
        await this.generateReplies(user, settings);
        await this.dispatchReplies(user);

        const nextSettings = {
            ...settings,
            lastRunAt: new Date(),
            lastManualRunAt: manual ? new Date() : settings.lastManualRunAt
        };
        if (latestReviewTime) {
            nextSettings.lastReviewSyncAt = new Date(latestReviewTime);
        }
        user.autoReplySettings = nextSettings;
        await user.save();

        return { success: true, account: account.name, reason };
    }

    async fetchReviews(user) {
        try {
            const accountResponse = await googleApiService.getAccounts(user.googleAccessToken);
            const account = accountResponse.accounts?.[0];
            if (!account) {
                return { account: null, locationsWithReviews: [], latestReviewTime: null };
            }

            const locations = await googleApiService.getLocations(user.googleAccessToken, account.name);
            if (!locations.length) {
                return { account, locationsWithReviews: [], latestReviewTime: null };
            }

            const lastSync = user.autoReplySettings?.lastReviewSyncAt
                ? new Date(user.autoReplySettings.lastReviewSyncAt)
                : null;
            const since =
                lastSync && AUTO_REPLY.SYNC_LOOKBACK_HOURS
                    ? new Date(lastSync.getTime() - AUTO_REPLY.SYNC_LOOKBACK_HOURS * 60 * 60 * 1000)
                    : null;

            const locationsWithReviews = await googleApiService.batchFetchReviews(
                user.googleAccessToken,
                account.name,
                locations,
                since ? { since } : {}
            );

            let latestReviewTime = lastSync ? lastSync.getTime() : 0;
            locationsWithReviews.forEach((loc) => {
                (loc.reviews || []).forEach((review) => {
                    const updatedAt = new Date(review.updateTime || review.createTime || 0).getTime();
                    if (updatedAt > latestReviewTime) {
                        latestReviewTime = updatedAt;
                    }
                });
            });

            return {
                account,
                locationsWithReviews,
                latestReviewTime: latestReviewTime || null
            };
        } catch (error) {
            console.error(`Failed to fetch reviews for user ${user._id}:`, error.message);
            return { account: null, locationsWithReviews: [], latestReviewTime: null };
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
                    
                    // Emit WebSocket event for skipped task
                    try {
                        websocketService.emitToUser(user._id.toString(), 'autoReply:task:updated', {
                            reviewName,
                            status: 'skipped'
                        });
                    } catch (error) {
                        console.error('Failed to emit auto-reply task update:', error);
                    }
                    
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
            try {
                await AutoReplyTask.insertMany(newTasks, { ordered: false });
            } catch (error) {
                if (error?.code === 11000) {
                    console.warn(
                        `[AutoReply] Skipped ${newTasks.length} duplicate tasks for user ${user._id}:`,
                        error.message
                    );
                } else {
                    throw error;
                }
            }

            // Emit WebSocket event for new tasks (consolidated to prevent multiple API calls)
            try {
                // Emit single event that triggers both refreshes
                websocketService.emitToUser(user._id.toString(), 'autoReply:tasks:created', {
                    count: newTasks.length
                });
                // Also update stats
                const stats = await this.getStatsForUser(user._id);
                websocketService.emitToUser(user._id.toString(), 'autoReply:stats:updated', { stats });
            } catch (error) {
                console.error('Failed to emit auto-reply tasks created:', error);
            }
        }

        this.clearReviewCache(user._id);
    }

    async generateReplies(user, settings) {
        const tasks = await AutoReplyTask.find({
            userId: user._id,
            status: 'detected'
        })
            .sort({ createdAt: 1 })
            .limit(MAX_GENERATIONS_PER_CYCLE)
            .select('_id locationName reviewerName ratingValue comment sentiment tone customerName generatedReply')
            .lean();

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

                // Emit WebSocket event for task update
                try {
                    websocketService.emitToUser(user._id.toString(), 'autoReply:task:updated', {
                        taskId: task._id,
                        status: 'scheduled'
                    });
                    // Update stats when task status changes
                    const stats = await this.getStatsForUser(user._id);
                    websocketService.emitToUser(user._id.toString(), 'autoReply:stats:updated', { stats });
                } catch (error) {
                    console.error('Failed to emit auto-reply task update:', error);
                }
            } catch (error) {
                console.error('Failed to generate reply:', error.message);
                const update = {
                    status: 'generation_failed',
                    error: error.message,
                    lastTriedAt: new Date()
                };

                await AutoReplyTask.findOneAndUpdate(
                    { _id: task._id, status: { $ne: 'sent' } },
                    { $set: update }
                );

                // Emit WebSocket event for task failure
                try {
                    websocketService.emitToUser(user._id.toString(), 'autoReply:task:updated', {
                        taskId: task._id,
                        status: 'generation_failed',
                        error: error.message
                    });
                } catch (wsError) {
                    console.error('Failed to emit auto-reply task update:', wsError);
                }
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
            .limit(MAX_DISPATCH_PER_CYCLE)
            .select('_id reviewName generatedReply scheduledFor')
            .lean();

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

                // Emit WebSocket event for successful reply (consolidated)
                try {
                    this.clearReviewCache(user._id);
                    // Update stats
                    const stats = await this.getStatsForUser(user._id);
                    websocketService.emitToUser(user._id.toString(), 'autoReply:stats:updated', { stats });
                    // Emit single event that will trigger refresh
                    websocketService.emitToUser(user._id.toString(), 'autoReply:task:updated', {
                        taskId: task._id,
                        status: 'sent'
                    });
                    // Also refresh reviews since a reply was posted
                    websocketService.emitToUser(user._id.toString(), 'reviews:refresh', {});
                } catch (error) {
                    console.error('Failed to emit auto-reply task update:', error);
                }
            } catch (error) {
                console.error('Failed to post auto-reply:', error.message);
                await AutoReplyTask.findByIdAndUpdate(task._id, {
                    $set: {
                        status: 'delivery_failed',
                        error: error.message,
                        lastTriedAt: new Date()
                    }
                });

                // Emit WebSocket event for delivery failure
                try {
                    websocketService.emitToUser(user._id.toString(), 'autoReply:task:updated', {
                        taskId: task._id,
                        status: 'delivery_failed'
                    });
                } catch (wsError) {
                    console.error('Failed to emit auto-reply task update:', wsError);
                }
            }
        }
    }

    async getStatsForUser(userId) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const [stats] = await AutoReplyTask.aggregate([
            { $match: { userId } },
            {
                $facet: {
                    totals: [{ $group: { _id: '$status', total: { $sum: 1 } } }],
                    sentWindow: [
                        { $match: { status: 'sent', sentAt: { $gte: sevenDaysAgo } } },
                        { $count: 'count' }
                    ]
                }
            }
        ]);

        const totals = (stats?.totals || []).reduce((acc, item) => {
            acc[item._id] = item.total;
            return acc;
        }, {});

        const sentLast7d = stats?.sentWindow?.[0]?.count || 0;
        const sentAllTime = totals.sent || 0;
        const failedTotal = (totals.generation_failed || 0) + (totals.delivery_failed || 0);

        return {
            totals,
            sentLast7d,
            sentAllTime,
            failedTotal
        };
    }
}

module.exports = new AutoReplyService();


