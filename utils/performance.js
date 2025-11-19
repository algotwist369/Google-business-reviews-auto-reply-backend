/**
 * Performance monitoring and optimization utilities
 */

/**
 * Measure execution time of a function
 * @param {Function} fn - Function to measure
 * @param {string} label - Label for logging
 * @returns {Function} Wrapped function
 */
const measureExecutionTime = (fn, label = 'Function') => {
    return async (...args) => {
        const start = Date.now();
        try {
            const result = await fn(...args);
            const duration = Date.now() - start;
            if (process.env.NODE_ENV === 'development') {
                console.log(`[Performance] ${label}: ${duration}ms`);
            }
            return result;
        } catch (error) {
            const duration = Date.now() - start;
            console.error(`[Performance] ${label} failed after ${duration}ms:`, error);
            throw error;
        }
    };
};

/**
 * Rate limiter for API calls
 * Limits concurrent requests to prevent overwhelming external APIs
 */
class RateLimiter {
    constructor(maxConcurrent = 5, delay = 100) {
        this.maxConcurrent = maxConcurrent;
        this.delay = delay;
        this.queue = [];
        this.active = 0;
    }

    async execute(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.process();
        });
    }

    async process() {
        if (this.active >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }

        this.active++;
        const { fn, resolve, reject } = this.queue.shift();

        try {
            const result = await fn();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.active--;
            await new Promise(resolve => setTimeout(resolve, this.delay));
            this.process();
        }
    }
}

module.exports = {
    measureExecutionTime,
    RateLimiter
};

