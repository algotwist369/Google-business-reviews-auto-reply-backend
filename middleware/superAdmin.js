const { AppError } = require('../utils/errorHandler');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Middleware to check if user is super admin
 */
const requireSuperAdmin = asyncHandler(async (req, res, next) => {
    if (!req.user) {
        return next(new AppError('Authentication required.', 401));
    }

    if (req.user.role !== 'super_admin') {
        return next(new AppError('Access denied. Super admin privileges required.', 403));
    }

    next();
});

module.exports = { requireSuperAdmin };

