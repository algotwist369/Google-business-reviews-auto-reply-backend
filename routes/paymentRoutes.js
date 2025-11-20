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
const { validateBody } = require('../middleware/schemaValidator');
const { paymentSchemas } = require('../validators');

// Note: Webhook route is registered in server.js before JSON parser

// All payment routes require authentication
router.use(verifyToken);

router.get('/plans', getPlans);
router.get('/subscription', getSubscriptionStatus);
router.post('/checkout', validateBody(paymentSchemas.checkoutBody), createCheckoutSession);
router.post('/verify', validateBody(paymentSchemas.verifyBody), verifyPayment);
router.post('/cancel', validateBody(paymentSchemas.cancelBody), cancelSubscription);

module.exports = router;

