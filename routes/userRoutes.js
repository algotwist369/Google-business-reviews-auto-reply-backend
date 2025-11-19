const express = require('express');
const { getProfile } = require('../controllers/userController');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);

router.get('/profile', getProfile);

module.exports = router;

