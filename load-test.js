require('dotenv').config();
const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:5000';
const TEST_TOKEN = process.env.TEST_TOKEN || ''; // You'll need to provide a valid JWT token
const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT || '10');
const REQUESTS_PER_SECOND = parseInt(process.env.RPS || '5');
const DURATION_SECONDS = parseInt(process.env.DURATION || '60');

let totalRequests = 0;
let successfulRequests = 0;
let failedRequests = 0;
let responseTimes = [];
let startTime = Date.now();

const endpoints = [
    { method: 'GET', path: '/api/reviews', name: 'Get Reviews' },
    { method: 'GET', path: '/api/auto-reply/config', name: 'Get Auto-Reply Config' },
    { method: 'GET', path: '/api/auto-reply/tasks?limit=25', name: 'Get Auto-Reply Tasks' }
];

function makeRequest(endpoint) {
    const requestStart = Date.now();
    return axios({
        method: endpoint.method,
        url: `${API_URL}${endpoint.path}`,
        headers: {
            'Authorization': `Bearer ${TEST_TOKEN}`
        },
        timeout: 10000
    })
    .then(response => {
        const responseTime = Date.now() - requestStart;
        responseTimes.push(responseTime);
        successfulRequests++;
        totalRequests++;
        return { success: true, responseTime, endpoint: endpoint.name };
    })
    .catch(error => {
        const responseTime = Date.now() - requestStart;
        responseTimes.push(responseTime);
        failedRequests++;
        totalRequests++;
        return { 
            success: false, 
            responseTime, 
            endpoint: endpoint.name,
            error: error.response?.status || error.message 
        };
    });
}

async function runLoadTest() {
    console.log('🚀 Starting Load Test...\n');
    console.log(`Configuration:`);
    console.log(`  - API URL: ${API_URL}`);
    console.log(`  - Concurrent Requests: ${CONCURRENT_REQUESTS}`);
    console.log(`  - Target RPS: ${REQUESTS_PER_SECOND}`);
    console.log(`  - Duration: ${DURATION_SECONDS} seconds\n`);

    if (!TEST_TOKEN) {
        console.error('❌ ERROR: TEST_TOKEN environment variable is required');
        console.log('   Set it in your .env file or export it before running');
        process.exit(1);
    }

    const interval = 1000 / REQUESTS_PER_SECOND; // ms between requests
    const endTime = startTime + (DURATION_SECONDS * 1000);
    const promises = [];

    // Start concurrent request streams
    for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
        const stream = async () => {
            while (Date.now() < endTime) {
                const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
                promises.push(makeRequest(endpoint));
                await new Promise(resolve => setTimeout(resolve, interval));
            }
        };
        stream();
    }

    // Wait for all requests to complete
    await Promise.all(promises);

    // Calculate statistics
    const totalTime = (Date.now() - startTime) / 1000;
    const avgResponseTime = responseTimes.length > 0 
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
        : 0;
    const minResponseTime = responseTimes.length > 0 ? Math.min(...responseTimes) : 0;
    const maxResponseTime = responseTimes.length > 0 ? Math.max(...responseTimes) : 0;
    const requestsPerMinute = (totalRequests / totalTime) * 60;
    const successRate = totalRequests > 0 ? (successfulRequests / totalRequests * 100).toFixed(2) : 0;

    // Sort response times for percentile calculation
    responseTimes.sort((a, b) => a - b);
    const p50 = responseTimes[Math.floor(responseTimes.length * 0.5)] || 0;
    const p95 = responseTimes[Math.floor(responseTimes.length * 0.95)] || 0;
    const p99 = responseTimes[Math.floor(responseTimes.length * 0.99)] || 0;

    console.log('\n📊 Load Test Results:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total Requests:        ${totalRequests}`);
    console.log(`Successful:            ${successfulRequests} (${successRate}%)`);
    console.log(`Failed:                ${failedRequests}`);
    console.log(`Test Duration:         ${totalTime.toFixed(2)}s`);
    console.log(`Requests per Minute:   ${requestsPerMinute.toFixed(2)}`);
    console.log(`Requests per Second:   ${(totalRequests / totalTime).toFixed(2)}`);
    console.log('\nResponse Time Statistics:');
    console.log(`  Average:             ${avgResponseTime.toFixed(2)}ms`);
    console.log(`  Min:                 ${minResponseTime}ms`);
    console.log(`  Max:                 ${maxResponseTime}ms`);
    console.log(`  P50 (Median):        ${p50}ms`);
    console.log(`  P95:                 ${p95}ms`);
    console.log(`  P99:                 ${p99}ms`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Performance assessment
    if (successRate >= 99 && avgResponseTime < 500) {
        console.log('✅ Excellent performance!');
    } else if (successRate >= 95 && avgResponseTime < 1000) {
        console.log('✅ Good performance');
    } else if (successRate >= 90) {
        console.log('⚠️  Acceptable performance, but could be improved');
    } else {
        console.log('❌ Performance issues detected');
    }

    console.log('\n💡 Recommendations:');
    if (avgResponseTime > 1000) {
        console.log('  - Consider adding caching for frequently accessed data');
        console.log('  - Optimize database queries');
    }
    if (failedRequests > 0) {
        console.log('  - Check server logs for error details');
        console.log('  - Verify rate limiting is appropriate');
    }
    if (requestsPerMinute < 100) {
        console.log('  - Current throughput is low - check for bottlenecks');
        console.log('  - Consider horizontal scaling if needed');
    }
}

// Run the test
runLoadTest().catch(error => {
    console.error('❌ Load test failed:', error.message);
    process.exit(1);
});

