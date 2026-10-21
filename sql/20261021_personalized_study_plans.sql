
BEGIN;

-- 1. Kế hoạch học riêng của từng sinh viên
CREATE TABLE IF NOT EXISTS study_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id UUID NOT NULL REFERENCES users(id),
    subject_id UUID NOT NULL REFERENCES subjects(id),

    starts_on DATE NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (
            status IN (
                'draft',
                'generating',
                'ready',
                'completed',
                'failed'
            )
        ),

    analytics_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (student_id, subject_id, starts_on)
);

-- 2. Lịch học của từng ngày
CREATE TABLE IF NOT EXISTS study_plan_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    plan_id UUID NOT NULL
        REFERENCES study_plans(id) ON DELETE CASCADE,

    day_number INTEGER NOT NULL
        CHECK (day_number BETWEEN 1 AND 7),

    topic_id UUID NOT NULL REFERENCES topics(id),

    activity VARCHAR(20) NOT NULL
        CHECK (
            activity IN (
                'review',
                'diagnostic',
                'practice'
            )
        ),

    duration_minutes INTEGER NOT NULL
        CHECK (duration_minutes > 0),

    target_questions INTEGER NOT NULL
        CHECK (target_questions BETWEEN 1 AND 20),

    reason TEXT NOT NULL DEFAULT '',

    content_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (
            content_status IN (
                'pending',
                'ready',
                'unavailable',
                'failed'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (plan_id, day_number)
);

-- 3. Câu hỏi ôn tập AI riêng theo từng ngày
CREATE TABLE IF NOT EXISTS study_plan_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    plan_day_id UUID NOT NULL
        REFERENCES study_plan_days(id) ON DELETE CASCADE,

    source_flashcard_id UUID
        REFERENCES flashcards(id),

    question_order INTEGER NOT NULL
        CHECK (question_order > 0),

    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',

    options JSONB NOT NULL DEFAULT '[]'::jsonb,

    type VARCHAR(50) NOT NULL DEFAULT 'multiple_choice',
    difficulty VARCHAR(50) NOT NULL DEFAULT 'medium',

    generation_source VARCHAR(20) NOT NULL DEFAULT 'ai'
        CHECK (generation_source IN ('ai', 'existing')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (length(trim(question)) > 0),
    CHECK (length(trim(answer)) > 0),

    UNIQUE (plan_day_id, question_order)
);

CREATE INDEX IF NOT EXISTS idx_study_plans_student
ON study_plans(student_id, subject_id, starts_on DESC);

CREATE INDEX IF NOT EXISTS idx_study_plan_days_plan
ON study_plan_days(plan_id);

CREATE INDEX IF NOT EXISTS idx_study_plan_questions_day
ON study_plan_questions(plan_day_id);

COMMIT;
