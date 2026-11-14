-- Migration: Tạo bảng assignment_rubric_configs lưu cấu hình tiêu chí Rubric đánh giá bài tập
-- Hỗ trợ phân hệ Assignment & AI Evaluation, tích hợp sẵn school_id cho Multi-Tenant

CREATE TABLE IF NOT EXISTS assignment_rubric_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  criterion_key VARCHAR(64) NOT NULL,
  criterion_name VARCHAR(255) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  weight_percent INTEGER NOT NULL DEFAULT 0 CHECK (weight_percent >= 0 AND weight_percent <= 100),
  display_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_assignment_criterion UNIQUE(assignment_id, criterion_key)
);

CREATE INDEX IF NOT EXISTS idx_assignment_rubric_configs_assignment_id 
ON assignment_rubric_configs(assignment_id, display_order ASC);

CREATE INDEX IF NOT EXISTS idx_assignment_rubric_configs_school_id 
ON assignment_rubric_configs(school_id);

