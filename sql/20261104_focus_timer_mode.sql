-- Migration: Add timer_mode and update focus_sessions
BEGIN;

ALTER TABLE focus_sessions
ADD COLUMN IF NOT EXISTS timer_mode VARCHAR(20) NOT NULL DEFAULT 'pomodoro';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_focus_sessions_timer_mode'
  ) THEN
    ALTER TABLE focus_sessions ADD CONSTRAINT chk_focus_sessions_timer_mode CHECK (timer_mode IN ('pomodoro', 'stopwatch'));
  END IF;
END $$;

COMMIT;

