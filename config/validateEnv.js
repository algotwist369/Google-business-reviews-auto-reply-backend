const REQUIRED_KEYS = [
    'MONGO_URI',
    'SESSION_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALLBACK_URL',
    'OPENAI_API_KEY'
];

const OPTIONAL_KEYS = [
    'CLIENT_URL',
    'OPENAI_MODEL',
    'OPENAI_BASE_URL',
    'AUTO_REPLY_SCAN_INTERVAL_MS',
    'RATE_LIMIT_WINDOW_MINUTES',
    'RATE_LIMIT_MAX_REQUESTS'
];

function validateEnv() {
    const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);

    if (missing.length) {
        const message = `Missing required environment variables: ${missing.join(', ')}`;
        if (process.env.NODE_ENV === 'production') {
            throw new Error(message);
        }
        console.warn(`⚠️  ${message}`);
    }

    OPTIONAL_KEYS.forEach((key) => {
        if (!process.env[key]) {
            console.warn(`ℹ️  Optional env var ${key} is not set. Using default fallback.`);
        }
    });
}

module.exports = validateEnv;

