const express = require('express');
const router = express.Router();
const {
    createCheckoutSession,
    verifyPayment,
    getPlans,
    getSubscriptionStatus,
    cancelSubscription
} = require('../controllers/paymentController');
const { verifyToken } = require('../middleware/auth');

// Note: Webhook route is registered in server.js before JSON parser

// All payment routes require authentication
router.use(verifyToken);

router.get('/plans', getPlans);
router.get('/subscription', getSubscriptionStatus);
router.post('/checkout', createCheckoutSession);
router.post('/verify', verifyPayment);
router.post('/cancel', cancelSubscription);

module.exports = router;

