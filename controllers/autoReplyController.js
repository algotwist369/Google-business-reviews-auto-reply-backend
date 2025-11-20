const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/errorHandler');
const AutoReplyTask = require('../models/AutoReplyTask');
const autoReplyService = require('../services/autoReplyService');
const { AUTO_REPLY } = require('../utils/constants');
const websocketService = require('../services/websocketService');
require('dotenv').config();

const sanitizeSettings = (settings = {}) =>
    autoReplyService.normalizeSettings
        ? autoReplyService.normalizeSettings(settings)
        : {
            enabled: settings.enabled ?? false,
            delayMinutes: settings.delayMinutes || AUTO_REPLY.DEFAULT_DELAY_MINUTES,
            tone: settings.tone || 'friendly',
            respondToPositive: settings.respondToPositive ?? true,
            respondToNeutral: settings.respondToNeutral ?? true,
            respondToNegative: settings.respondToNegative ?? true,
            lastRunAt: settings.lastRunAt,
            lastManualRunAt: settings.lastManualRunAt
        };

const getAutoReplyConfig = asyncHandler(async (req, res) => {
    const settings = sanitizeSettings(req.user.autoReplySettings);
    const stats = await autoReplyService.getStatsForUser(req.user._id);

    const response = {
        success: true,
        data: {
            settings,
            stats,
            options: {
                delayMinutes: AUTO_REPLY.DELAY_OPTIONS_MINUTES,
                tones: AUTO_REPLY.TONES
            }
        }
    };

    // Emit WebSocket event for real-time updates
    try {
        websocketService.emitToUser(req.user._id.toString(), 'autoReply:config:updated', {
            settings,
            stats
        });
    } catch (error) {
        console.error('Failed to emit auto-reply config update:', error);
    }

    res.json(response);
});

const getAutoReplyStats = asyncHandler(async (req, res) => {
    const stats = await autoReplyService.getStatsForUser(req.user._id);

    try {
        await req.user.constructor
            .updateOne(
                { _id: req.user._id },
                {
                    $set: {
                        'autoReplyStats.totals': stats.totals || {},
                        'autoReplyStats.sentLast7d': stats.sentLast7d || 0,
                        'autoReplyStats.sentAllTime': stats.sentAllTime || 0,
                        'autoReplyStats.failedTotal': stats.failedTotal || 0,
                        'autoReplyStats.updatedAt': new Date()
                    }
                }
            )
            .exec();
    } catch (error) {
        console.error('Failed to persist auto-reply stats snapshot:', error);
    }

    // Emit WebSocket event so other sessions stay in sync
    try {
        websocketService.emitToUser(req.user._id.toString(), 'autoReply:stats:refresh', {
            stats
        });
    } catch (error) {
        console.error('Failed to emit auto-reply stats refresh:', error);
    }

    res.json({
        success: true,
        data: stats
    });
});

const updateAutoReplyConfig = asyncHandler(async (req, res) => {
    const { enabled, delayMinutes, tone, respondToPositive, respondToNeutral, respondToNegative } =
        req.body || {};

    const updates = {};
    const previousSettings = sanitizeSettings(req.user.autoReplySettings);

    if (enabled !== undefined) updates['autoReplySettings.enabled'] = !!enabled;

    if (delayMinutes !== undefined) {
        if (!AUTO_REPLY.DELAY_OPTIONS_MINUTES.includes(delayMinutes)) {
            throw new AppError('Invalid delay option', 400);
        }
        updates['autoReplySettings.delayMinutes'] = delayMinutes;
    }

    if (tone !== undefined) {
        if (!AUTO_REPLY.TONES.includes(tone)) {
            throw new AppError('Invalid tone option', 400);
        }
        updates['autoReplySettings.tone'] = tone;
    }

    if (respondToPositive !== undefined) updates['autoReplySettings.respondToPositive'] = !!respondToPositive;
    if (respondToNeutral !== undefined) updates['autoReplySettings.respondToNeutral'] = !!respondToNeutral;
    if (respondToNegative !== undefined) updates['autoReplySettings.respondToNegative'] = !!respondToNegative;

    await req.user.updateOne({ $set: updates });
    const refreshedUser = await req.user.constructor.findById(req.user._id);
    const sanitized = sanitizeSettings(refreshedUser.autoReplySettings);

    const wasEnabled = previousSettings.enabled ?? false;
    const isEnabledNow = sanitized.enabled ?? false;

    if (!wasEnabled && isEnabledNow) {
        autoReplyService
            .triggerManualRun(req.user._id)
            .then(() => console.log(`[AutoReply] Initial sync started for user ${req.user._id}`))
            .catch((error) => console.error(`[AutoReply] Initial sync failed for user ${req.user._id}:`, error.message));
    }

    // Emit WebSocket event for real-time updates
    try {
        websocketService.emitToUser(req.user._id.toString(), 'autoReply:settings:updated', {
            settings: sanitized
        });
    } catch (error) {
        console.error('Failed to emit auto-reply settings update:', error);
    }

    res.json({
        success: true,
        data: sanitized
    });
});

const listAutoReplyTasks = asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 200);
    const statusFilter = req.query.status;
    const days = parseInt(req.query.days, 10);

    const query = { userId: req.user._id };
    if (statusFilter) {
        query.status = statusFilter;
    }

    if (!isNaN(days) && days > 0) {
        const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        if (statusFilter === 'sent') {
            query.sentAt = { $gte: sinceDate };
        } else {
            query.createdAt = { $gte: sinceDate };
        }
    }

    const tasks = await AutoReplyTask.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

    // Note: Tasks are also updated via WebSocket from autoReplyService
    // This endpoint is still used for initial load and manual refresh

    res.json({
        success: true,
        data: tasks
    });
});

const runAutoReplyNow = asyncHandler(async (req, res) => {
    const result = await autoReplyService.triggerManualRun(req.user._id);

    // Emit WebSocket event for real-time updates
    try {
        websocketService.emitToUser(req.user._id.toString(), 'autoReply:run:triggered', {
            result
        });
    } catch (error) {
        console.error('Failed to emit auto-reply run update:', error);
    }

    res.json({
        success: true,
        data: result
    });
});

const retryAutoReplyTask = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const task = await AutoReplyTask.findOne({ _id: taskId, userId: req.user._id });

    if (!task) {
        throw new AppError('Task not found', 404);
    }

    let statusUpdate = {};

    if (task.status === 'generation_failed') {
        statusUpdate = { status: 'detected', error: null };
    } else if (task.status === 'delivery_failed') {
        statusUpdate = {
            status: 'scheduled',
            error: null,
            scheduledFor: new Date(Date.now() + (req.user.autoReplySettings?.delayMinutes || AUTO_REPLY.DEFAULT_DELAY_MINUTES) * 60 * 1000)
        };
    } else {
        throw new AppError('Task status cannot be retried', 400);
    }

    await AutoReplyTask.findByIdAndUpdate(task._id, { $set: statusUpdate });

    // Emit WebSocket event for real-time updates (single event to prevent multiple API calls)
    try {
        websocketService.emitToUser(req.user._id.toString(), 'autoReply:task:updated', {
            taskId: task._id,
            status: statusUpdate.status
        });
    } catch (error) {
        console.error('Failed to emit auto-reply task update:', error);
    }

    res.json({
        success: true,
        message: 'Task re-queued'
    });
});

/**
 * Get new reviews (recently detected tasks)
 */
const getNewReviews = asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const hours = parseInt(req.query.hours, 10) || 24; // Default: last 24 hours

    const cutoffDate = new Date(Date.now() - hours * 60 * 60 * 1000);

    const tasks = await AutoReplyTask.find({
        userId: req.user._id,
        status: 'detected',
        createdAt: { $gte: cutoffDate }
    })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

    // Note: WebSocket events are handled by task:updated events to prevent multiple API calls
    // No need to emit separate newReviews:updated event here

    res.json({
        success: true,
        data: tasks,
        meta: {
            count: tasks.length,
            hours
        }
    });
});

module.exports = {
    getAutoReplyConfig,
    getAutoReplyStats,
    updateAutoReplyConfig,
    listAutoReplyTasks,
    runAutoReplyNow,
    retryAutoReplyTask,
    getNewReviews
};


