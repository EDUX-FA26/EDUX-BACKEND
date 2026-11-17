-- Migration: Add must_change_password and password_changed_at for initial temporary password flow
ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
