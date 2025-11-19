require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:5000';

async function getTestToken() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        
        // Find any user in the database
        const user = await User.findOne();
        
        if (!user) {
            console.log('❌ No users found in database. Please create a user first by logging in.\n');
            await mongoose.connection.close();
            return null;
        }
        
        // Generate a test token
        const token = jwt.sign(
            { id: user._id.toString() },
            process.env.SESSION_SECRET,
            { expiresIn: '1h' }
        );
        
        console.log(`✅ Found user: ${user.name || user.email || user._id}`);
        console.log(`✅ Generated test token\n`);
        
        await mongoose.connection.close();
        return { token, userId: user._id.toString() };
    } catch (error) {
        console.error('❌ Error getting test token:', error.message);
        return null;
    }
}

async function testAuthenticatedEndpoints(token) {
    console.log('🧪 Testing Authenticated Endpoints\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const endpoints = [
        { method: 'GET', path: '/api/auto-reply/config', name: 'Get Auto-Reply Config' },
        { method: 'GET', path: '/api/auto-reply/tasks?limit=25', name: 'Get Auto-Reply Tasks' },
        { method: 'GET', path: '/api/reviews/all', name: 'Get All Reviews' }
    ];
    
    const results = [];
    const startTime = Date.now();
    const testDuration = 30; // 30 seconds
    const requestsPerSecond = 2; // Lower rate for authenticated endpoints
    const interval = 1000 / requestsPerSecond;
    
    console.log(`Testing ${endpoints.length} endpoints at ${requestsPerSecond} req/s for ${testDuration}s...\n`);
    
    let requestCount = 0;
    const endTime = startTime + (testDuration * 1000);
    
    while (Date.now() < endTime) {
        const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
        const requestStart = Date.now();
        
        try {
            const response = await axios({
                method: endpoint.method,
                url: `${API_URL}${endpoint.path}`,
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                timeout: 10000
            });
            
            const responseTime = Date.now() - requestStart;
            results.push({
                success: true,
                responseTime,
                endpoint: endpoint.name,
                status: response.status,
                dataSize: JSON.stringify(response.data).length
            });
            requestCount++;
        } catch (error) {
            const responseTime = Date.now() - requestStart;
            results.push({
                success: false,
                responseTime,
                endpoint: endpoint.name,
                error: error.response?.status || error.message,
                statusCode: error.response?.status
            });
            requestCount++;
        }
        
        await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    // Calculate statistics
    const totalTime = (Date.now() - startTime) / 1000;
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const responseTimes = results.map(r => r.responseTime);
    const avgResponseTime = responseTimes.length > 0 
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
        : 0;
    const minResponseTime = responseTimes.length > 0 ? Math.min(...responseTimes) : 0;
    const maxResponseTime = responseTimes.length > 0 ? Math.max(...responseTimes) : 0;
    const requestsPerMinute = (requestCount / totalTime) * 60;
    const successRate = requestCount > 0 ? (successful / requestCount * 100) : 0;
    
    // Group by endpoint
    const endpointStats = {};
    endpoints.forEach(ep => {
        const epResults = results.filter(r => r.endpoint === ep.name);
        endpointStats[ep.name] = {
            total: epResults.length,
            successful: epResults.filter(r => r.success).length,
            failed: epResults.filter(r => !r.success).length,
            avgTime: epResults.length > 0 
                ? epResults.reduce((sum, r) => sum + r.responseTime, 0) / epResults.length 
                : 0
        };
    });
    
    responseTimes.sort((a, b) => a - b);
    const p50 = responseTimes.length > 0 ? responseTimes[Math.floor(responseTimes.length * 0.5)] : 0;
    const p95 = responseTimes.length > 0 ? responseTimes[Math.floor(responseTimes.length * 0.95)] : 0;
    const p99 = responseTimes.length > 0 ? responseTimes[Math.floor(responseTimes.length * 0.99)] : 0;
    
    console.log('📊 Load Test Results:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total Requests:        ${requestCount}`);
    console.log(`Successful:            ${successful} (${successRate.toFixed(2)}%)`);
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
    console.log('\nPer-Endpoint Statistics:');
    Object.entries(endpointStats).forEach(([name, stats]) => {
        console.log(`  ${name}:`);
        console.log(`    Total: ${stats.total} | Success: ${stats.successful} | Failed: ${stats.failed}`);
        console.log(`    Avg Time: ${stats.avgTime.toFixed(2)}ms`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Performance assessment
    if (successRate >= 99 && avgResponseTime < 500) {
        console.log('✅ Excellent performance! All endpoints responding well.\n');
    } else if (successRate >= 95 && avgResponseTime < 1000) {
        console.log('✅ Good performance. Minor issues detected.\n');
    } else if (successRate >= 90) {
        console.log('⚠️  Acceptable performance, but some errors occurred.\n');
    } else {
        console.log('❌ Performance issues detected. Check server logs.\n');
    }
    
    // Show error details if any
    if (failed > 0) {
        const errors = results.filter(r => !r.success);
        const errorGroups = {};
        errors.forEach(err => {
            const key = `${err.endpoint}: ${err.error}`;
            errorGroups[key] = (errorGroups[key] || 0) + 1;
        });
        
        console.log('⚠️  Error Summary:');
        Object.entries(errorGroups).forEach(([error, count]) => {
            console.log(`  ${error}: ${count} times`);
        });
        console.log('');
    }
}

async function main() {
    console.log('🚀 Full System Load Test\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Get test token
    const tokenData = await getTestToken();
    if (!tokenData) {
        process.exit(1);
    }
    
    // Run authenticated load test
    await testAuthenticatedEndpoints(tokenData.token);
    
    console.log('✅ Load test completed!\n');
}

main().catch(error => {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
        console.error('Response:', error.response.data);
    }
    process.exit(1);
});

