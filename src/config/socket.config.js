const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

let io;

function initializeSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const authHeader = socket.handshake.headers?.authorization;
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        (authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null);

      if (token && process.env.JWT_SECRET) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.userId;
      } else if (socket.handshake.auth?.userId || socket.handshake.query?.userId) {
        socket.userId = socket.handshake.auth?.userId || socket.handshake.query?.userId;
      }
    } catch (err) {
      // Continue connection even if token verification fails
    }
    next();
  });

  io.on("connection", (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
      console.log(`🔌 Socket ${socket.id} auto-joined room user:${socket.userId}`);
    }

    socket.on("join-user", (userId) => {
      if (userId) {
        socket.join(`user:${userId}`);
        console.log(`🔌 Socket ${socket.id} joined room user:${userId}`);
      }
    });

    socket.on("join", (room) => {
      if (room) {
        socket.join(room);
      }
    });

    socket.on("disconnect", () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
    });
  });

  console.log("✅ Socket.IO initialized");

  return io;
}

function getIO() {
  if (!io) {
    throw new Error(
      "Socket.IO has not been initialized"
    );
  }

  return io;
}

module.exports = {
  initializeSocket,
  getIO,
};