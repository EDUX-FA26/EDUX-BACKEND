-- Migration 007 support schema.
-- Preflight: run against a reviewed non-production database first. This file
-- makes additive changes and does not repair or delete orphaned Legacy data.
-- Run explicitly from a reviewed PostgreSQL client with ON_ERROR_STOP enabled,
-- for example: psql -v ON_ERROR_STOP=1 -f sql/20261113_migration007_schema.sql
--
-- This replaces the legacy global current-semester index with per-school
-- uniqueness. A rollback must not restore global uniqueness without first
-- reviewing current semesters across all schools.
--
-- Rollback: roll back application code first. Keep the added notification
-- scope columns and stored values; dropping them would erase tenant metadata.
-- The timer_mode column, class_ai_advisories table, and submissions status
-- constraint should likewise be retained unless a separately reviewed rollback
-- confirms that no application data depends on them.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.schools') IS NULL
     OR to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION
      'Migration 007 requires public.schools and public.notifications';
  END IF;

  IF to_regclass('public.classes') IS NULL
     OR to_regclass('public.assignments') IS NULL
     OR to_regclass('public.submissions') IS NULL THEN
    RAISE EXCEPTION
      'Migration 007 requires public.classes, public.assignments and public.submissions';
  END IF;

  IF to_regclass('public.semesters') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'semesters'
         AND column_name = 'school_id'
     ) THEN
    RAISE EXCEPTION
      'Migration 007 requires public.semesters.school_id';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.semesters
    WHERE is_current = TRUE
      AND school_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Preflight failed: current semesters without school_id require manual review';
  END IF;

  IF EXISTS (
    SELECT school_id
    FROM public.semesters
    WHERE is_current = TRUE
    GROUP BY school_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Preflight failed: a school has multiple current semesters';
  END IF;

  IF to_regclass('public.submissions') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.submissions
       WHERE status IS NOT NULL
         AND status NOT IN (
           'draft', 'pending', 'submitted', 'resubmitted', 'late',
           'evaluated', 'reviewed', 'graded', 'flagged', 'withdrawn'
         )
     ) THEN
    RAISE EXCEPTION
      'Preflight failed: submissions contain statuses outside the supported set';
  END IF;
END;
$$;

DO $$
DECLARE
  current_index_definition TEXT;
BEGIN
  IF to_regclass('public.semesters_one_current_idx') IS NOT NULL THEN
    SELECT pg_get_indexdef(
      to_regclass('public.semesters_one_current_idx')
    )
    INTO current_index_definition;

    IF POSITION('school_id' IN current_index_definition) = 0 THEN
      DROP INDEX public.semesters_one_current_idx;
    END IF;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS semesters_one_current_per_school_idx
  ON public.semesters (school_id)
  WHERE is_current = TRUE;

DO $$
BEGIN
  IF to_regclass('public.focus_sessions') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'focus_sessions'
         AND column_name = 'timer_mode'
     ) THEN
    ALTER TABLE public.focus_sessions
      ADD COLUMN timer_mode VARCHAR(20) NOT NULL DEFAULT 'pomodoro';
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.submissions') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'public.submissions'::regclass
         AND conname = 'submissions_status_check'
         AND pg_get_constraintdef(oid) NOT LIKE '%draft%'
     ) THEN
    ALTER TABLE public.submissions
      DROP CONSTRAINT submissions_status_check;

    ALTER TABLE public.submissions
      ADD CONSTRAINT submissions_status_check
      CHECK (
        status IN (
          'draft', 'pending', 'submitted', 'resubmitted', 'late',
          'evaluated', 'reviewed', 'graded', 'flagged', 'withdrawn'
        )
      );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.class_ai_advisories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES public.assignments(id) ON DELETE CASCADE,
  assignment_title VARCHAR(255),
  mode VARCHAR(50) DEFAULT 'DEEP_TECHNICAL',
  submission_rate_text VARCHAR(100),
  avg_ai_transparency VARCHAR(100),
  common_error_clusters JSONB DEFAULT '[]'::jsonb,
  next_slot_recommendation TEXT,
  raw_payload JSONB,
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_class_assignment_advisory
    UNIQUE (class_id, assignment_id)
);

ALTER TABLE public.class_ai_advisories
  ADD COLUMN IF NOT EXISTS mode VARCHAR(50) DEFAULT 'DEEP_TECHNICAL';

CREATE INDEX IF NOT EXISTS idx_class_advisories_class_lookup
  ON public.class_ai_advisories(class_id, generated_at DESC);

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS notification_scope VARCHAR(20),
  ADD COLUMN IF NOT EXISTS school_id UUID
    REFERENCES public.schools(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND conname = 'notifications_scope_school_check'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_scope_school_check
      CHECK (
        notification_scope IS NULL
        OR (
          notification_scope = 'platform'
          AND school_id IS NULL
        )
        OR (
          notification_scope = 'school'
          AND school_id IS NOT NULL
        )
      );
  END IF;
END;
$$;

UPDATE public.notifications
SET notification_scope = 'platform'
WHERE notification_scope IS NULL
  AND school_id IS NULL
  AND type = 'system_announcement'
  AND related_entity_type IN ('admin_broadcast', 'admin_broadcast:all');

CREATE INDEX IF NOT EXISTS idx_notifications_school_user_created
  ON public.notifications(school_id, user_id, created_at DESC)
  WHERE notification_scope = 'school';

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

COMMIT;
