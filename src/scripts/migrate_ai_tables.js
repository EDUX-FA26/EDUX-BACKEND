require('dotenv').config();
const { pool } = require('../config/db.config');

async function migrate() {
  console.log('Running migration for AI tables...');
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_interactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        uuid VARCHAR(255) UNIQUE NOT NULL,
        submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        submission_version_id UUID NOT NULL REFERENCES submission_versions(id) ON DELETE CASCADE,
        assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ai_tool VARCHAR(100) NOT NULL CHECK (ai_tool IN ('chatgpt', 'gemini', 'claude', 'copilot', 'other')),
        usage_purpose VARCHAR(100) NOT NULL CHECK (usage_purpose IN ('brainstorming', 'topic_research', 'summarization', 'writing_improvement', 'critical_feedback', 'methodology_review', 'data_analysis', 'other')),
        prompt_content TEXT NOT NULL,
        ai_response_summary TEXT NOT NULL,
        student_decision VARCHAR(50) NOT NULL CHECK (student_decision IN ('accepted', 'partially_accepted', 'rejected', 'reference_only')),
        reflection_text TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ai_evaluations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        submission_version_id UUID UNIQUE NOT NULL REFERENCES submission_versions(id) ON DELETE CASCADE,
        assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        pattern VARCHAR(100) NOT NULL CHECK (pattern IN ('critical_engagement', 'collaborative_usage', 'passive_usage', 'high_dependency')),
        risk_level VARCHAR(50) DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
        transparency_score NUMERIC(5,2) DEFAULT 0 CHECK (transparency_score BETWEEN 0 AND 100),
        prompt_quality_score NUMERIC(5,2) DEFAULT 0 CHECK (prompt_quality_score BETWEEN 0 AND 100),
        reflection_quality_score NUMERIC(5,2) DEFAULT 0 CHECK (reflection_quality_score BETWEEN 0 AND 100),
        critical_thinking_score NUMERIC(5,2) DEFAULT 0 CHECK (critical_thinking_score BETWEEN 0 AND 100),
        ai_dependency_score NUMERIC(5,2) DEFAULT 0 CHECK (ai_dependency_score BETWEEN 0 AND 100),
        summary TEXT DEFAULT '',
        evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ AI tables migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
