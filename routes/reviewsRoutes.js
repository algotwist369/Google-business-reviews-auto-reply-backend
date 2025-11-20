const express = require('express');
const {
    getReviews,
    getAllReviews,
    replyToReview,
    generateAiReply
} = require('../controllers/reviewsController');
const { verifyToken } = require('../middleware/auth');
const { validatePagination, validateFilter, validateSort } = require('../middleware/validator');
const { validateBody } = require('../middleware/schemaValidator');
const { reviewSchemas } = require('../validators');

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

// Get reviews with filtering, sorting, and pagination
router.get(
    '/',
    validatePagination,
    validateFilter,
    validateSort,
    getReviews
);

// Get all reviews (backward compatibility - no pagination)
router.get('/all', getAllReviews);

// Reply to a review
router.post('/reply', validateBody(reviewSchemas.replyBody), replyToReview);

router.post('/ai-reply', validateBody(reviewSchemas.aiReplyBody), generateAiReply);

module.exports = router;

