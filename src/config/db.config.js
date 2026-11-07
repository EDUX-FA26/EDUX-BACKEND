const { Pool, types } = require("pg");

// Parse PostgreSQL DATE (OID 1082) directly as 'YYYY-MM-DD' string to avoid local timezone offset drift
types.setTypeParser(1082, (val) => val);

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

    // Auto-check và bổ sung timer_mode vào bảng focus_sessions nếu chưa có
    try {
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'focus_sessions') THEN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'focus_sessions' AND column_name = 'timer_mode'
            ) THEN
              ALTER TABLE focus_sessions ADD COLUMN timer_mode VARCHAR(20) NOT NULL DEFAULT 'pomodoro';
            END IF;
          END IF;
        END $$;
      `);
    } catch (migErr) {
      console.warn("⚠️ Focus sessions timer_mode migration notice:", migErr.message);
    }

    // Auto-check và cập nhật submissions_status_check hỗ trợ 'draft'
    try {
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conrelid = 'submissions'::regclass AND conname = 'submissions_status_check'
              AND pg_get_constraintdef(oid) NOT LIKE '%draft%'
          ) THEN
            ALTER TABLE submissions DROP CONSTRAINT submissions_status_check;
            ALTER TABLE submissions ADD CONSTRAINT submissions_status_check 
              CHECK (status IN ('draft', 'pending', 'submitted', 'resubmitted', 'late', 'evaluated', 'reviewed', 'graded', 'flagged', 'withdrawn'));
          END IF;
        END $$;
      `);
    } catch (migErr) {
      console.warn("⚠️ Submissions status constraint migration notice:", migErr.message);
    }

    console.log("✅ PostgreSQL connected");

    client.release();
  } catch (error) {
    console.error("❌ PostgreSQL connection failed:");
    console.error(error.message);

    throw error;
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
