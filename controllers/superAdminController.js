const User = require('../models/User');
const Review = require('../models/Review');
const AutoReplyTask = require('../models/AutoReplyTask');
const { AppError } = require('../utils/errorHandler');
const asyncHandler = require('../utils/asyncHandler');
const websocketService = require('../services/websocketService');

/**
 * Get all businesses with pagination and filters
 */
const getAllBusinesses = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Filters
    const role = req.query.role;
    const trialStatus = req.query.trialStatus;
    const subscriptionStatus = req.query.subscriptionStatus;
    const search = req.query.search;

    const query = {};

    if (role && role !== 'all') {
        query.role = role;
    }

    if (trialStatus && trialStatus !== 'all') {
        query['trial.status'] = trialStatus;
    }

    if (subscriptionStatus && subscriptionStatus !== 'all') {
        query['subscription.status'] = subscriptionStatus;
    }

    if (search) {
        query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } }
        ];
    }

    const [users, total] = await Promise.all([
        User.find(query)
            .select('-googleAccessToken -googleRefreshToken')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        User.countDocuments(query)
    ]);

    // Get stats for each user
    const usersWithStats = await Promise.all(
        users.map(async (user) => {
            const [reviewCount, taskCount, sentCount] = await Promise.all([
                Review.countDocuments({ userId: user._id }),
                AutoReplyTask.countDocuments({ userId: user._id }),
                AutoReplyTask.countDocuments({ userId: user._id, status: 'sent' })
            ]);

            return {
                ...user,
                stats: {
                    reviews: reviewCount,
                    tasks: taskCount,
                    sentReplies: sentCount
                }
            };
        })
    );

    const response = {
        success: true,
        data: usersWithStats,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
        }
    };

    // Emit WebSocket event for super admins
    try {
        websocketService.emitToSuperAdmins('superAdmin:businesses:updated', response);
    } catch (error) {
        console.error('Failed to emit super admin businesses update:', error);
    }

    res.json(response);
});

/**
 * Get single business details
 */
const getBusinessDetails = asyncHandler(async (req, res) => {
    const { businessId } = req.params;

    const user = await User.findById(businessId)
        .select('-googleAccessToken -googleRefreshToken')
        .lean();

    if (!user) {
        throw new AppError('Business not found.', 404);
    }

    // Get detailed stats
    const [
        reviews,
        tasks,
        [
            totalReviews,
            totalTasks,
            sentReplies,
            pendingTasks,
            failedTasks
        ]
    ] = await Promise.all([
        Review.find({ userId: businessId })
            .sort({ createTime: -1 })
            .limit(10)
            .lean(),
        AutoReplyTask.find({ userId: businessId })
            .sort({ createdAt: -1 })
            .limit(10)
            .lean(),
        Promise.all([
            Review.countDocuments({ userId: businessId }),
            AutoReplyTask.countDocuments({ userId: businessId }),
            AutoReplyTask.countDocuments({ userId: businessId, status: 'sent' }),
            AutoReplyTask.countDocuments({
                userId: businessId,
                status: { $in: ['detected', 'scheduled'] }
            }),
            AutoReplyTask.countDocuments({
                userId: businessId,
                status: { $in: ['generation_failed', 'delivery_failed'] }
            })
        ])
    ]);

    res.json({
        success: true,
        data: {
            ...user,
            reviews,
            tasks,
            stats: {
                totalReviews,
                totalTasks,
                sentReplies,
                pendingTasks,
                failedTasks
            }
        }
    });
});

/**
 * Enable trial for a business
 */
const enableTrial = asyncHandler(async (req, res) => {
    const { businessId } = req.params;
    const { days = 14 } = req.body;

    if (!days || days < 1 || days > 365) {
        throw new AppError('Trial days must be between 1 and 365.', 400);
    }

    const user = await User.findById(businessId);
    if (!user) {
        throw new AppError('Business not found.', 404);
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    user.trial = {
        enabled: true,
        startDate,
        endDate,
        days,
        status: 'active'
    };

    // Enable auto-reply if trial is active
    if (!user.autoReplySettings.enabled) {
        user.autoReplySettings.enabled = true;
    }

    await user.save();

    // Emit WebSocket event for super admins
    try {
        websocketService.emitToSuperAdmins('superAdmin:business:updated', {
            businessId: businessId,
            trial: user.trial
        });
        websocketService.emitToSuperAdmins('superAdmin:businesses:refresh', {});
        websocketService.emitToSuperAdmins('superAdmin:stats:refresh', {});
    } catch (error) {
        console.error('Failed to emit super admin update:', error);
    }

    res.json({
        success: true,
        message: `Trial enabled for ${days} days.`,
        data: {
            trial: user.trial,
            expiresAt: endDate
        }
    });
});

/**
 * Disable trial for a business
 */
const disableTrial = asyncHandler(async (req, res) => {
    const { businessId } = req.params;

    const user = await User.findById(businessId);
    if (!user) {
        throw new AppError('Business not found.', 404);
    }

    user.trial = {
        enabled: false,
        status: user.trial.status === 'active' ? 'expired' : user.trial.status,
        startDate: user.trial.startDate,
        endDate: user.trial.endDate,
        days: user.trial.days
    };

    await user.save();

    // Emit WebSocket event for super admins
    try {
        websocketService.emitToSuperAdmins('superAdmin:business:updated', {
            businessId: businessId,
            trial: user.trial
        });
        websocketService.emitToSuperAdmins('superAdmin:businesses:refresh', {});
        websocketService.emitToSuperAdmins('superAdmin:stats:refresh', {});
    } catch (error) {
        console.error('Failed to emit super admin update:', error);
    }

    res.json({
        success: true,
        message: 'Trial disabled.',
        data: {
            trial: user.trial
        }
    });
});

/**
 * Update business subscription
 */
const updateSubscription = asyncHandler(async (req, res) => {
    const { businessId } = req.params;
    const { plan, status, expiresAt } = req.body;

    const user = await User.findById(businessId);
    if (!user) {
        throw new AppError('Business not found.', 404);
    }

    if (plan) {
        user.subscription.plan = plan;
    }

    if (status) {
        user.subscription.status = status;
    }

    if (expiresAt) {
        user.subscription.expiresAt = new Date(expiresAt);
    }

    await user.save();

    // Emit WebSocket event for super admins
    try {
        websocketService.emitToSuperAdmins('superAdmin:business:updated', {
            businessId: businessId,
            subscription: user.subscription
        });
        websocketService.emitToSuperAdmins('superAdmin:businesses:refresh', {});
        websocketService.emitToSuperAdmins('superAdmin:stats:refresh', {});
    } catch (error) {
        console.error('Failed to emit super admin update:', error);
    }

    res.json({
        success: true,
        message: 'Subscription updated.',
        data: {
            subscription: user.subscription
        }
    });
});

/**
 * Get dashboard statistics
 */
const getDashboardStats = asyncHandler(async (req, res) => {
    const [
        totalBusinesses,
        activeTrials,
        totalReviews,
        totalReplies,
        activeAutoReply,
        recentSignups
    ] = await Promise.all([
        User.countDocuments({ role: 'user' }),
        User.countDocuments({ 'trial.status': 'active' }),
        Review.countDocuments(),
        AutoReplyTask.countDocuments({ status: 'sent' }),
        User.countDocuments({ 'autoReplySettings.enabled': true }),
        User.countDocuments({
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        })
    ]);

    const [businessesByStatus, businessesByTrial] = await Promise.all([
        User.aggregate([
            { $match: { role: 'user' } },
            { $group: { _id: '$subscription.status', count: { $sum: 1 } } }
        ]),
        User.aggregate([
            { $match: { role: 'user' } },
            { $group: { _id: '$trial.status', count: { $sum: 1 } } }
        ])
    ]);

    const response = {
        success: true,
        data: {
            overview: {
                totalBusinesses,
                activeTrials,
                totalReviews,
                totalReplies,
                activeAutoReply,
                recentSignups
            },
            businessesByStatus: businessesByStatus.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {}),
            businessesByTrial: businessesByTrial.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {})
        }
    };

    // Emit WebSocket event for super admins
    try {
        websocketService.emitToSuperAdmins('superAdmin:stats:updated', response.data);
    } catch (error) {
        console.error('Failed to emit super admin stats update:', error);
    }

    res.json(response);
});

/**
 * Update business role
 */
const updateBusinessRole = asyncHandler(async (req, res) => {
    const { businessId } = req.params;
    const { role } = req.body;

    if (!['user', 'admin', 'super_admin'].includes(role)) {
        throw new AppError('Invalid role.', 400);
    }

    const user = await User.findById(businessId);
    if (!user) {
        throw new AppError('Business not found.', 404);
    }

    user.role = role;
    await user.save();

    // Emit WebSocket event for super admins
    try {
        websocketService.emitToSuperAdmins('superAdmin:business:updated', {
            businessId: businessId,
            role: user.role
        });
        websocketService.emitToSuperAdmins('superAdmin:businesses:refresh', {});
    } catch (error) {
        console.error('Failed to emit super admin update:', error);
    }

    res.json({
        success: true,
        message: `Role updated to ${role}.`,
        data: {
            role: user.role
        }
    });
});

module.exports = {
    getAllBusinesses,
    getBusinessDetails,
    enableTrial,
    disableTrial,
    updateSubscription,
    getDashboardStats,
    updateBusinessRole
};

