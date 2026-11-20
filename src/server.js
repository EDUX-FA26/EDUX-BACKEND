require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});

const http = require("http");

const app = require("./app");

const {
  connectDB,
} = require("./config/db.config");

const {
  connectRedis,
} = require("./config/redis.config");

const {
  connectSeaweed,
} = require("./config/seaweed.config");

const {
  initializeSocket,
} = require("./config/socket.config");


const PORT = process.env.PORT || 5000;


async function startServer() {
  try {
    console.log("");
    console.log("=================================");
    console.log("🚀 Starting EDUX Backend...");
    console.log("=================================");

    // =========================
    // PostgreSQL
    // =========================

    await connectDB();

    // =========================
    // Redis
    // =========================

    await connectRedis();

    // =========================
    // SeaweedFS
    // =========================

    if (process.env.STORAGE_ENABLED !== "false") {
      await connectSeaweed();
    } else {
      console.log("⚠️ SeaweedFS temporarily disabled");
    }
    // =========================
    // HTTP Server
    // =========================

    const server = http.createServer(app);

    // =========================
    // Socket.IO
    // =========================

    initializeSocket(server);

    // =========================
    // Start Server
    // =========================

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ EDUX Backend running on port ${PORT}`);
      console.log("");
      console.log("=================================");
      console.log("✅ EDUX Backend started");
      console.log(`🌐 EDUX Backend listening on port ${PORT}`);
      console.log(`❤️  Health check: /health`);
      console.log("=================================");
      console.log("");
    });

  } catch (error) {
    console.error("");
    console.error("=================================");
    console.error("❌ Failed to start EDUX Backend");
    console.error("=================================");
    console.error(error);

    process.exit(1);
  }
}

startServer();