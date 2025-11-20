/**
 * WebSocket Service
 * Manages real-time communication with clients via Socket.IO
 */

let io = null;

/**
 * Initialize WebSocket server
 */
function initializeWebSocket(server) {
    const { Server } = require('socket.io');
    io = new Server(server, {
        cors: {
            origin: process.env.CLIENT_URL || 'http://localhost:5173',
            methods: ['GET', 'POST'],
            credentials: true
        },
        transports: ['websocket', 'polling']
    });

    console.log('WebSocket server initialized');
    return io;
}

/**
 * Get the io instance
 */
function getIO() {
    if (!io) {
        throw new Error('WebSocket server not initialized. Call initializeWebSocket first.');
    }
    return io;
}

/**
 * Emit event to a specific user
 */
function emitToUser(userId, event, data) {
    if (!io) {
        console.warn('WebSocket server not initialized, cannot emit event:', event);
        return;
    }
    try {
        io.to(`user:${userId}`).emit(event, data);
    } catch (error) {
        console.error('Error emitting WebSocket event:', error);
    }
}

/**
 * Emit event to all connected clients
 */
function emitToAll(event, data) {
    if (!io) {
        console.warn('WebSocket server not initialized, cannot emit event:', event);
        return;
    }
    try {
        io.emit(event, data);
    } catch (error) {
        console.error('Error emitting WebSocket event:', error);
    }
}

/**
 * Emit event to super admins only
 */
function emitToSuperAdmins(event, data) {
    if (!io) {
        console.warn('WebSocket server not initialized, cannot emit event:', event);
        return;
    }
    try {
        io.to('super-admin').emit(event, data);
    } catch (error) {
        console.error('Error emitting WebSocket event:', error);
    }
}

module.exports = {
    initializeWebSocket,
    getIO,
    emitToUser,
    emitToAll,
    emitToSuperAdmins
};

