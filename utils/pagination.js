/**
 * Pagination utility functions
 */

/**
 * Validate and normalize pagination parameters
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @param {number} maxLimit - Maximum allowed limit
 * @returns {Object} Normalized pagination params
 */
const normalizePagination = (page, limit, maxLimit = 100) => {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(
        maxLimit,
        Math.max(1, parseInt(limit, 10) || 20)
    );

    return {
        page: pageNum,
        limit: limitNum,
        skip: (pageNum - 1) * limitNum
    };
};

/**
 * Create pagination metadata
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @param {number} total - Total items
 * @returns {Object} Pagination metadata
 */
const createPaginationMeta = (page, limit, total) => {
    const totalPages = Math.ceil(total / limit);

    return {
        currentPage: page,
        itemsPerPage: limit,
        totalItems: total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
    };
};

module.exports = {
    normalizePagination,
    createPaginationMeta
};

