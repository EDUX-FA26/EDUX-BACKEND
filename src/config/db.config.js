const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on("error", (error) => {
  console.error("❌ Unexpected PostgreSQL error:", error);
});

async function connectDB() {
  try {
    const client = await pool.connect();

    console.log("✅ PostgreSQL connected");

    client.release();
  } catch (error) {
    console.error("❌ PostgreSQL connection failed:");
    console.error(error.message);

    throw error;
  }
}

module.exports = {
  pool,
  connectDB,
};