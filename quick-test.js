require('dotenv').config();
const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:5000';

async function testHealthEndpoint() {
    console.log('🧪 Testing Health Endpoint (No Auth Required)\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const results = [];
    const startTime = Date.now();
    const testDuration = 10; // 10 seconds
    const requestsPerSecond = 5;
    const interval = 1000 / requestsPerSecond;
    
    console.log(`Sending ${requestsPerSecond} requests/second for ${testDuration} seconds...\n`);
    
    let requestCount = 0;
    const endTime = startTime + (testDuration * 1000);
    
    while (Date.now() < endTime) {
        const requestStart = Date.now();
        try {
            const response = await axios.get(`${API_URL}/health`, { timeout: 5000 });
            const responseTime = Date.now() - requestStart;
            results.push({ success: true, responseTime, status: response.status });
            requestCount++;
        } catch (error) {
            const responseTime = Date.now() - requestStart;
            results.push({ success: false, responseTime, error: error.message });
            requestCount++;
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    // Calculate statistics
    const totalTime = (Date.now() - startTime) / 1000;
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const responseTimes = results.map(r => r.responseTime);
    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const minResponseTime = Math.min(...responseTimes);
    const maxResponseTime = Math.max(...responseTimes);
    const requestsPerMinute = (requestCount / totalTime) * 60;
    
    responseTimes.sort((a, b) => a - b);
    const p50 = responseTimes[Math.floor(responseTimes.length * 0.5)];
    const p95 = responseTimes[Math.floor(responseTimes.length * 0.95)];
    const p99 = responseTimes[Math.floor(responseTimes.length * 0.99)];
    
    console.log('📊 Test Results:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total Requests:        ${requestCount}`);
    console.log(`Successful:            ${successful} (${(successful/requestCount*100).toFixed(2)}%)`);
    console.log(`Failed:                ${failed}`);
    console.log(`Test Duration:         ${totalTime.toFixed(2)}s`);
    console.log(`Requests per Minute:   ${requestsPerMinute.toFixed(2)}`);
    console.log(`Requests per Second:   ${(requestCount / totalTime).toFixed(2)}`);
    console.log('\nResponse Time Statistics:');
    console.log(`  Average:             ${avgResponseTime.toFixed(2)}ms`);
    console.log(`  Min:                 ${minResponseTime}ms`);
    console.log(`  Max:                 ${maxResponseTime}ms`);
    console.log(`  P50 (Median):        ${p50}ms`);
    console.log(`  P95:                 ${p95}ms`);
    console.log(`  P99:                 ${p99}ms`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Performance assessment
    if (successful === requestCount && avgResponseTime < 100) {
        console.log('✅ Excellent performance! Server can handle high load.\n');
    } else if (successful === requestCount && avgResponseTime < 500) {
        console.log('✅ Good performance. Server is responsive.\n');
    } else {
        console.log('⚠️  Performance could be improved.\n');
    }
    
    console.log('💡 To test authenticated endpoints:');
    console.log('   1. Login via frontend and get JWT token');
    console.log('   2. Run: TEST_TOKEN="your-token" node load-test.js\n');
}

testHealthEndpoint().catch(error => {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
});

