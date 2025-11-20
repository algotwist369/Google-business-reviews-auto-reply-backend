const { AppError } = require('../utils/errorHandler');

const buildValidator =
    (schema, property) =>
        (req, res, next) => {
            const target = req[property] || {};
            const result = schema.safeParse(target);

            if (!result.success) {
                const message = result.error.issues.map(issue => issue.message).join(', ');
                return next(new AppError(message, 400));
            }

            req[property] = result.data;
            return next();
        };

const validateBody = (schema) => buildValidator(schema, 'body');
const validateParams = (schema) => buildValidator(schema, 'params');
const validateQuery = (schema) => buildValidator(schema, 'query');

module.exports = {
    validateBody,
    validateParams,
    validateQuery
};

