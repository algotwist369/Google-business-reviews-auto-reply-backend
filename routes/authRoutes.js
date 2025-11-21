const express = require('express');
const passport = require('passport');
const { googleCallback, refreshAccessToken, logout } = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Google OAuth routes
router.get('/google', passport.authenticate('google'));

router.get(
    '/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: '/' }),
    googleCallback
);

router.post('/refresh', refreshAccessToken);
router.post('/logout', verifyToken, logout);

module.exports = router;

