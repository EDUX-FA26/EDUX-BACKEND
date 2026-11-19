-- Migration: Add no_ai_used and no_ai_note to submissions table
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS no_ai_used BOOLEAN DEFAULT false;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS no_ai_note TEXT;

-- Create index for quick filtering if needed
CREATE INDEX IF NOT EXISTS idx_submissions_no_ai_used ON submissions(school_id, no_ai_used);
