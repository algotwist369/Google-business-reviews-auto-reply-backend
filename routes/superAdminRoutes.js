const express = require('express');
const {
    getAllBusinesses,
    getBusinessDetails,
    enableTrial,
    disableTrial,
    updateSubscription,
    getDashboardStats,
    updateBusinessRole
} = require('../controllers/superAdminController');
const { verifyToken } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/superAdmin');
const { validateBody, validateParams } = require('../middleware/schemaValidator');
const { superAdminSchemas } = require('../validators');

const router = express.Router();

// All routes require authentication and super admin role
router.use(verifyToken);
router.use(requireSuperAdmin);

// Dashboard stats
router.get('/dashboard/stats', getDashboardStats);

// Business management
router.get('/businesses', getAllBusinesses);
router.get('/businesses/:businessId', validateParams(superAdminSchemas.businessIdParams), getBusinessDetails);
router.put(
    '/businesses/:businessId/role',
    validateParams(superAdminSchemas.businessIdParams),
    validateBody(superAdminSchemas.updateRoleBody),
    updateBusinessRole
);

// Trial management
router.post(
    '/businesses/:businessId/trial/enable',
    validateParams(superAdminSchemas.businessIdParams),
    validateBody(superAdminSchemas.trialEnableBody),
    enableTrial
);
router.post(
    '/businesses/:businessId/trial/disable',
    validateParams(superAdminSchemas.businessIdParams),
    validateBody(superAdminSchemas.trialDisableBody),
    disableTrial
);

// Subscription management
router.put(
    '/businesses/:businessId/subscription',
    validateParams(superAdminSchemas.businessIdParams),
    validateBody(superAdminSchemas.subscriptionBody),
    updateSubscription
);

module.exports = router;

