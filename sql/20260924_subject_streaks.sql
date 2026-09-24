-- Migration: Subject Streaks & Learning Activities
-- Table: subject_streaks
CREATE TABLE IF NOT EXISTS subject_streaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,

    current_streak INT DEFAULT 0,
    longest_streak INT DEFAULT 0,

    last_activity_date DATE,

    recovery_used INT DEFAULT 0,
    recovery_month DATE,

    is_active BOOLEAN DEFAULT TRUE,

    streak_lost_at TIMESTAMPTZ NULL,

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uk_user_subject UNIQUE (user_id, subject_id)
);

-- Table: subject_streak_activities
CREATE TABLE IF NOT EXISTS subject_streak_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,

    flashcard_deck_id UUID NULL REFERENCES flashcard_decks(id) ON DELETE SET NULL,

    activity_date DATE NOT NULL,

    activity_type VARCHAR(50) DEFAULT 'flashcard_deck_completed',

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uk_user_subject_date UNIQUE (user_id, subject_id, activity_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_streak_activities_user_date ON subject_streak_activities(user_id, activity_date);
CREATE INDEX IF NOT EXISTS idx_streak_activities_user_subject_date ON subject_streak_activities(user_id, subject_id, activity_date);
