-- Makes platform accounts first-class identities while preserving all LMS roles.
-- Run after the SaaS platform migration on the reviewed Neon development branch.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.users') IS NULL OR to_regclass('public.platform_admins') IS NULL THEN
    RAISE EXCEPTION 'Platform identity migration requires users and platform_admins';
  END IF;
END $$;

-- 1. Drop existing role constraint first so platform roles can be set
DO $$
DECLARE role_constraint TEXT;
BEGIN
  SELECT conname INTO role_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.users'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%'
  LIMIT 1;

  IF role_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', role_constraint);
  END IF;
END $$;

-- 2. Existing platform accounts become their real business role. Existing School
-- Admin/Lecturer/Student users retain their legacy LMS role unchanged.
UPDATE public.users u
SET role = pa.role,
    updated_at = NOW()
FROM public.platform_admins pa
WHERE pa.user_id = u.id
  AND pa.is_active = TRUE
  AND u.role IS DISTINCT FROM pa.role;

-- 3. Add updated constraint supporting all 5 roles
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('student', 'lecturer', 'admin', 'superadmin', 'manager'));

COMMIT;
