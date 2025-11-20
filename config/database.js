const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    try {
        const maxPoolSize = Number(process.env.MONGO_MAX_POOL_SIZE || 50);
        const minPoolSize = Number(process.env.MONGO_MIN_POOL_SIZE || Math.max(1, Math.floor(maxPoolSize / 5)));

        const options = {
            maxPoolSize,
            minPoolSize,
            maxIdleTimeMS: Number(process.env.MONGO_MAX_IDLE_MS || 30000),
            serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000),
            socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000),
            heartbeatFrequencyMS: Number(process.env.MONGO_HEARTBEAT_MS || 10000),
            retryWrites: true,
            retryReads: true,
            family: 4,
            bufferCommands: false // Disable mongoose buffering
        };

        const conn = await mongoose.connect(
            process.env.MONGO_URI,
            options
        );

        console.log(`MongoDB Connected: ${conn.connection.host}`);

        // Handle connection events
        mongoose.connection.on('error', (err) => {
            console.error('MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('MongoDB disconnected');
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log('MongoDB connection closed through app termination');
            process.exit(0);
        });

        return conn;
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

module.exports = connectDB;

