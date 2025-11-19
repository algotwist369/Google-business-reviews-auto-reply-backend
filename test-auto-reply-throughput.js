require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const AutoReplyTask = require('./models/AutoReplyTask');
const autoReplyService = require('./services/autoReplyService');

// Test configuration
const TEST_USER_ID = process.env.TEST_USER_ID || '';
const TEST_DURATION_MS = 60000; // 1 minute
const TEST_START_TIME = Date.now();

let tasksProcessed = 0;
let repliesGenerated = 0;
let repliesDispatched = 0;
let errors = [];

async function testAutoReplyThroughput() {
    console.log('🧪 Testing Auto-Reply Service Throughput\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB\n');

        let user;
        if (TEST_USER_ID) {
            user = await User.findById(TEST_USER_ID);
        } else {
            // Auto-find first user with auto-reply enabled
            user = await User.findOne({ 'autoReplySettings.enabled': true });
            if (!user) {
                // Fallback to any user
                user = await User.findOne();
            }
        }
        
        if (!user) {
            console.error('❌ No users found in database');
            process.exit(1);
        }

        console.log(`Testing with user: ${user.name || user.email}\n`);

        // Count initial tasks
        const initialTaskCount = await AutoReplyTask.countDocuments({ userId: user._id });
        console.log(`Initial tasks in queue: ${initialTaskCount}\n`);

        // Monitor task processing
        const monitorInterval = setInterval(async () => {
            const currentTasks = await AutoReplyTask.countDocuments({ 
                userId: user._id,
                status: { $in: ['detected', 'scheduled', 'sent'] }
            });
            const sentCount = await AutoReplyTask.countDocuments({ 
                userId: user._id,
                status: 'sent',
                sentAt: { $gte: new Date(TEST_START_TIME) }
            });
            const generatedCount = await AutoReplyTask.countDocuments({ 
                userId: user._id,
                status: 'scheduled',
                updatedAt: { $gte: new Date(TEST_START_TIME) }
            });

            console.log(`[${new Date().toLocaleTimeString()}] Active: ${currentTasks} | Generated: ${generatedCount} | Sent: ${sentCount}`);
        }, 5000);

        // Run manual trigger multiple times to simulate load
        console.log('Starting throughput test...\n');
        const testPromises = [];

        for (let i = 0; i < 12; i++) { // Run 12 cycles in 1 minute (every 5 seconds)
            testPromises.push(
                new Promise(resolve => {
                    setTimeout(async () => {
                        try {
                            const result = await autoReplyService.triggerManualRun(user._id);
                            tasksProcessed++;
                            if (result.success) {
                                console.log(`✅ Cycle ${i + 1} completed`);
                            }
                        } catch (error) {
                            errors.push({ cycle: i + 1, error: error.message });
                            console.log(`❌ Cycle ${i + 1} failed: ${error.message}`);
                        }
                        resolve();
                    }, i * 5000);
                })
            );
        }

        await Promise.all(testPromises);
        clearInterval(monitorInterval);

        // Final statistics
        const finalTaskCount = await AutoReplyTask.countDocuments({ userId: user._id });
        const sentInTest = await AutoReplyTask.countDocuments({ 
            userId: user._id,
            status: 'sent',
            sentAt: { $gte: new Date(TEST_START_TIME) }
        });
        const generatedInTest = await AutoReplyTask.countDocuments({ 
            userId: user._id,
            status: 'scheduled',
            updatedAt: { $gte: new Date(TEST_START_TIME) }
        });

        const testDuration = (Date.now() - TEST_START_TIME) / 1000;

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📊 Auto-Reply Throughput Test Results:\n');
        console.log(`Test Duration:           ${testDuration.toFixed(2)}s`);
        console.log(`Cycles Completed:        ${tasksProcessed}/12`);
        console.log(`Tasks Processed:         ${finalTaskCount - initialTaskCount}`);
        console.log(`Replies Generated:       ${generatedInTest}`);
        console.log(`Replies Dispatched:      ${sentInTest}`);
        console.log(`Errors:                  ${errors.length}`);
        console.log(`\nThroughput:`);
        console.log(`  Cycles per minute:     ${(tasksProcessed / testDuration * 60).toFixed(2)}`);
        console.log(`  Generations per min:   ${(generatedInTest / testDuration * 60).toFixed(2)}`);
        console.log(`  Dispatches per min:    ${(sentInTest / testDuration * 60).toFixed(2)}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Current system limits
        console.log('📋 Current System Limits:');
        console.log(`  MAX_GENERATIONS_PER_CYCLE: 5`);
        console.log(`  MAX_DISPATCH_PER_CYCLE:    5`);
        console.log(`  SCAN_INTERVAL:             5 minutes`);
        console.log(`  Google API Concurrent:      5 requests`);
        console.log('\n💡 Note: Actual throughput depends on:');
        console.log('  - OpenAI API rate limits');
        console.log('  - Google My Business API rate limits');
        console.log('  - Database performance');
        console.log('  - Network latency\n');

        if (errors.length > 0) {
            console.log('⚠️  Errors encountered:');
            errors.forEach(err => {
                console.log(`  Cycle ${err.cycle}: ${err.error}`);
            });
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    } finally {
        await mongoose.connection.close();
        console.log('\n✅ Test completed. Database connection closed.');
        process.exit(0);
    }
}

testAutoReplyThroughput();

