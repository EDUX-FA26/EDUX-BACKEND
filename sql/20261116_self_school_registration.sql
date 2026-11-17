-- Self-service school registration. Apply after the SaaS platform migrations.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.schools') IS NULL
     OR to_regclass('public.subscription_plans') IS NULL
     OR to_regclass('public.payment_transactions') IS NULL
     OR to_regclass('public.school_subscriptions') IS NULL
     OR to_regclass('public.subscription_history') IS NULL
     OR to_regclass('public.school_memberships') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.user_profiles') IS NULL THEN
    RAISE EXCEPTION 'Self registration requires the reviewed SaaS platform and identity migrations';
  END IF;
END $$;

CREATE SEQUENCE IF NOT EXISTS public.school_code_sequence START WITH 1;

-- Keep the acquisition channel on the tenant itself so Platform users can
-- distinguish a public registration from a tenant handed over by a Manager.
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS provisioning_source VARCHAR(30) NOT NULL DEFAULT 'legacy';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'schools_provisioning_source_check'
      AND conrelid = 'public.schools'::regclass
  ) THEN
    ALTER TABLE public.schools
      ADD CONSTRAINT schools_provisioning_source_check
      CHECK (provisioning_source IN ('legacy', 'self_registered', 'manager_created'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.school_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL UNIQUE REFERENCES public.schools(id) ON DELETE RESTRICT,
  admin_email VARCHAR(255) NOT NULL,
  plan_id VARCHAR(50) NOT NULL REFERENCES public.subscription_plans(id),
  billing_cycle VARCHAR(20) NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  price_snapshot NUMERIC(15, 2) NOT NULL CHECK (price_snapshot >= 0),
  payment_transaction_id UUID UNIQUE REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  admin_user_id UUID UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
  source VARCHAR(30) NOT NULL DEFAULT 'self_registered' CHECK (source IN ('self_registered', 'manager_created')),
  status VARCHAR(30) NOT NULL DEFAULT 'pending_email_verification' CHECK (status IN ('pending_email_verification', 'pending_payment', 'processing', 'paid', 'expired', 'cancelled')),
  terms_version VARCHAR(50) NOT NULL,
  terms_accepted_at TIMESTAMPTZ NOT NULL,
  tracking_token_hash VARCHAR(64) NOT NULL UNIQUE,
  email_verification_token_hash VARCHAR(64) UNIQUE,
  email_verification_expires_at TIMESTAMPTZ,
  email_verified_at TIMESTAMPTZ,
  verification_email_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (verification_email_status IN ('pending', 'sent', 'failed')),
  verification_email_error TEXT,
  verification_email_sent_at TIMESTAMPTZ,
  activation_token_hash VARCHAR(64) UNIQUE,
  activation_expires_at TIMESTAMPTZ,
  activation_used_at TIMESTAMPTZ,
  activation_email_status VARCHAR(20) NOT NULL DEFAULT 'not_required' CHECK (activation_email_status IN ('not_required', 'pending', 'sent', 'failed')),
  activation_email_error TEXT,
  activation_email_sent_at TIMESTAMPTZ,
  provisioning_status VARCHAR(30) NOT NULL DEFAULT 'not_started' CHECK (provisioning_status IN ('not_started', 'activation_pending', 'manual_review', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_school_registrations_email_status
  ON public.school_registrations (admin_email, status);

-- Application-level validation gives a helpful message, while this unique
-- index closes the race if the registration button is submitted concurrently.
CREATE UNIQUE INDEX IF NOT EXISTS school_registrations_one_open_email
  ON public.school_registrations (LOWER(admin_email))
  WHERE status IN ('pending_email_verification', 'pending_payment', 'processing', 'paid');

COMMIT;
