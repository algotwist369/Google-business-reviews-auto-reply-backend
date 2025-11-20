const { z } = require('zod');
const { AUTO_REPLY, SUBSCRIPTION_PLANS } = require('../utils/constants');

const objectIdRegex = /^[a-f\d]{24}$/i;
const objectIdSchema = z.string().regex(objectIdRegex, 'Invalid identifier supplied.');
const taskIdSchema = z.string().regex(objectIdRegex, 'Invalid taskId.');
const numberPreprocessor = (schema) =>
    z.preprocess(
        (value) => {
            if (value === undefined || value === null || value === '') {
                return undefined;
            }
            const parsed = Number(value);
            return Number.isNaN(parsed) ? value : parsed;
        },
        schema
    );

const reviewSchemas = {
    replyBody: z.object({
        reviewName: z.string().min(1, 'reviewName is required.').trim(),
        comment: z.string().min(1, 'comment is required.').trim()
    }),
    aiReplyBody: z.object({
        reviewName: z.string().min(1, 'reviewName is required.').trim(),
        reviewText: z.string().min(1, 'reviewText is required.').trim(),
        ratingValue: numberPreprocessor(z.number().min(0).max(5)).optional(),
        reviewerName: z.string().trim().optional(),
        locationName: z.string().trim().optional()
    })
};

const autoReplySchemas = {
    updateConfigBody: z.object({
        enabled: z.boolean().optional(),
        delayMinutes: numberPreprocessor(z.number().int()).optional().refine(
            (value) => value === undefined || AUTO_REPLY.DELAY_OPTIONS_MINUTES.includes(value),
            `delayMinutes must be one of ${AUTO_REPLY.DELAY_OPTIONS_MINUTES.join(', ')}.`
        ),
        tone: z.string().optional().refine(
            (value) => value === undefined || AUTO_REPLY.TONES.includes(value),
            `tone must be one of ${AUTO_REPLY.TONES.join(', ')}.`
        ),
        respondToPositive: z.boolean().optional(),
        respondToNeutral: z.boolean().optional(),
        respondToNegative: z.boolean().optional()
    }),
    runBody: z.object({}).strict(),
    retryParams: z.object({
        taskId: taskIdSchema
    })
};

const superAdminSchemas = {
    businessIdParams: z.object({
        businessId: objectIdSchema
    }),
    updateRoleBody: z.object({
        role: z.enum(['user', 'admin', 'super_admin'])
    }),
    trialEnableBody: z.object({
        days: numberPreprocessor(z.number().int().min(1).max(365)).optional()
    }),
    trialDisableBody: z.object({}).strict(),
    subscriptionBody: z.object({
        plan: z.enum(['trial', 'free', 'basic', 'pro', 'enterprise']).optional(),
        status: z.enum(['active', 'cancelled', 'expired', 'suspended']).optional(),
        expiresAt: z.string().datetime().optional()
    }).refine(
        (data) => Object.keys(data).length > 0,
        'At least one subscription field must be provided.'
    )
};

const paymentSchemas = {
    checkoutBody: z.object({
        plan: z.string().trim().min(1, 'plan is required.').transform((value) => value.toLowerCase()).refine(
            (value) => Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PLANS, value),
            'Invalid subscription plan.'
        )
    }),
    verifyBody: z.object({
        razorpay_payment_id: z.string().min(1, 'razorpay_payment_id is required.').trim(),
        razorpay_order_id: z.string().min(1, 'razorpay_order_id is required.').trim(),
        razorpay_signature: z.string().min(1, 'razorpay_signature is required.').trim()
    }),
    cancelBody: z.object({}).strict()
};

module.exports = {
    reviewSchemas,
    autoReplySchemas,
    superAdminSchemas,
    paymentSchemas
};

