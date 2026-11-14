-- ============================================================================
-- EDUX Multi-Tenant SaaS Platform Migration
-- File: sql/20261114_saas_platform_management.sql
-- Description: DDL schema for Platform Admins (Superadmin, Manager),
--              Subscription Plans, School Subscriptions, VNPay Transactions,
--              School Onboarding Invitations, Platform Audit Logs, and School Settings.
-- ============================================================================

-- 1. PLATFORM ADMINS (Superadmin, Manager)
CREATE TABLE IF NOT EXISTS public.platform_admins (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'manager' CHECK (role IN ('superadmin', 'manager')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    granted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure index on platform_admins
CREATE INDEX IF NOT EXISTS idx_platform_admins_role ON public.platform_admins(role) WHERE is_active = TRUE;

-- 2. SCHOOLS EXTENSION (Vòng đời trường & Onboarding)
ALTER TABLE public.schools 
    ADD COLUMN IF NOT EXISTS setup_completed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lock_reason TEXT,
    ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Index for status filtering and soft delete
CREATE INDEX IF NOT EXISTS idx_schools_status ON public.schools(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_schools_deleted_at ON public.schools(deleted_at);

-- 3. SCHOOL SETTINGS (Cấu hình thương hiệu & giao diện trường)
CREATE TABLE IF NOT EXISTS public.school_settings (
    school_id UUID PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
    display_name VARCHAR(255),
    logo_url TEXT,
    primary_color VARCHAR(50) DEFAULT '#f97316',
    timezone VARCHAR(100) DEFAULT 'Asia/Ho_Chi_Minh',
    locale VARCHAR(20) DEFAULT 'vi-VN',
    feature_flags JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. SUBSCRIPTION PLANS (Gói thuê dịch vụ)
CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price_monthly NUMERIC(15, 2) NOT NULL DEFAULT 0,
    price_yearly NUMERIC(15, 2) NOT NULL DEFAULT 0,
    student_limit INT NOT NULL DEFAULT 500,
    storage_limit_gb INT NOT NULL DEFAULT 20,
    ai_requests_limit INT NOT NULL DEFAULT 1000,
    features JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default plans seed if empty
INSERT INTO public.subscription_plans (id, name, description, price_monthly, price_yearly, student_limit, storage_limit_gb, ai_requests_limit, features)
VALUES 
    ('basic', 'Gói Cơ Bản (Basic)', 'Phù hợp cho trung tâm hoặc trường quy mô nhỏ dưới 500 sinh viên.', 2000000.00, 20000000.00, 500, 20, 1000, '{"custom_domain": false, "priority_support": false, "ai_features": true}'::jsonb),
    ('standard', 'Gói Tiêu Chuẩn (Standard)', 'Phù hợp cho các trường đại học, cao đẳng quy mô vừa (tới 2,000 sinh viên).', 5000000.00, 50000000.00, 2000, 100, 5000, '{"custom_domain": true, "priority_support": true, "ai_features": true}'::jsonb),
    ('premium', 'Gói Nâng Cao (Premium)', 'Dành cho các trường đại học quy mô lớn (tới 10,000 sinh viên), hỗ trợ chuyên biệt.', 10000000.00, 100000000.00, 10000, 500, 20000, '{"custom_domain": true, "priority_support": true, "ai_features": true, "unlimited_storage": false}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 5. SCHOOL SUBSCRIPTIONS (Hợp đồng thuê của trường)
CREATE TABLE IF NOT EXISTS public.school_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL REFERENCES public.subscription_plans(id),
    billing_cycle VARCHAR(20) NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
    price_snapshot NUMERIC(15, 2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'pending', 'cancelled')),
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_school_subscriptions_school ON public.school_subscriptions(school_id, status);

-- 6. PAYMENT TRANSACTIONS (Lịch sử thanh toán VNPay)
CREATE TABLE IF NOT EXISTS public.payment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES public.school_subscriptions(id) ON DELETE SET NULL,
    plan_id VARCHAR(50) REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
    amount NUMERIC(15, 2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL DEFAULT 'vnpay',
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
    order_reference VARCHAR(100) NOT NULL UNIQUE,
    transaction_reference VARCHAR(100),
    vnp_pay_date VARCHAR(50),
    vnp_bank_code VARCHAR(50),
    vnp_response_code VARCHAR(50),
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_tx_school ON public.payment_transactions(school_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_order_ref ON public.payment_transactions(order_reference);

-- 7. SCHOOL INVITATIONS (Bàn giao quyền School Admin)
CREATE TABLE IF NOT EXISTS public.school_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    recipient_email VARCHAR(255) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
    invited_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_school_invitations_token ON public.school_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_school_invitations_email ON public.school_invitations(recipient_email);

-- 8. PLATFORM AUDIT LOGS (Nhật ký hành động SaaS)
CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    actor_role VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(100),
    target_id VARCHAR(100),
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON public.platform_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_actor ON public.platform_audit_logs(actor_id);
