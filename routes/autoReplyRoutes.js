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
const { validateBody, validateParams } = require('../middleware/schemaValidator');
const { autoReplySchemas } = require('../validators');

const router = express.Router();

router.use(verifyToken);

router.get('/config', getAutoReplyConfig);
router.get('/stats', getAutoReplyStats);
router.put('/config', validateBody(autoReplySchemas.updateConfigBody), updateAutoReplyConfig);
router.get('/tasks', listAutoReplyTasks);
router.get('/new-reviews', getNewReviews);
router.post('/run', validateBody(autoReplySchemas.runBody), runAutoReplyNow);
router.post('/tasks/:taskId/retry', validateParams(autoReplySchemas.retryParams), retryAutoReplyTask);

module.exports = router;


