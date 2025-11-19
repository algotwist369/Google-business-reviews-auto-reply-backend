const axios = require('axios');
const { GOOGLE_API } = require('../utils/constants');

/**
 * Google API Service
 * Handles all Google My Business API calls with proper error handling and retry logic
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
     * @param {string} accessToken - OAuth access token
     * @param {string} method - HTTP method
     * @param {string} url - API URL
     * @param {Object} data - Request data (for POST/PUT)
     * @param {Object} params - Query parameters
     * @returns {Promise} API response
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
     * @param {string} accessToken - OAuth access token
     * @returns {Promise<Object>} Account data
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
     * @param {string} accessToken - OAuth access token
     * @param {string} accountName - Account name (e.g., accounts/123456)
     * @returns {Promise<Array>} Array of locations
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
     * @param {string} accessToken - OAuth access token
     * @param {string} accountName - Account name
     * @param {string} locationName - Location name
     * @returns {Promise<Array>} Array of reviews
     */
    async getAllReviews(accessToken, accountName, locationName) {
        const reviewUrl = `${GOOGLE_API.REVIEWS_URL}/${accountName}/${locationName}/reviews`;
        const allReviews = [];
        let nextPageToken = null;

        try {
            do {
                const params = { pageSize: GOOGLE_API.MAX_PAGE_SIZE };
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

                if (response.reviews) {
                    allReviews.push(...response.reviews);
                }

                nextPageToken = response.nextPageToken;
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
     * @param {string} accessToken - OAuth access token
     * @param {string} accountName - Account name
     * @param {Array} locations - Array of location objects
     * @returns {Promise<Array>} Array of location data with reviews
     */
    async batchFetchReviews(accessToken, accountName, locations) {
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
                        location.name
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
     * @param {string} accessToken - OAuth access token
     * @param {string} reviewName - Review name (full path)
     * @param {string} comment - Reply comment
     * @returns {Promise<Object>} Response data
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

