# Auto-Reply System Load Testing Guide

## Current System Capacity

Based on the code analysis, here's what your auto-reply system can handle:

### **Theoretical Maximum Throughput:**

1. **Per Cycle (every 5 minutes):**
   - **Reply Generations:** 5 reviews (MAX_GENERATIONS_PER_CYCLE)
   - **Reply Dispatches:** 5 reviews (MAX_DISPATCH_PER_CYCLE)
   - **Total per cycle:** Up to 5 new replies generated + 5 replies sent

2. **Per Minute:**
   - **Reply Generations:** ~1 review/minute (5 per 5-minute cycle)
   - **Reply Dispatches:** ~1 review/minute (5 per 5-minute cycle)
   - **Combined:** ~2 operations/minute (1 generation + 1 dispatch)

3. **Per Hour:**
   - **Reply Generations:** ~60 reviews/hour
   - **Reply Dispatches:** ~60 reviews/hour
   - **Total:** ~120 operations/hour

### **Bottlenecks & Rate Limits:**

1. **OpenAI API:**
   - Free tier: ~3 requests/minute
   - Paid tier (Tier 1): ~500 requests/minute
   - Paid tier (Tier 2+): ~10,000+ requests/minute
   - **Current limit:** Sequential processing (1 at a time)

2. **Google My Business API:**
   - Standard quota: ~600 requests/minute per project
   - **Current limit:** Sequential processing (1 at a time)

3. **Database:**
   - MongoDB queries are fast, but sequential processing limits throughput
   - **Current limit:** No significant bottleneck

4. **System Design:**
   - **Current:** Sequential processing (one review at a time)
   - **Potential:** Could parallelize up to 5 concurrent operations

## Running Load Tests

### Prerequisites

1. Ensure your server is running:
```bash
cd server
npm start
```

2. Get a valid JWT token (login via the frontend and copy from browser localStorage or network tab)

### Test 1: API Endpoint Load Test

Tests the HTTP API endpoints under load:

```bash
cd server
TEST_TOKEN="your-jwt-token-here" \
CONCURRENT=10 \
RPS=5 \
DURATION=60 \
node load-test.js
```

**Expected Results:**
- **Good:** 200-500 requests/minute with <500ms avg response time
- **Excellent:** 500+ requests/minute with <200ms avg response time

### Test 2: Auto-Reply Service Throughput Test

Tests the actual auto-reply processing pipeline:

```bash
cd server
TEST_USER_ID="your-user-id-here" \
node test-auto-reply-throughput.js
```

**Expected Results:**
- **Generations per minute:** 1-5 (depending on OpenAI rate limits)
- **Dispatches per minute:** 1-5 (depending on Google API rate limits)

## Improving Throughput

### Option 1: Increase Cycle Limits (Quick Fix)

Edit `server/utils/constants.js`:
```javascript
MAX_GENERATIONS_PER_CYCLE: 10,  // Increase from 5
MAX_DISPATCH_PER_CYCLE: 10,     // Increase from 5
```

**Impact:** ~2x throughput (2-4 operations/minute)

### Option 2: Reduce Scan Interval (More Frequent Checks)

Edit `server/services/autoReplyService.js` or set env var:
```bash
AUTO_REPLY_SCAN_INTERVAL_MS=60000  # 1 minute instead of 5
```

**Impact:** 5x more frequent checks, but same per-cycle limits

### Option 3: Parallel Processing (Best Performance)

Modify `generateReplies()` and `dispatchReplies()` to process multiple tasks concurrently:

```javascript
// Instead of sequential for loop:
const promises = tasks.map(task => generateReplyForTask(task));
await Promise.all(promises);
```

**Impact:** Up to 5x throughput (5-10 operations/minute)

### Option 4: Optimize for High Volume (Production Ready)

1. **Batch Processing:** Process multiple users in parallel
2. **Queue System:** Use Redis/BullMQ for job queuing
3. **Rate Limiting:** Implement intelligent backoff for API limits
4. **Caching:** Cache OpenAI responses for similar reviews

**Impact:** 10-50+ operations/minute (depending on API tiers)

## Real-World Capacity Estimate

**Current Setup (Sequential, 5 per cycle, 5-min interval):**
- **Small business (10-50 reviews/day):** ✅ Handles easily
- **Medium business (50-200 reviews/day):** ⚠️ May need optimization
- **Large business (200+ reviews/day):** ❌ Needs parallel processing

**With Parallel Processing (5 concurrent, 10 per cycle, 1-min interval):**
- **Small business:** ✅ Overkill but fine
- **Medium business:** ✅ Handles comfortably
- **Large business:** ✅ Should handle most cases

## Monitoring Recommendations

1. **Track Metrics:**
   - Tasks in `detected` status (backlog)
   - Average time from detection to sent
   - Error rates (generation_failed, delivery_failed)

2. **Set Alerts:**
   - If backlog > 50 tasks
   - If error rate > 5%
   - If average processing time > 10 minutes

3. **Optimize Based on:**
   - Your actual review volume
   - API rate limit tiers you're on
   - Server resources available

## Next Steps

1. Run the load tests to get baseline metrics
2. Monitor your actual review volume
3. Adjust limits based on your needs
4. Consider parallel processing if volume is high

