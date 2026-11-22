-- Migration: Support atomic publish grade fields and status
-- Date: 2026-11-24

BEGIN;

-- 1. Thêm cột published_at và final_score vào bảng submissions nếu chưa có
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS final_score NUMERIC(5,2);

-- 2. Thêm cột graded_count vào bảng assignments nếu chưa có
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS graded_count INT DEFAULT 0;

-- 3. Cập nhật submissions_status_check hỗ trợ cả 'graded' và 'published'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'submissions'::regclass AND conname = 'submissions_status_check'
  ) THEN
    ALTER TABLE submissions DROP CONSTRAINT submissions_status_check;
  END IF;

  ALTER TABLE submissions ADD CONSTRAINT submissions_status_check 
    CHECK (status IN (
      'draft', 'pending', 'submitted', 'resubmitted', 'late', 
      'evaluated', 'reviewed', 'graded', 'published', 'flagged', 'withdrawn'
    ));
END $$;

-- 4. Đồng bộ dữ liệu hiện có từ bảng grades sang submissions
UPDATE submissions s
SET 
  final_score = COALESCE(s.final_score, g.score),
  published_at = COALESCE(s.published_at, g.graded_at, g.created_at),
  status = CASE WHEN s.status IN ('submitted', 'resubmitted', 'late', 'evaluated', 'reviewed') THEN 'graded' ELSE s.status END
FROM (
  SELECT submission_id, score, graded_at, created_at
  FROM (
    SELECT submission_id, score, graded_at, created_at,
           ROW_NUMBER() OVER(PARTITION BY submission_id ORDER BY created_at DESC) as rn
    FROM grades
  ) t WHERE rn = 1
) g
WHERE s.id = g.submission_id;

-- 5. Cập nhật graded_count cho assignments
UPDATE assignments a
SET graded_count = COALESCE(cnt.c, 0)
FROM (
  SELECT a2.id, COUNT(DISTINCT g.student_id)::int as c
  FROM assignments a2
  LEFT JOIN grades g ON g.assignment_id = a2.id
  GROUP BY a2.id
) cnt
WHERE a.id = cnt.id;

COMMIT;
