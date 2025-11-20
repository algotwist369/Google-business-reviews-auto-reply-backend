const googleApiService = require('../services/googleApiService');
const AutoReplyTask = require('../models/AutoReplyTask');
const cache = require('../utils/cache');
const { normalizePagination, createPaginationMeta } = require('../utils/pagination');
const { FILTER_OPTIONS, SORT_OPTIONS, RATING_MAP, CACHE_TTL, PAGINATION } = require('../utils/constants');
const { AppError } = require('../utils/errorHandler');
const asyncHandler = require('../utils/asyncHandler');
const websocketService = require('../services/websocketService');
const reviewReplyGenerator = require('../services/reviewReplyGenerator');
const autoReplyService = require('../services/autoReplyService');

const isGoogleAuthError = (error) => {
    if (!error?.message) return false;
    return error.message.includes('Google API Error: 401') || error.message.includes('"status":"UNAUTHENTICATED"');
};

/**
 * Get all reviews with filtering, sorting, and pagination
 */
const getReviews = asyncHandler(async (req, res) => {
    const { page, limit, filter, sort, locationId } = req.query;
    const user = req.user;

    // Normalize pagination
    const pagination = normalizePagination(page, limit, PAGINATION.MAX_LIMIT);

    // Get filter and sort values
    const filterStatus = filter || FILTER_OPTIONS.ALL;
    const sortOrder = sort || SORT_OPTIONS.NEWEST;

    // Create cache key
    const cacheKey = `reviews:${user._id}:${filterStatus}:${sortOrder}:${locationId || 'all'}:${pagination.page}:${pagination.limit}`;

    // Check cache first
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
        return res.json(cachedData);
    }

    try {
        // Fetch from Google API
        const accountRes = await googleApiService.getAccounts(user.googleAccessToken, user);
        const account = accountRes.accounts?.[0];

        if (!account) {
            throw new AppError('No Business Account found.', 404);
        }

        // Get locations
        const locations = await googleApiService.getLocations(
            user.googleAccessToken,
            account.name,
            user
        );

        // Filter by location if specified
        const targetLocations = locationId
            ? locations.filter(loc => loc.name === locationId)
            : locations;

        if (targetLocations.length === 0) {
            throw new AppError('Location not found.', 404);
        }

        // Batch fetch reviews
        const locationsWithReviews = await googleApiService.batchFetchReviews(
            user.googleAccessToken,
            account.name,
            targetLocations,
            {},
            user
        );

        // Process all reviews for filtering and sorting
        let allReviews = [];
        locationsWithReviews.forEach(location => {
            location.reviews.forEach(review => {
                allReviews.push({
                    ...review,
                    locationName: location.locationName,
                    locationId: location.locationId,
                    accountId: location.accountId
                });
            });
        });

        // Apply filters
        if (filterStatus === FILTER_OPTIONS.REPLIED) {
            allReviews = allReviews.filter(r => r.reviewReply);
        } else if (filterStatus === FILTER_OPTIONS.UNREPLIED) {
            allReviews = allReviews.filter(r => !r.reviewReply);
        }

        // Apply sorting
        allReviews.sort((a, b) => {
            const dateA = new Date(a.createTime).getTime();
            const dateB = new Date(b.createTime).getTime();
            const ratingA = RATING_MAP[a.starRating] || 0;
            const ratingB = RATING_MAP[b.starRating] || 0;

            switch (sortOrder) {
                case SORT_OPTIONS.NEWEST:
                    return dateB - dateA;
                case SORT_OPTIONS.OLDEST:
                    return dateA - dateB;
                case SORT_OPTIONS.HIGHEST:
                    return ratingB - ratingA;
                case SORT_OPTIONS.LOWEST:
                    return ratingA - ratingB;
                default:
                    return dateB - dateA;
            }
        });

        // Group reviews back by location
        const groupedByLocation = {};
        allReviews.forEach(review => {
            const key = review.locationId;
            if (!groupedByLocation[key]) {
                groupedByLocation[key] = {
                    locationName: review.locationName,
                    locationId: review.locationId,
                    accountId: review.accountId,
                    reviews: []
                };
            }
            // Remove location fields from review object
            const { locationName, locationId: locId, accountId, ...reviewData } = review;
            groupedByLocation[key].reviews.push(reviewData);
        });

        // Convert to array
        let processedLocations = Object.values(groupedByLocation);

        // Apply pagination to locations (each location can have multiple reviews)
        // For simplicity, we'll paginate locations, but in a real scenario you might want to paginate reviews
        const totalLocations = processedLocations.length;
        const paginatedLocations = processedLocations.slice(
            pagination.skip,
            pagination.skip + pagination.limit
        );

        // Calculate total reviews across all locations
        const totalReviews = allReviews.length;

        // Create response
        const response = {
            success: true,
            data: paginatedLocations,
            pagination: createPaginationMeta(pagination.page, pagination.limit, totalLocations),
            meta: {
                totalReviews,
                filter: filterStatus,
                sort: sortOrder
            }
        };

        // Cache the response
        cache.set(cacheKey, response, CACHE_TTL.REVIEWS);

        // Emit WebSocket event for real-time updates
        try {
            websocketService.emitToUser(user._id.toString(), 'reviews:updated', {
                data: paginatedLocations,
                meta: {
                    totalReviews,
                    filter: filterStatus,
                    sort: sortOrder
                }
            });
        } catch (error) {
            console.error('Failed to emit reviews update:', error);
        }

        res.json(response);
    } catch (error) {
        if (error instanceof AppError) {
            throw error;
        }
        if (isGoogleAuthError(error)) {
            throw new AppError(
                'Google authentication expired. Please reconnect your Google Business Profile account.',
                403
            );
        }
        console.error('Error fetching reviews:', error);
        throw new AppError('Failed to fetch reviews from Google API.', 500);
    }
});

/**
 * Get all reviews without pagination (for backward compatibility)
 */
const getAllReviews = asyncHandler(async (req, res) => {
    const user = req.user;

    // Check cache
    const cacheKey = `reviews:${user._id}:all`;
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
        return res.json(cachedData);
    }

    try {
        // Fetch from Google API
        const accountRes = await googleApiService.getAccounts(user.googleAccessToken, user);
        const account = accountRes.accounts?.[0];

        if (!account) {
            throw new AppError('No Business Account found.', 404);
        }

        // Get locations
        const locations = await googleApiService.getLocations(
            user.googleAccessToken,
            account.name,
            user
        );

        // Batch fetch reviews
        const data = await googleApiService.batchFetchReviews(
            user.googleAccessToken,
            account.name,
            locations,
            {},
            user
        );

        // Cache the response
        cache.set(cacheKey, data, CACHE_TTL.REVIEWS);

        // Emit WebSocket event for real-time updates
        try {
            websocketService.emitToUser(user._id.toString(), 'reviews:updated', { data });
        } catch (error) {
            console.error('Failed to emit reviews update:', error);
        }

        res.json(data);
    } catch (error) {
        if (error instanceof AppError) {
            throw error;
        }
        if (isGoogleAuthError(error)) {
            throw new AppError(
                'Google authentication expired. Please reconnect your Google Business Profile account.',
                403
            );
        }
        console.error('Error fetching reviews:', error);
        throw new AppError('Failed to fetch reviews from Google API.', 500);
    }
});

/**
 * Reply to a review
 */
const replyToReview = asyncHandler(async (req, res) => {
    const { reviewName, comment } = req.body;
    const user = req.user;

    if (!reviewName || !comment) {
        throw new AppError('Missing required fields: reviewName, comment', 400);
    }

    try {
        await googleApiService.replyToReview(
            user.googleAccessToken,
            reviewName,
            comment,
            user
        );

        await AutoReplyTask.updateOne(
            { userId: user._id, reviewName },
            {
                $set: {
                    status: 'skipped',
                    sentAt: new Date(),
                    generatedReply: comment,
                    error: 'Reply sent manually from dashboard'
                }
            }
        );

        // Clear cache for this user's reviews
        cache.deleteByPrefix(`reviews:${user._id}:`);

        // Emit WebSocket event for real-time updates
        try {
            websocketService.emitToUser(user._id.toString(), 'review:replied', {
                reviewName,
                message: 'Reply posted successfully'
            });
            // Also emit reviews update to refresh the list
            websocketService.emitToUser(user._id.toString(), 'reviews:refresh', {});
        } catch (error) {
            console.error('Failed to emit review reply update:', error);
        }

        res.json({
            success: true,
            message: 'Reply posted successfully'
        });
    } catch (error) {
        console.error('Error replying to review:', error);
        throw new AppError('Failed to post reply to Google API.', 500);
    }
});

const generateAiReply = asyncHandler(async (req, res) => {
    const { reviewName, reviewText, ratingValue, reviewerName, locationName } = req.body || {};
    if (!reviewName || !reviewText) {
        throw new AppError('Missing required fields: reviewName, reviewText', 400);
    }

    const settings = autoReplyService.normalizeSettings
        ? autoReplyService.normalizeSettings(req.user.autoReplySettings)
        : {
            tone: req.user.autoReplySettings?.tone || 'friendly'
        };

    const payload = {
        businessName: req.user.name || req.user.company || 'our team',
        locationName: locationName || 'our business',
        reviewerName: reviewerName || 'there',
        ratingValue: ratingValue || 0,
        reviewText,
        tone: settings.tone || 'friendly'
    };

    const suggestion = await reviewReplyGenerator.generateReply(payload);

    res.json({
        success: true,
        data: suggestion
    });
});

module.exports = {
    getReviews,
    getAllReviews,
    replyToReview,
    generateAiReply
};

