
BEGIN;

-- Một lần nộp bài cho mỗi ngày học
CREATE TABLE IF NOT EXISTS study_plan_day_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    plan_day_id UUID NOT NULL
        REFERENCES study_plan_days(id) ON DELETE CASCADE,

    student_id UUID NOT NULL
        REFERENCES users(id),

    total_questions INTEGER NOT NULL
        CHECK (total_questions > 0),

    correct_answers INTEGER NOT NULL
        CHECK (correct_answers >= 0),

    score_percent NUMERIC(5,2) NOT NULL
        CHECK (score_percent BETWEEN 0 AND 100),

    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_study_score
        CHECK (correct_answers <= total_questions),

    UNIQUE (plan_day_id)
);

-- Chi tiết câu trả lời của sinh viên
CREATE TABLE IF NOT EXISTS study_plan_day_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    submission_id UUID NOT NULL
        REFERENCES study_plan_day_submissions(id)
        ON DELETE CASCADE,

    question_id UUID NOT NULL
        REFERENCES study_plan_questions(id),

    selected_answer VARCHAR(10) NOT NULL,

    is_correct BOOLEAN NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (submission_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_study_submissions_student
ON study_plan_day_submissions(student_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_study_answers_submission
ON study_plan_day_answers(submission_id);

COMMIT;


