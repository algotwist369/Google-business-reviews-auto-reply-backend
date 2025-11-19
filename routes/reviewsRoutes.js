const express = require('express');
const {
    getReviews,
    getAllReviews,
    replyToReview
} = require('../controllers/reviewsController');
const { verifyToken } = require('../middleware/auth');
const {
    validateRequest,
    validatePagination,
    validateFilter,
    validateSort
} = require('../middleware/validator');

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
router.post(
    '/reply',
    validateRequest(['reviewName', 'comment']),
    replyToReview
);

module.exports = router;

