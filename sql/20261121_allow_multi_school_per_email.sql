-- Migration: Allow one email to register and manage multiple schools
-- Date: 2026-11-21

-- 1. Drop unique constraint on admin_user_id in school_registrations
ALTER TABLE public.school_registrations DROP CONSTRAINT IF EXISTS school_registrations_admin_user_id_key;

CREATE INDEX IF NOT EXISTS idx_school_registrations_admin_user_id 
ON public.school_registrations (admin_user_id);

-- 2. Drop the old partial unique index that blocked paid emails from registering new schools
DROP INDEX IF EXISTS public.school_registrations_one_open_email;

-- 3. Re-create index to only prevent multiple simultaneous unpaid/pending registrations
CREATE UNIQUE INDEX IF NOT EXISTS school_registrations_one_open_email 
ON public.school_registrations (lower(admin_email)) 
WHERE status IN ('pending_email_verification', 'pending_payment', 'processing');
