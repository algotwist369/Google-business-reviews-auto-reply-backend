const express = require('express');
const {
    getAutoReplyConfig,
    updateAutoReplyConfig,
    listAutoReplyTasks,
    runAutoReplyNow,
    retryAutoReplyTask
} = require('../controllers/autoReplyController');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);

router.get('/config', getAutoReplyConfig);
router.put('/config', updateAutoReplyConfig);
router.get('/tasks', listAutoReplyTasks);
router.post('/run', runAutoReplyNow);
router.post('/tasks/:taskId/retry', retryAutoReplyTask);

module.exports = router;


