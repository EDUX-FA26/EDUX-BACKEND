-- Migration: Add 'draft' to submissions status check constraint
-- Date: 2026-11-07

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'submissions'::regclass AND conname = 'submissions_status_check'
  ) THEN
    ALTER TABLE submissions DROP CONSTRAINT submissions_status_check;
  END IF;

  ALTER TABLE submissions ADD CONSTRAINT submissions_status_check 
    CHECK (status IN ('draft', 'pending', 'submitted', 'resubmitted', 'late', 'evaluated', 'reviewed', 'graded', 'flagged', 'withdrawn'));
END $$;

