const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/errorHandler');
const AutoReplyTask = require('../models/AutoReplyTask');
const autoReplyService = require('../services/autoReplyService');
const { AUTO_REPLY } = require('../utils/constants');
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

    res.json({
        success: true,
        data: {
            settings,
            stats,
            options: {
                delayMinutes: AUTO_REPLY.DELAY_OPTIONS_MINUTES,
                tones: AUTO_REPLY.TONES
            }
        }
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

    res.json({
        success: true,
        data: sanitized
    });
});

const listAutoReplyTasks = asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const statusFilter = req.query.status;

    const query = { userId: req.user._id };
    if (statusFilter) {
        query.status = statusFilter;
    }

    const tasks = await AutoReplyTask.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

    res.json({
        success: true,
        data: tasks
    });
});

const runAutoReplyNow = asyncHandler(async (req, res) => {
    const result = await autoReplyService.triggerManualRun(req.user._id);
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

    res.json({
        success: true,
        message: 'Task re-queued'
    });
});

module.exports = {
    getAutoReplyConfig,
    updateAutoReplyConfig,
    listAutoReplyTasks,
    runAutoReplyNow,
    retryAutoReplyTask
};


