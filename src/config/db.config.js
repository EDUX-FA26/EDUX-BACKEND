const { Pool, types } = require("pg");

types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl:
    process.env.DB_SSL === "true"
      ? {
          rejectUnauthorized: true,
        }
      : false,
});

pool.on("error", (error) => {
  console.error(
    "❌ Unexpected PostgreSQL error:",
    error
  );
});

async function connectDB() {
  const client = await pool.connect();

  try {
    await client.query("SELECT 1");
    console.log("✅ PostgreSQL connected");
  } finally {
    client.release();
  }
}

async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await callback(client);

    await client.query("COMMIT");

    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  connectDB,
  withTransaction,
};