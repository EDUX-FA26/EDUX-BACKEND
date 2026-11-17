-- Migration: 20261122_payment_refunds.sql
-- Additive migration for refund management and payout tracking.

BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_transaction_id UUID NOT NULL REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'requested' CHECK (
        status IN ('requested', 'approved', 'rejected', 'processing', 'succeeded', 'failed', 'manual_review')
    ),
    requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    rejection_reason TEXT,
    bank_name VARCHAR(100),
    bank_account_number VARCHAR(100),
    bank_account_name VARCHAR(255),
    payout_reference VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_school ON public.payment_refunds(school_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_tx ON public.payment_refunds(payment_transaction_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_status ON public.payment_refunds(status);

-- Add refunded_amount to payment_transactions if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payment_transactions'
          AND column_name = 'refunded_amount'
    ) THEN
        ALTER TABLE public.payment_transactions
        ADD COLUMN refunded_amount NUMERIC(15, 2) NOT NULL DEFAULT 0;
    END IF;
END $$;

COMMIT;
