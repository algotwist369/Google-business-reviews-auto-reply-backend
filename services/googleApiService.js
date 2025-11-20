const axios = require('axios');
const { GOOGLE_API } = require('../utils/constants');

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
    }

    /**
     * Make authenticated request to Google API
     */
    async makeRequest(accessToken, method, url, data = null, params = {}) {
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
     */
    async getAccounts(accessToken) {
        return await this.makeRequest(
            accessToken,
            'GET',
            GOOGLE_API.ACCOUNTS_URL
        );
    }

    /**
     * Get locations for an account
     */
    async getLocations(accessToken, accountName) {
        const url = `${GOOGLE_API.LOCATIONS_URL}/${accountName}/locations`;
        const response = await this.makeRequest(
            accessToken,
            'GET',
            url,
            null,
            { readMask: 'name,title' }
        );
        return response.locations || [];
    }

    /**
     * Fetch all reviews for a location with pagination
     */
    async getAllReviews(accessToken, accountName, locationName, options = {}) {
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
                    params
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
     */
    async batchFetchReviews(accessToken, accountName, locations, options = {}) {
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
                        options
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
     */
    async replyToReview(accessToken, reviewName, comment) {
        const url = `${GOOGLE_API.REVIEWS_URL}/${reviewName}/reply`;
        return await this.makeRequest(
            accessToken,
            'PUT',
            url,
            { comment }
        );
    }
}

module.exports = new GoogleApiService();

