require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:5000';

async function checkServerHealth() {
    try {
        const response = await axios.get(`${API_URL}/health`, { timeout: 5000 });
        console.log('✅ Server is running');
        console.log(`   Status: ${response.data.status}`);
        console.log(`   Database: ${response.data.checks?.database || 'unknown'}\n`);
        return true;
    } catch (error) {
        console.log('❌ Server is not running or not accessible');
        console.log(`   Error: ${error.message}\n`);
        return false;
    }
}

async function checkDatabase() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const dbStatus = mongoose.connection.readyState;
        await mongoose.connection.close();
        
        if (dbStatus === 1) {
            console.log('✅ Database connection successful\n');
            return true;
        } else {
            console.log('❌ Database connection failed\n');
            return false;
        }
    } catch (error) {
        console.log('❌ Database connection error');
        console.log(`   Error: ${error.message}\n`);
        return false;
    }
}

async function checkEnvironment() {
    console.log('🔍 Checking Environment Configuration:\n');
    
    const required = ['MONGO_URI', 'SESSION_SECRET'];
    const optional = ['OPENAI_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
    
    let allGood = true;
    
    required.forEach(key => {
        if (process.env[key]) {
            console.log(`✅ ${key}: Set`);
        } else {
            console.log(`❌ ${key}: Missing (REQUIRED)`);
            allGood = false;
        }
    });
    
    console.log('');
    optional.forEach(key => {
        if (process.env[key]) {
            console.log(`✅ ${key}: Set`);
        } else {
            console.log(`⚠️  ${key}: Missing (optional, but needed for full functionality)`);
        }
    });
    
    console.log('');
    return allGood;
}

async function testSystemCapacity() {
    console.log('📊 System Capacity Analysis:\n');
    
    const AUTO_REPLY = require('./utils/constants').AUTO_REPLY;
    const SCAN_INTERVAL_MS = Number(process.env.AUTO_REPLY_SCAN_INTERVAL_MS || 5 * 60 * 1000);
    
    const generationsPerCycle = AUTO_REPLY.MAX_GENERATIONS_PER_CYCLE;
    const dispatchesPerCycle = AUTO_REPLY.MAX_DISPATCH_PER_CYCLE;
    const cycleIntervalMinutes = SCAN_INTERVAL_MS / 60000;
    
    const generationsPerMinute = generationsPerCycle / (cycleIntervalMinutes);
    const dispatchesPerMinute = dispatchesPerCycle / (cycleIntervalMinutes);
    const totalPerMinute = generationsPerMinute + dispatchesPerMinute;
    
    console.log('Current Configuration:');
    console.log(`  Max Generations per Cycle: ${generationsPerCycle}`);
    console.log(`  Max Dispatches per Cycle:  ${dispatchesPerCycle}`);
    console.log(`  Scan Interval:             ${cycleIntervalMinutes} minutes`);
    console.log('\nCalculated Throughput:');
    console.log(`  Generations per minute:    ${generationsPerMinute.toFixed(2)}`);
    console.log(`  Dispatches per minute:     ${dispatchesPerMinute.toFixed(2)}`);
    console.log(`  Total operations/minute:   ${totalPerMinute.toFixed(2)}`);
    console.log(`  Total operations/hour:     ${(totalPerMinute * 60).toFixed(2)}`);
    console.log(`  Total operations/day:      ${(totalPerMinute * 60 * 24).toFixed(2)}\n`);
    
    // Capacity assessment
    const reviewsPerDay = totalPerMinute * 60 * 24;
    console.log('Capacity Assessment:');
    if (reviewsPerDay >= 200) {
        console.log('  ✅ Can handle: Large businesses (200+ reviews/day)');
    } else if (reviewsPerDay >= 50) {
        console.log('  ✅ Can handle: Medium businesses (50-200 reviews/day)');
        console.log('  ⚠️  For large businesses, consider increasing limits');
    } else {
        console.log('  ✅ Can handle: Small businesses (10-50 reviews/day)');
        console.log('  ⚠️  For medium/large businesses, consider increasing limits');
    }
    console.log('');
}

async function main() {
    console.log('🧪 Auto-Reply System Test Suite\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Check environment
    const envOk = await checkEnvironment();
    if (!envOk) {
        console.log('❌ Missing required environment variables. Please check your .env file.\n');
        process.exit(1);
    }
    
    // Check database
    await checkDatabase();
    
    // Check server
    const serverOk = await checkServerHealth();
    
    // System capacity analysis
    await testSystemCapacity();
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    if (serverOk) {
        console.log('✅ System is ready for load testing!\n');
        console.log('To run full load tests:');
        console.log('  1. Get a JWT token (login via frontend)');
        console.log('  2. Run: TEST_TOKEN="your-token" node load-test.js');
        console.log('  3. Or: TEST_USER_ID="user-id" node test-auto-reply-throughput.js\n');
    } else {
        console.log('⚠️  Server is not running. Start it with: npm start\n');
    }
    
    console.log('For detailed testing guide, see: LOAD_TEST_GUIDE.md\n');
}

main().catch(error => {
    console.error('❌ Test suite failed:', error.message);
    process.exit(1);
});

