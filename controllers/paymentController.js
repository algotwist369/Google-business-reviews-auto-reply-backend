const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/User');
const { AppError } = require('../utils/errorHandler');
const asyncHandler = require('../utils/asyncHandler');
const { SUBSCRIPTION_PLANS } = require('../utils/constants');
const websocketService = require('../services/websocketService');
require('dotenv').config();

const razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

const getPlanDurationMs = (planKey) => {
    const plan = SUBSCRIPTION_PLANS[planKey];
    if (!plan || !plan.billingCycleDays) {
        return 0;
    }
    return plan.billingCycleDays * 24 * 60 * 60 * 1000;
};

/**
 * Create Razorpay order for subscription
 */
const createCheckoutSession = asyncHandler(async (req, res) => {
    const rawPlan = typeof req.body.plan === 'string' ? req.body.plan.trim() : '';
    const normalizedPlan = rawPlan.toLowerCase();
    const userId = req.user._id.toString();

    console.log('[Payment] Checkout requested', { userId, plan: rawPlan });

    if (!normalizedPlan || !SUBSCRIPTION_PLANS[normalizedPlan]) {
        throw new AppError('Invalid subscription plan.', 400);
    }

    const selectedPlan = SUBSCRIPTION_PLANS[normalizedPlan];
    const user = await User.findById(userId);

    if (!user) {
        throw new AppError('User not found.', 404);
    }

    // Free plan doesn't need payment
    if (normalizedPlan === 'free') {
        user.subscription.plan = 'free';
        user.subscription.status = 'active';
        user.subscription.expiresAt = null;
        user.subscription.paymentProvider = 'none';
        user.subscription.pendingOrder = undefined;
        await user.save();

        return res.json({
            success: true,
            message: 'Switched to free plan.',
            data: {
                subscription: user.subscription
            }
        });
    }

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        throw new AppError('Razorpay configuration missing on server.', 500);
    }

    const amount = selectedPlan.priceInPaise;
    const currency = selectedPlan.currency || 'INR';

    const ts = Date.now().toString(36);
    const receipt = `sub_${userId.slice(-6)}_${ts}`.slice(0, 40);

    let order;
    try {
        order = await razorpayInstance.orders.create({
            amount,
            currency,
            receipt,
            notes: {
                userId,
                plan: normalizedPlan
            }
        });
    } catch (error) {
        console.error('[Payment] Failed to create Razorpay order', error?.error || error?.message || error);
        throw new AppError(
            error?.error?.description || 'Failed to create Razorpay order. Please verify Razorpay credentials.',
            400
        );
    }

    user.subscription.paymentProvider = 'razorpay';
    user.subscription.pendingOrder = {
        orderId: order.id,
        plan: normalizedPlan,
        amount: order.amount,
        currency: order.currency,
        createdAt: new Date()
    };
    await user.save();

    res.json({
        success: true,
        data: {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: process.env.RAZORPAY_KEY_ID,
            customer: {
                name: user.name,
                email: user.email
            },
            plan: {
                key: normalizedPlan,
                name: selectedPlan.name
            }
        }
    });
});

const verifyPayment = asyncHandler(async (req, res) => {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body || {};

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
        throw new AppError('Missing Razorpay verification payload.', 400);
    }

    if (!process.env.RAZORPAY_KEY_SECRET) {
        throw new AppError('Razorpay configuration missing on server.', 500);
    }

    const generatedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

    if (generatedSignature !== razorpay_signature) {
        throw new AppError('Invalid Razorpay signature.', 400);
    }

    const user = await User.findOne({ 'subscription.pendingOrder.orderId': razorpay_order_id });
    if (!user) {
        throw new AppError('Subscription order not found for user.', 404);
    }

    const plan = user.subscription.pendingOrder?.plan;
    const selectedPlan = SUBSCRIPTION_PLANS[plan];
    if (!selectedPlan) {
        throw new AppError('Invalid plan on pending order.', 400);
    }

    user.subscription.plan = plan;
    user.subscription.status = 'active';
    user.subscription.razorpayOrderId = razorpay_order_id;
    user.subscription.razorpayPaymentId = razorpay_payment_id;
    user.subscription.expiresAt = selectedPlan.billingCycleDays
        ? new Date(Date.now() + getPlanDurationMs(plan))
        : null;
    user.subscription.pendingOrder = undefined;

    if (user.trial.status === 'active') {
        user.trial.status = 'converted';
    }

    await user.save();

    try {
        websocketService.emitToUser(user._id.toString(), 'subscription:updated', {
            subscription: user.subscription
        });
    } catch (error) {
        console.error('Failed to emit subscription update:', error);
    }

    res.json({
        success: true,
        data: {
            subscription: user.subscription,
            trial: user.trial
        }
    });
});

/**
 * Handle Razorpay webhook events
 */
const handleWebhook = asyncHandler(async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.error('Razorpay webhook secret missing.');
        return res.status(500).json({ error: 'Webhook secret not configured.' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    const bodyString = rawBody.toString('utf8');
    const expectedSignature = crypto.createHmac('sha256', webhookSecret).update(bodyString).digest('hex');

    if (expectedSignature !== signature) {
        console.error('Razorpay webhook signature mismatch.');
        return res.status(400).json({ error: 'Invalid signature.' });
    }

    const event = JSON.parse(bodyString);

    const handleSuccessfulPayment = async (paymentEntity) => {
        const orderId = paymentEntity?.order_id;
        if (!orderId) {
            return;
        }

        const user = await User.findOne({ 'subscription.pendingOrder.orderId': orderId });
        if (!user) {
            console.error('No user found for Razorpay order:', orderId);
            return;
        }

        const plan = user.subscription.pendingOrder?.plan;
        const selectedPlan = SUBSCRIPTION_PLANS[plan];
        if (!selectedPlan) {
            console.error('Plan not found for pending order:', plan);
            return;
        }

        user.subscription.plan = plan;
        user.subscription.status = 'active';
        user.subscription.razorpayOrderId = orderId;
        user.subscription.razorpayPaymentId = paymentEntity?.id || null;
        user.subscription.expiresAt = selectedPlan.billingCycleDays
            ? new Date(Date.now() + getPlanDurationMs(plan))
            : null;
        user.subscription.pendingOrder = undefined;

        if (user.trial.status === 'active') {
            user.trial.status = 'converted';
        }

        await user.save();

        try {
            websocketService.emitToUser(user._id.toString(), 'subscription:updated', {
                subscription: user.subscription
            });
        } catch (error) {
            console.error('Failed to emit subscription update:', error);
        }
    };

    switch (event.event) {
        case 'payment.captured':
        case 'payment.authorized': {
            const paymentEntity = event.payload?.payment?.entity;
            if (paymentEntity) {
                await handleSuccessfulPayment(paymentEntity);
            }
            break;
        }
        case 'order.paid': {
            const orderEntity = event.payload?.order?.entity;
            const paymentEntity = event.payload?.payment?.entity;
            if (paymentEntity) {
                await handleSuccessfulPayment(paymentEntity);
            } else if (orderEntity) {
                await handleSuccessfulPayment({ order_id: orderEntity?.id });
            }
            break;
        }
        default:
            console.log(`Unhandled Razorpay event: ${event.event}`);
    }

    res.json({ received: true });
});

/**
 * Get subscription plans
 */
const getPlans = asyncHandler(async (req, res) => {
    res.json({
        success: true,
        data: {
            plans: SUBSCRIPTION_PLANS
        }
    });
});

/**
 * Get current user's subscription status
 */
const getSubscriptionStatus = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('subscription trial');

    // Check if trial is expired
    let shouldPersist = false;

    if (user.trial.status === 'active' && user.trial.endDate && new Date() > user.trial.endDate) {
        user.trial.status = 'expired';
        if (user.subscription.plan === 'trial') {
            user.subscription.plan = 'free';
            user.subscription.status = 'expired';
        }
        shouldPersist = true;
    }

    if (user.subscription.expiresAt && new Date() > user.subscription.expiresAt && user.subscription.status === 'active') {
        user.subscription.status = 'expired';
        if (user.subscription.plan !== 'free') {
            user.subscription.plan = 'free';
        }
        shouldPersist = true;
    }

    if (shouldPersist) {
        await user.save();
    }

    res.json({
        success: true,
        data: {
            subscription: user.subscription,
            trial: user.trial
        }
    });
});

/**
 * Cancel subscription (switch to free tier)
 */
const cancelSubscription = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);

    if (!user) {
        throw new AppError('User not found.', 404);
    }

    if (user.subscription.plan === 'free') {
        throw new AppError('No active paid subscription to cancel.', 400);
    }

    user.subscription.plan = 'free';
    user.subscription.status = 'cancelled';
    user.subscription.expiresAt = null;
    user.subscription.razorpayOrderId = null;
    user.subscription.razorpayPaymentId = null;
    user.subscription.pendingOrder = undefined;
    await user.save();

    res.json({
        success: true,
        message: 'Subscription cancelled. You have been moved to the Free plan.',
        data: {
            subscription: user.subscription
        }
    });
});

module.exports = {
    createCheckoutSession,
    handleWebhook,
    verifyPayment,
    getPlans,
    getSubscriptionStatus,
    cancelSubscription
};

