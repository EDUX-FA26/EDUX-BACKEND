-- Required for POST /api/semesters/:id/lock. Apply once to the target database.
ALTER TABLE semesters ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS semesters_one_current_idx ON semesters (is_current) WHERE is_current = TRUE;
