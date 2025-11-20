const express = require('express');
const {
    getAutoReplyConfig,
    getAutoReplyStats,
    updateAutoReplyConfig,
    listAutoReplyTasks,
    runAutoReplyNow,
    retryAutoReplyTask,
    getNewReviews
} = require('../controllers/autoReplyController');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);

router.get('/config', getAutoReplyConfig);
router.get('/stats', getAutoReplyStats);
router.put('/config', updateAutoReplyConfig);
router.get('/tasks', listAutoReplyTasks);
router.get('/new-reviews', getNewReviews);
router.post('/run', runAutoReplyNow);
router.post('/tasks/:taskId/retry', retryAutoReplyTask);

module.exports = router;


