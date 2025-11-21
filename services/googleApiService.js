const axios = require('axios');
const { GOOGLE_API } = require('../utils/constants');
const tokenRefreshService = require('./tokenRefreshService');
const User = require('../models/User');

/**
 * Google API Service - Handles all Google My Business API calls with proper error handling and retry logic
 */
class GoogleApiService {
    constructor() {
        this.axiosInstance = axios.create({
            timeout: 30000, // 30 second timeout
            headers: {
                'Content-Type': 'application/json'
            }
        });
        // Cache to track users without refresh tokens (prevents repeated DB queries)
        // Key: userId, Value: { hasRefreshToken: boolean, lastChecked: timestamp }
        this.tokenCache = new Map();
        // Cache expiry: 1 hour
        this.cacheExpiry = 60 * 60 * 1000;
    }

    /**
     * Check if user has refresh token (with caching to prevent repeated DB queries)
     */
    async hasRefreshToken(userId) {
        const cached = this.tokenCache.get(userId);
        const now = Date.now();
        
        if (cached && (now - cached.lastChecked) < this.cacheExpiry) {
            return cached.hasRefreshToken;
        }

        try {
            const user = await User.findById(userId).select('googleRefreshToken').lean();
            const hasToken = !!(user && user.googleRefreshToken);
            this.tokenCache.set(userId, { hasRefreshToken: hasToken, lastChecked: now });
            return hasToken;
        } catch (error) {
            console.error(`Error checking refresh token for user ${userId}:`, error.message);
            return false;
        }
    }

    /**
     * Clear token cache for a user (call after successful refresh or token update)
     */
    clearTokenCache(userId) {
        this.tokenCache.delete(userId);
    }

    /**
     * Make authenticated request to Google API with automatic token refresh on 401
     
     */
    async makeRequest(accessToken, method, url, data = null, params = {}, userOrId = null, retried = false) {
        try {
            const config = {
                method,
                url,
                headers: {
                    Authorization: `Bearer ${accessToken}`
                },
                params
            };

            if (data) {
                config.data = data;
            }

            const response = await this.axiosInstance(config);
            return response.data;
        } catch (error) {
            // Handle 403 scope errors gracefully
            if (error.response?.status === 403) {
                const errorData = error.response.data || {};
                if (errorData.error?.code === 403 && errorData.error?.message?.includes('insufficient authentication scopes')) {
                    const userId = typeof userOrId === 'string' ? userOrId : userOrId?._id?.toString();
                    if (userId) {
                        console.warn(`User ${userId} has insufficient OAuth scopes. User needs to re-authenticate with proper scopes.`);
                    }
                    throw new Error(
                        `Google API Error: 403 - Insufficient authentication scopes. User needs to re-authenticate.`
                    );
                }
            }

            // If we get a 401 and have a user/userId, try to refresh the token
            if (error.response?.status === 401 && userOrId && !retried) {
                const userId = typeof userOrId === 'string' ? userOrId : userOrId._id?.toString();
                if (userId) {
                    // Check if user has refresh token before attempting refresh
                    const canRefresh = await this.hasRefreshToken(userId);
                    if (canRefresh) {
                        try {
                            const newAccessToken = await tokenRefreshService.refreshAndSaveUserToken(userId);
                            // Clear cache after successful refresh
                            this.clearTokenCache(userId);
                            // Retry the request with the new token (pass userId string, not full object)
                            return this.makeRequest(newAccessToken, method, url, data, params, userId, true);
                        } catch (refreshError) {
                            // Clear cache on refresh failure
                            this.clearTokenCache(userId);
                            // Only log error message, not the entire user object
                            const errorMsg = refreshError.message || 'Unknown refresh error';
                            // Don't log NO_REFRESH_TOKEN errors here - they're already handled above
                            if (errorMsg !== 'NO_REFRESH_TOKEN') {
                                console.warn(`Token refresh failed for user ${userId}: ${errorMsg}`);
                            }
                            // If refresh fails, throw the original 401 error (don't retry)
                            throw error;
                        }
                    } else {
                        // User doesn't have refresh token - don't log here (already logged in auto-reply service)
                        // Clear cache to allow re-check after user re-authenticates
                        this.clearTokenCache(userId);
                        // Throw the original 401 error
                        throw error;
                    }
                }
            }

            if (error.response) {
                // API responded with error status
                throw new Error(
                    `Google API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
                );
            } else if (error.request) {
                // Request made but no response
                throw new Error('Google API: No response received');
            } else {
                // Error in setting up request
                throw new Error(`Google API Request Error: ${error.message}`);
            }
        }
    }

    /**
     * Get business accounts
     * @param {string} accessToken - Access token
     * @param {string|object} userOrId - User ID or User object (optional, for token refresh)
     */
    async getAccounts(accessToken, userOrId = null) {
        return await this.makeRequest(
            accessToken,
            'GET',
            GOOGLE_API.ACCOUNTS_URL,
            null,
            {},
            userOrId
        );
    }

    /**
     * Get locations for an account
     * @param {string} accessToken - Access token
     * @param {string} accountName - Account name
     * @param {string|object} userOrId - User ID or User object (optional, for token refresh)
     */
    async getLocations(accessToken, accountName, userOrId = null) {
        const url = `${GOOGLE_API.LOCATIONS_URL}/${accountName}/locations`;
        const response = await this.makeRequest(
            accessToken,
            'GET',
            url,
            null,
            { readMask: 'name,title' },
            userOrId
        );
        return response.locations || [];
    }

    /**
     * Fetch all reviews for a location with pagination
     * @param {string} accessToken - Access token
     * @param {string} accountName - Account name
     * @param {string} locationName - Location name
     * @param {object} options - Options including since timestamp
     * @param {string|object} userOrId - User ID or User object (optional, for token refresh)
     */
    async getAllReviews(accessToken, accountName, locationName, options = {}, userOrId = null) {
        const reviewUrl = `${GOOGLE_API.REVIEWS_URL}/${accountName}/${locationName}/reviews`;
        const allReviews = [];
        let nextPageToken = null;
        const sinceTimestamp = options.since ? new Date(options.since).getTime() : null;
        let stopPaging = false;

        try {
            do {
                const params = {
                    pageSize: GOOGLE_API.MAX_PAGE_SIZE,
                    orderBy: 'updateTime desc'
                };
                if (nextPageToken) {
                    params.pageToken = nextPageToken;
                }

                const response = await this.makeRequest(
                    accessToken,
                    'GET',
                    reviewUrl,
                    null,
                    params,
                    userOrId
                );

                const pageReviews = response.reviews || [];
                if (sinceTimestamp) {
                    const filtered = [];
                    for (const review of pageReviews) {
                        const updatedAt = new Date(review.updateTime || review.createTime || 0).getTime();
                        if (updatedAt >= sinceTimestamp) {
                            filtered.push(review);
                        } else {
                            stopPaging = true;
                        }
                    }
                    allReviews.push(...filtered);
                } else {
                    allReviews.push(...pageReviews);
                }

                nextPageToken = stopPaging ? null : response.nextPageToken;
            } while (nextPageToken);

            return allReviews;
        } catch (error) {
            console.error(`Error fetching reviews for ${locationName}:`, error.message);
            // Return partial data if available
            return allReviews;
        }
    }

    /**
     * Batch fetch reviews for multiple locations concurrently
     * @param {string} accessToken - Access token
     * @param {string} accountName - Account name
     * @param {array} locations - Array of location objects
     * @param {object} options - Options including since timestamp
     * @param {string|object} userOrId - User ID or User object (optional, for token refresh)
     */
    async batchFetchReviews(accessToken, accountName, locations, options = {}, userOrId = null) {
        // Process locations in batches to avoid overwhelming the API
        const batchSize = GOOGLE_API.MAX_CONCURRENT_REQUESTS;
        const results = [];

        for (let i = 0; i < locations.length; i += batchSize) {
            const batch = locations.slice(i, i + batchSize);
            const batchPromises = batch.map(async (location) => {
                try {
                    const reviews = await this.getAllReviews(
                        accessToken,
                        accountName,
                        location.name,
                        options,
                        userOrId
                    );
                    return {
                        locationName: location.title,
                        locationId: location.name,
                        accountId: accountName,
                        reviews
                    };
                } catch (error) {
                    console.error(`Failed to fetch reviews for ${location.title}:`, error.message);
                    return {
                        locationName: location.title,
                        locationId: location.name,
                        accountId: accountName,
                        reviews: []
                    };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }

        return results;
    }

    /**
     * Reply to a review
     * @param {string} accessToken - Access token
     * @param {string} reviewName - Review name/ID
     * @param {string} comment - Reply comment
     * @param {string|object} userOrId - User ID or User object (optional, for token refresh)
     */
    async replyToReview(accessToken, reviewName, comment, userOrId = null) {
        const url = `${GOOGLE_API.REVIEWS_URL}/${reviewName}/reply`;
        return await this.makeRequest(
            accessToken,
            'PUT',
            url,
            { comment },
            {},
            userOrId
        );
    }
}

module.exports = new GoogleApiService();

