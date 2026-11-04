require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { pool } = require('../config/db.config');

async function migrate() {
  console.log('Running migration for AI evaluation snapshot & rubrics...');
  try {
    await pool.query(`
      ALTER TABLE ai_evaluations ADD COLUMN IF NOT EXISTS evaluation_data JSONB;
      ALTER TABLE ai_evaluations ADD COLUMN IF NOT EXISTS rubric_scores JSONB;
      ALTER TABLE ai_evaluations ADD COLUMN IF NOT EXISTS viva_questions JSONB;
      ALTER TABLE ai_evaluations ADD COLUMN IF NOT EXISTS total_score NUMERIC;
      ALTER TABLE ai_evaluations ADD COLUMN IF NOT EXISTS overall_verdict TEXT;
      ALTER TABLE grades ADD COLUMN IF NOT EXISTS rubrics JSONB;
    `);
    console.log('✅ Migration for AI evaluation snapshot completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

