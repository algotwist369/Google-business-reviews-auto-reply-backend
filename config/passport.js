const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
require('dotenv').config();

const configurePassport = () => {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
        accessType: 'offline',
        scope: [
            'profile',
            'email',
            'https://www.googleapis.com/auth/business.manage'
        ]
    },
    async (accessToken, refreshToken, profile, done) => {
        try {
            let user = await User.findOne({ googleId: profile.id });

            if (!user) {
                user = new User({
                    googleId: profile.id,
                    name: profile.displayName,
                    email: profile.emails[0].value,
                    avatar: profile.photos[0].value,
                    googleAccessToken: accessToken,
                    googleRefreshToken: refreshToken // Store refresh token if available
                });
            } else {
                user.googleAccessToken = accessToken;
                if (refreshToken) {
                    user.googleRefreshToken = refreshToken;
                }
            }
            await user.save();
            return done(null, user);
        } catch (err) {
            return done(err, null);
        }
    }
    ));
};

module.exports = configurePassport;

