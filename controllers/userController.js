const { AppError } = require('../utils/errorHandler');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Get current user profile
 */
const getProfile = asyncHandler(async (req, res) => {
    const user = req.user;
    
    res.json({
        success: true,
        data: {
            _id: user._id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            role: user.role,
            trial: user.trial,
            subscription: user.subscription,
            autoReplySettings: {
                enabled: user.autoReplySettings?.enabled || false
            }
        }
    });
});

module.exports = {
    getProfile
};

