require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

/**
 * Script to make a user a super admin
 * Usage: node scripts/makeSuperAdmin.js <email>
 */
async function makeSuperAdmin() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const email = process.argv[2];
        if (!email) {
            console.error('Usage: node scripts/makeSuperAdmin.js <email>');
            process.exit(1);
        }

        const user = await User.findOne({ email });
        if (!user) {
            console.error(`User with email ${email} not found`);
            process.exit(1);
        }

        user.role = 'super_admin';
        await user.save();

        console.log(`✅ User ${email} is now a super admin`);
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

makeSuperAdmin();

