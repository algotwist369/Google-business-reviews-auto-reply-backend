require('dotenv').config();
const express = require('express');
const passport = require('passport');
const mongoose = require('mongoose');
const cluster = require('node:cluster');
const os = require('node:os');

// Import configurations
const connectDB = require('./config/database');
const configurePassport = require('./config/passport');
const configureApp = require('./config/app');
const validateEnv = require('./config/validateEnv');
const { errorHandler } = require('./utils/errorHandler');
const autoReplyService = require('./services/autoReplyService');

const shouldUseCluster = process.env.USE_CLUSTER === 'true' && process.env.NODE_ENV !== 'test';
const requestedWorkers = Math.max(1, Number(process.env.CLUSTER_WORKERS) || os.cpus().length);

// Import routes
console.log('Loading routes...');
const authRoutes = require('./routes/authRoutes');
console.log('✓ authRoutes loaded');
const userRoutes = require('./routes/userRoutes');
console.log('✓ userRoutes loaded');
const reviewsRoutes = require('./routes/reviewsRoutes');
console.log('✓ reviewsRoutes loaded');
const autoReplyRoutes = require('./routes/autoReplyRoutes');
console.log('✓ autoReplyRoutes loaded');
const superAdminRoutes = require('./routes/superAdminRoutes');
console.log('✓ superAdminRoutes loaded');
const paymentRoutes = require('./routes/paymentRoutes');
console.log('✓ paymentRoutes loaded');
const { handleWebhook } = require('./controllers/paymentController');

// Validate environment configuration early
validateEnv();

// Initialize Express app
const app = express();

// Payment webhook route (MUST be before JSON body parser)
app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// Configure app middleware
configureApp(app);

// Initialize Passport
app.use(passport.initialize());
configurePassport();

// Health check endpoint (before routes for better performance)
// Returns 200 if healthy, 503 if unhealthy (for load balancer/proxy health checks)
app.get('/health', async (req, res) => {
    try {
        // Check MongoDB connection
        const mongoStatus = mongoose.connection.readyState;
        // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
        const isDbConnected = mongoStatus === 1;

        if (!isDbConnected) {
            return res.status(503).json({
                status: 'UNHEALTHY',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                checks: {
                    database: 'disconnected',
                    statusCode: mongoStatus
                }
            });
        }

        // All checks passed
        res.status(200).json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            checks: {
                database: 'connected'
            }
        });
    } catch (error) {
        res.status(503).json({
            status: 'UNHEALTHY',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            error: error.message
        });
    }
});

// Routes
console.log('Registering routes...');
app.use('/auth', authRoutes);
console.log('✓ /auth route registered');
app.use('/api/user', userRoutes);
console.log('✓ /api/user route registered');
app.use('/api/reviews', reviewsRoutes);
console.log('✓ /api/reviews route registered');
app.use('/api/auto-reply', autoReplyRoutes);
console.log('✓ /api/auto-reply route registered');
app.use('/api/super-admin', superAdminRoutes);
console.log('✓ /api/super-admin route registered');
app.use('/api/payment', paymentRoutes);
console.log('✓ /api/payment route registered (webhook already registered above)');

// 404 handler - must be after all routes
// Note: Express 5 doesn't support wildcard '*' pattern in app.use()
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        error: `Route ${req.originalUrl} not found`
    });
});

// Global error handler (must be last)
app.use(errorHandler);

const startServer = () => {
    const dbPromise = connectDB();
    const shouldStartAutoReplyService = !shouldUseCluster || process.env.AUTO_REPLY_PRIMARY === 'true';

    if (shouldStartAutoReplyService) {
        dbPromise
            .then(() => autoReplyService.start())
            .catch((error) => {
                console.error('Failed to start auto-reply service:', error.message);
            });
    }

    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
        if (shouldUseCluster) {
            console.log(`Worker PID ${process.pid} online${process.env.AUTO_REPLY_PRIMARY === 'true' ? ' (auto-reply dispatcher)' : ''}`);
        }
    });

    const websocketService = require('./services/websocketService');
    const io = websocketService.initializeWebSocket(server);

    const jwt = require('jsonwebtoken');
    const User = require('./models/User');

    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

            if (!token) {
                return next(new Error('Authentication error: No token provided'));
            }

            const decoded = jwt.verify(token, process.env.SESSION_SECRET);
            const user = await User.findById(decoded.id).select('-__v').lean();

            if (!user || !user.googleAccessToken) {
                return next(new Error('Authentication error: User not found or invalid'));
            }

            socket.userId = user._id.toString();
            socket.isSuperAdmin = user.role === 'super_admin';
            socket.user = user;

            next();
        } catch (error) {
            console.error('WebSocket authentication error:', error.message);
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.userId;
        const isSuperAdmin = socket.isSuperAdmin;

        socket.join(`user:${userId}`);

        if (isSuperAdmin) {
            socket.join('super-admin');
        }

        console.log(`WebSocket client connected: ${userId} (Super Admin: ${isSuperAdmin})`);

        socket.on('disconnect', () => {
            console.log(`WebSocket client disconnected: ${userId}`);
        });

        socket.on('error', (error) => {
            console.error(`WebSocket error for user ${userId}:`, error);
        });
    });

    const gracefulShutdown = () => {
        if (!server.listening) {
            return process.exit(1);
        }
        server.close(() => {
            process.exit(1);
        });
    };

    process.on('unhandledRejection', (err) => {
        console.error('Unhandled Promise Rejection:', err);
        gracefulShutdown();
    });

    process.on('uncaughtException', (err) => {
        console.error('Uncaught Exception:', err);
        gracefulShutdown();
    });

    return server;
};

const bootstrapCluster = () => {
    if (shouldUseCluster && cluster.isPrimary) {
        console.log(`Primary PID ${process.pid} starting ${requestedWorkers} workers...`);

        let autoReplyAssigned = false;
        const forkWorker = (assignAutoReply) => {
            const env = { ...process.env, AUTO_REPLY_PRIMARY: assignAutoReply ? 'true' : 'false' };
            const worker = cluster.fork(env);
            worker.isAutoReplyPrimary = assignAutoReply;
            return worker;
        };

        for (let i = 0; i < requestedWorkers; i += 1) {
            const worker = forkWorker(!autoReplyAssigned);
            if (!autoReplyAssigned && worker.isAutoReplyPrimary) {
                autoReplyAssigned = true;
            }
        }

        cluster.on('exit', (worker) => {
            console.warn(`Worker PID ${worker.process.pid} exited. Restarting...`);
            forkWorker(worker.isAutoReplyPrimary);
        });
    } else {
        if (!process.env.AUTO_REPLY_PRIMARY) {
            process.env.AUTO_REPLY_PRIMARY = 'true';
        }
        startServer();
    }
};

bootstrapCluster();

module.exports = app;
