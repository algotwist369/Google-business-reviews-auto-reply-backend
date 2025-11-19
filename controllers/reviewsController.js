const googleApiService = require('../services/googleApiService');
const AutoReplyTask = require('../models/AutoReplyTask');
const cache = require('../utils/cache');
const { normalizePagination, createPaginationMeta } = require('../utils/pagination');
const { FILTER_OPTIONS, SORT_OPTIONS, RATING_MAP, CACHE_TTL, PAGINATION } = require('../utils/constants');
const { AppError } = require('../utils/errorHandler');
const asyncHandler = require('../utils/asyncHandler');

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
        const accountRes = await googleApiService.getAccounts(user.googleAccessToken);
        const account = accountRes.accounts?.[0];

        if (!account) {
            throw new AppError('No Business Account found.', 404);
        }

        // Get locations
        const locations = await googleApiService.getLocations(
            user.googleAccessToken,
            account.name
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
            targetLocations
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

        res.json(response);
    } catch (error) {
        if (error instanceof AppError) {
            throw error;
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
        const accountRes = await googleApiService.getAccounts(user.googleAccessToken);
        const account = accountRes.accounts?.[0];

        if (!account) {
            throw new AppError('No Business Account found.', 404);
        }

        // Get locations
        const locations = await googleApiService.getLocations(
            user.googleAccessToken,
            account.name
        );

        // Batch fetch reviews
        const data = await googleApiService.batchFetchReviews(
            user.googleAccessToken,
            account.name,
            locations
        );

        // Cache the response
        cache.set(cacheKey, data, CACHE_TTL.REVIEWS);

        res.json(data);
    } catch (error) {
        if (error instanceof AppError) {
            throw error;
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
            comment
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
        const cachePattern = `reviews:${user._id}:*`;
        // Note: In production, use Redis with pattern matching for better cache invalidation
        cache.clear(); // Simple solution for now

        res.json({
            success: true,
            message: 'Reply posted successfully'
        });
    } catch (error) {
        console.error('Error replying to review:', error);
        throw new AppError('Failed to post reply to Google API.', 500);
    }
});

module.exports = {
    getReviews,
    getAllReviews,
    replyToReview
};

