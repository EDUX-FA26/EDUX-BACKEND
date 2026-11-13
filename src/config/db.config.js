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

    // Auto-check và tạo bảng class_ai_advisories nếu chưa có
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS class_ai_advisories (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
            assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE,
            assignment_title VARCHAR(255),
            mode VARCHAR(50) DEFAULT 'DEEP_TECHNICAL',
            submission_rate_text VARCHAR(100),
            avg_ai_transparency VARCHAR(100),
            common_error_clusters JSONB DEFAULT '[]'::jsonb,
            next_slot_recommendation TEXT,
            raw_payload JSONB,
            generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            CONSTRAINT unique_class_assignment_advisory UNIQUE (class_id, assignment_id)
        );

        ALTER TABLE class_ai_advisories ADD COLUMN IF NOT EXISTS mode VARCHAR(50) DEFAULT 'DEEP_TECHNICAL';

        CREATE INDEX IF NOT EXISTS idx_class_advisories_class_lookup 
        ON class_ai_advisories(class_id, generated_at DESC);
      `);
    } catch (migErr) {
      console.warn("⚠️ Class AI Advisories table migration notice:", migErr.message);
    }

    // Auto-check và tạo bảng assignment_rubric_configs nếu chưa có
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS assignment_rubric_configs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
          criterion_key VARCHAR(64) NOT NULL,
          criterion_name VARCHAR(255) NOT NULL,
          is_enabled BOOLEAN NOT NULL DEFAULT true,
          weight_percent INTEGER NOT NULL DEFAULT 0 CHECK (weight_percent >= 0 AND weight_percent <= 100),
          display_order INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT unique_assignment_criterion UNIQUE(assignment_id, criterion_key)
        );

        CREATE INDEX IF NOT EXISTS idx_assignment_rubric_configs_assignment_id 
        ON assignment_rubric_configs(assignment_id, display_order ASC);
      `);
    } catch (migErr) {
      console.warn("⚠️ Assignment Rubric Configs table migration notice:", migErr.message);
    }

    // Auto-check và bổ sung slot_id vào bảng assignments nếu chưa có
    try {
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'assignments' AND column_name = 'slot_id'
          ) THEN
            ALTER TABLE assignments ADD COLUMN slot_id UUID REFERENCES sessions(id) ON DELETE SET NULL;
            CREATE INDEX IF NOT EXISTS idx_assignments_slot_id ON assignments(slot_id);
          END IF;

          UPDATE assignments SET slot_id = session_id WHERE slot_id IS NULL AND session_id IS NOT NULL;
          UPDATE assignments SET session_id = slot_id WHERE session_id IS NULL AND slot_id IS NOT NULL;
        END $$;
      `);
    } catch (migErr) {
      console.warn("⚠️ Assignments slot_id migration notice:", migErr.message);
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
