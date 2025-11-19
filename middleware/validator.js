const { AppError } = require('../utils/errorHandler');

/**
 * Validate request body
 */
const validateRequest = (requiredFields) => {
    return (req, res, next) => {
        const missingFields = [];

        for (const field of requiredFields) {
            if (!req.body[field]) {
                missingFields.push(field);
            }
        }

        if (missingFields.length > 0) {
            return next(
                new AppError(
                    `Missing required fields: ${missingFields.join(', ')}`,
                    400
                )
            );
        }

        next();
    };
};

/**
 * Validate pagination parameters
 */
const validatePagination = (req, res, next) => {
    const { page, limit } = req.query;

    if (page && (isNaN(page) || parseInt(page) < 1)) {
        return next(new AppError('Page must be a positive integer.', 400));
    }

    if (limit && (isNaN(limit) || parseInt(limit) < 1 || parseInt(limit) > 100)) {
        return next(new AppError('Limit must be between 1 and 100.', 400));
    }

    next();
};

/**
 * Validate filter parameter
 */
const validateFilter = (req, res, next) => {
    const { filter } = req.query;
    const validFilters = ['all', 'replied', 'unreplied'];

    if (filter && !validFilters.includes(filter)) {
        return next(
            new AppError(
                `Invalid filter. Must be one of: ${validFilters.join(', ')}`,
                400
            )
        );
    }

    next();
};

/**
 * Validate sort parameter
 */
const validateSort = (req, res, next) => {
    const { sort } = req.query;
    const validSorts = ['newest', 'oldest', 'highest', 'lowest'];

    if (sort && !validSorts.includes(sort)) {
        return next(
            new AppError(
                `Invalid sort. Must be one of: ${validSorts.join(', ')}`,
                400
            )
        );
    }

    next();
};

module.exports = {
    validateRequest,
    validatePagination,
    validateFilter,
    validateSort
};

