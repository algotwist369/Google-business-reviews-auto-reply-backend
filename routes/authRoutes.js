const express = require('express');
const passport = require('passport');
const { googleCallback } = require('../controllers/authController');

const router = express.Router();

// Google OAuth routes
router.get('/google', passport.authenticate('google'));

router.get(
    '/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: '/' }),
    googleCallback
);

module.exports = router;

