// API Constants
const GOOGLE_API = {
    ACCOUNTS_URL: 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    LOCATIONS_URL: 'https://mybusinessbusinessinformation.googleapis.com/v1',
    REVIEWS_URL: 'https://mybusiness.googleapis.com/v4',
    MAX_PAGE_SIZE: 50,
    MAX_CONCURRENT_REQUESTS: 5
};

// Pagination defaults
const PAGINATION = {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 100,
    MIN_LIMIT: 1
};

// Cache TTL in milliseconds
const CACHE_TTL = {
    REVIEWS: 5 * 60 * 1000, // 5 minutes
    LOCATIONS: 10 * 60 * 1000, // 10 minutes
    ACCOUNTS: 30 * 60 * 1000 // 30 minutes
};

// Filter options
const FILTER_OPTIONS = {
    ALL: 'all',
    REPLIED: 'replied',
    UNREPLIED: 'unreplied'
};

// Sort options
const SORT_OPTIONS = {
    NEWEST: 'newest',
    OLDEST: 'oldest',
    HIGHEST: 'highest',
    LOWEST: 'lowest'
};

// Rating mapping
const RATING_MAP = {
    'ONE': 1,
    'TWO': 2,
    'THREE': 3,
    'FOUR': 4,
    'FIVE': 5
};

const AUTO_REPLY = {
    DEFAULT_DELAY_MINUTES: 15,
    DELAY_OPTIONS_MINUTES: [2, 5, 10, 15, 20, 30, 45, 60, 180, 360, 720, 1440],
    TONES: ['friendly', 'empathetic', 'professional', 'concise'],
    MAX_GENERATIONS_PER_CYCLE: 5,
    MAX_DISPATCH_PER_CYCLE: 5
};

module.exports = {
    GOOGLE_API,
    PAGINATION,
    CACHE_TTL,
    FILTER_OPTIONS,
    SORT_OPTIONS,
    RATING_MAP,
    AUTO_REPLY
};

