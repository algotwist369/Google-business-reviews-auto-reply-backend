const axios = require('axios');
const User = require('../models/User');
require('dotenv').config();

/**
 * Token Refresh Service
 * Handles refreshing expired Google OAuth access tokens using refresh tokens
 */
class TokenRefreshService {
    /**
     * Refresh Google OAuth access token using refresh token
 
     */
    async refreshAccessToken(refreshToken) {
        if (!refreshToken) {
            throw new Error('Refresh token is required');
        }

        if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
            throw new Error('Google OAuth credentials not configured');
        }

        try {
            const params = new URLSearchParams();
            params.append('client_id', process.env.GOOGLE_CLIENT_ID);
            params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET);
            params.append('refresh_token', refreshToken);
            params.append('grant_type', 'refresh_token');

            const response = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            return {
                access_token: response.data.access_token,
                expires_in: response.data.expires_in || 3600
            };
        } catch (error) {
            if (error.response) {
                const errorData = error.response.data || {};
                if (error.response.status === 400 && errorData.error === 'invalid_grant') {
                    // Refresh token is invalid/revoked - user needs to re-authenticate
                    throw new Error('REFRESH_TOKEN_INVALID');
                }
                throw new Error(`Token refresh failed: ${error.response.status} - ${JSON.stringify(errorData)}`);
            }
            throw new Error(`Token refresh request failed: ${error.message}`);
        }
    }

    /**
     * Refresh and save access token for a user
   
     */
    async refreshAndSaveUserToken(userId) {
        const user = await User.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        if (!user.googleRefreshToken) {
            throw new Error('No refresh token available. User needs to re-authenticate.');
        }

        try {
            const { access_token } = await this.refreshAccessToken(user.googleRefreshToken);
            
            // Save the new access token
            user.googleAccessToken = access_token;
            await user.save();

            return access_token;
        } catch (error) {
            if (error.message === 'REFRESH_TOKEN_INVALID') {
                // Clear invalid tokens so user knows they need to re-authenticate
                user.googleAccessToken = null;
                user.googleRefreshToken = null;
                await user.save();
            }
            throw error;
        }
    }
}

module.exports = new TokenRefreshService();

