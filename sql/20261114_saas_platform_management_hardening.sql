-- Follow-up to 20261114_saas_platform_management.sql.
-- Run only after that migration, on a reviewed Neon development branch.
-- This migration is additive except that it makes schools.name nullable so a
-- manager can create the required blank tenant profile.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.schools') IS NULL
     OR to_regclass('public.school_settings') IS NULL
     OR to_regclass('public.school_subscriptions') IS NULL
     OR to_regclass('public.payment_transactions') IS NULL THEN
    RAISE EXCEPTION 'Platform hardening requires the prior SaaS platform migration';
  END IF;

  -- Stop before changing a legacy CHECK if the table already contains a
  -- lifecycle value the SaaS application cannot safely preserve.
  IF EXISTS (
    SELECT 1 FROM public.schools
    WHERE status NOT IN ('active', 'suspended', 'archived', 'pending_setup', 'locked')
  ) THEN
    RAISE EXCEPTION 'schools.status contains unsupported lifecycle values; review before migration';
  END IF;
END $$;

-- The legacy database only allowed active/suspended/archived. The SaaS flow
-- needs pending_setup before School Admin handover and locked for operations.
DO $$
DECLARE status_constraint TEXT;
BEGIN
  SELECT conname INTO status_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.schools'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%'
  LIMIT 1;

  IF status_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.schools DROP CONSTRAINT %I', status_constraint);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.schools'::regclass
      AND conname = 'schools_status_check'
  ) THEN
    ALTER TABLE public.schools
      ADD CONSTRAINT schools_status_check
      CHECK (status IN ('active', 'suspended', 'archived', 'pending_setup', 'locked'));
  END IF;
END $$;

ALTER TABLE public.schools
  ALTER COLUMN name DROP NOT NULL;

CREATE SEQUENCE IF NOT EXISTS public.school_code_sequence START WITH 1;

-- Move the sequence forward if legacy SCH-NNNN codes already exist.
SELECT setval(
  'public.school_code_sequence',
  GREATEST(
    COALESCE((SELECT MAX(NULLIF(regexp_replace(code, '^SCH-', ''), '')::bigint)
              FROM public.schools WHERE code ~ '^SCH-[0-9]+$'), 0),
    0
  ) + 1,
  FALSE
);

ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS website VARCHAR(500);

CREATE TABLE IF NOT EXISTS public.subscription_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  subscription_id UUID REFERENCES public.school_subscriptions(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL CHECK (action IN ('activated', 'renewed', 'expired', 'cancelled')),
  previous_end_date TIMESTAMPTZ,
  new_end_date TIMESTAMPTZ,
  payment_transaction_id UUID REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_history_school_created
  ON public.subscription_history (school_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS school_subscriptions_one_active_per_school
  ON public.school_subscriptions (school_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_provider_reference_unique
  ON public.payment_transactions (transaction_reference)
  WHERE transaction_reference IS NOT NULL;

-- Platform identities are operational accounts only. They may not be used as
-- school accounts, otherwise a Manager/Superadmin could accidentally cross the
-- platform-school authorization boundary.
CREATE OR REPLACE FUNCTION public.prevent_platform_school_account_overlap()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'platform_admins' THEN
    IF NEW.is_active = TRUE AND EXISTS (
      SELECT 1 FROM public.school_memberships
      WHERE user_id = NEW.user_id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'A platform account cannot have an active school membership';
    END IF;
  ELSIF TG_TABLE_NAME = 'school_memberships' THEN
    IF NEW.status = 'active' AND EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE user_id = NEW.user_id AND is_active = TRUE
    ) THEN
      RAISE EXCEPTION 'A school account cannot have an active platform role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS platform_admins_prevent_school_overlap ON public.platform_admins;
CREATE TRIGGER platform_admins_prevent_school_overlap
  BEFORE INSERT OR UPDATE OF user_id, is_active ON public.platform_admins
  FOR EACH ROW EXECUTE FUNCTION public.prevent_platform_school_account_overlap();

DROP TRIGGER IF EXISTS school_memberships_prevent_platform_overlap ON public.school_memberships;
CREATE TRIGGER school_memberships_prevent_platform_overlap
  BEFORE INSERT OR UPDATE OF user_id, status ON public.school_memberships
  FOR EACH ROW EXECUTE FUNCTION public.prevent_platform_school_account_overlap();

COMMIT;

-- Rollback: roll back application code first. Dropping subscription history or
-- payment uniqueness can discard protection and must be manually reviewed.
