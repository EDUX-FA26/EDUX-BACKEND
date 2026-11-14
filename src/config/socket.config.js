const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { pool } = require("./db.config");

let io;

function initializeSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const authHeader =
        socket.handshake.headers?.authorization;

      const bearerToken =
        authHeader?.startsWith("Bearer ")
          ? authHeader.slice(7)
          : null;

      const token =
        socket.handshake.auth?.token ||
        bearerToken;

      const schoolId =
        socket.handshake.auth?.schoolId || null;

      // =========================================
      // VERIFY JWT
      // =========================================

      if (!token || !process.env.JWT_SECRET) {
        return next(new Error("UNAUTHORIZED"));
      }

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET,
        {
          algorithms: ["HS256"],
        }
      );

      const userId = decoded?.userId;

      if (!userId) {
        return next(new Error("UNAUTHORIZED"));
      }

      // =========================================
      // CHECK GLOBAL ACCOUNT
      // =========================================

      const userResult = await pool.query(
        `
      SELECT id
      FROM public.users
      WHERE id = $1
        AND is_active = TRUE
      `,
        [userId]
      );

      if (userResult.rowCount === 0) {
        return next(new Error("ACCOUNT_INACTIVE"));
      }

      // =========================================
      // CHECK SCHOOL MEMBERSHIP
      // =========================================

      if (schoolId) {
        const membershipResult = await pool.query(
          `
        SELECT sm.role
        FROM public.school_memberships sm

        JOIN public.schools s
          ON s.id = sm.school_id

        WHERE sm.school_id = $1
          AND sm.user_id = $2
          AND sm.status = 'active'
          AND s.status = 'active'
        `,
          [schoolId, userId]
        );

        if (membershipResult.rowCount === 0) {
          return next(
            new Error("SCHOOL_ACCESS_DENIED")
          );
        }

        socket.data.schoolRole =
          membershipResult.rows[0].role;
      }

      // =========================================
      // VERIFIED SOCKET IDENTITY
      // =========================================

      socket.data.userId = userId;
      socket.data.schoolId = schoolId;

      // Backward compatibility
      socket.userId = userId;

      next();
    } catch (error) {
      console.warn(
        "[SOCKET AUTH]",
        error.message
      );

      return next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    const schoolId = socket.data.schoolId;

    // Platform notifications
    socket.join(`user:${userId}`);

    // School notifications
    if (schoolId) {
      socket.join(
        `user:${userId}:school:${schoolId}`
      );
    }

    console.log("[SOCKET] Authorized connection:", {
      socketId: socket.id,
      userId,
      schoolId,
    });

    socket.on("disconnect", (reason) => {
      console.log("[SOCKET] Disconnected:", {
        socketId: socket.id,
        reason,
      });
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