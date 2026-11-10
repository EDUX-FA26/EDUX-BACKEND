-- Migration: Create class_ai_advisories table for AI Class Advisor Widget
CREATE TABLE IF NOT EXISTS class_ai_advisories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE,
    assignment_title VARCHAR(255),
    submission_rate_text VARCHAR(100),
    avg_ai_transparency VARCHAR(100),
    common_error_clusters JSONB DEFAULT '[]'::jsonb,
    next_slot_recommendation TEXT,
    raw_payload JSONB,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_class_assignment_advisory UNIQUE (class_id, assignment_id)
);

CREATE INDEX IF NOT EXISTS idx_class_advisories_class_lookup 
ON class_ai_advisories(class_id, generated_at DESC);

