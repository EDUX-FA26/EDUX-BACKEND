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

    await connectSeaweed();

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

    server.listen(PORT, () => {
      console.log("");
      console.log("=================================");
      console.log("✅ EDUX Backend started");
      console.log(`🌐 http://localhost:${PORT}`);
      console.log(`❤️  http://localhost:${PORT}/health`);
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