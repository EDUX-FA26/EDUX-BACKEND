-- Migration: Add school_id column to class_ai_advisories safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'class_ai_advisories' AND column_name = 'school_id'
  ) THEN
    IF to_regclass('public.schools') IS NOT NULL THEN
      ALTER TABLE public.class_ai_advisories 
        ADD COLUMN school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE;
    ELSE
      ALTER TABLE public.class_ai_advisories 
        ADD COLUMN school_id UUID;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'classes' AND column_name = 'school_id'
  ) THEN
    UPDATE public.class_ai_advisories caa
    SET school_id = c.school_id
    FROM public.classes c
    WHERE caa.class_id = c.id AND caa.school_id IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_class_advisories_school_class 
  ON public.class_ai_advisories(school_id, class_id, generated_at DESC);

