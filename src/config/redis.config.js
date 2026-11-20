const { createClient } = require("redis");

const redisConfig = process.env.REDIS_URL
  ? {
      url: process.env.REDIS_URL,
    }
  : {
      socket: {
        host: process.env.REDIS_HOST || "localhost",
        port: Number(process.env.REDIS_PORT) || 6379,
      },
      password: process.env.REDIS_PASSWORD || undefined,
    };

const redis = createClient(redisConfig);

redis.on("error", (error) => {
  console.error("❌ Redis error:", error.message);
});

redis.on("connect", () => {
  console.log("🔄 Redis connecting...");
});

redis.on("ready", () => {
  console.log("✅ Redis ready");
});

async function connectRedis() {
  if (!redis.isOpen) {
    await redis.connect();
  }
}

module.exports = {
  redis,
  connectRedis,
};