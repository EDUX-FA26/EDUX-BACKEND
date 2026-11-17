-- Migration: Allow 'deleted' status in public.schools constraint
ALTER TABLE public.schools DROP CONSTRAINT IF EXISTS schools_status_check;
ALTER TABLE public.schools ADD CONSTRAINT schools_status_check 
  CHECK (status IN ('active', 'suspended', 'archived', 'pending_setup', 'locked', 'deleted'));
