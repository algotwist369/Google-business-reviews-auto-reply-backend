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

const router = express.Router();

// All routes require authentication and super admin role
router.use(verifyToken);
router.use(requireSuperAdmin);

// Dashboard stats
router.get('/dashboard/stats', getDashboardStats);

// Business management
router.get('/businesses', getAllBusinesses);
router.get('/businesses/:businessId', getBusinessDetails);
router.put('/businesses/:businessId/role', updateBusinessRole);

// Trial management
router.post('/businesses/:businessId/trial/enable', enableTrial);
router.post('/businesses/:businessId/trial/disable', disableTrial);

// Subscription management
router.put('/businesses/:businessId/subscription', updateSubscription);

module.exports = router;

