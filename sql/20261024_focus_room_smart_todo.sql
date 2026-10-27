-- Migration: Focus Room + Smart Todo
-- Chạy:  node src/scripts/migrate.js sql/20261024_focus_room_smart_todo.sql
BEGIN;

-- ─────────────────────────────────────────────
-- 1. Smart Todo
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS todos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    title VARCHAR(200) NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',

    status VARCHAR(20) NOT NULL DEFAULT 'TODO'
        CHECK (status IN ('TODO', 'IN_PROGRESS', 'COMPLETED')),
    priority VARCHAR(10) NOT NULL DEFAULT 'MEDIUM'
        CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),

    due_date DATE NULL,
    completed_at TIMESTAMPTZ NULL,

    -- Nguồn tạo: thủ công / AI đề xuất / Study Planner
    source_type VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
        CHECK (source_type IN ('MANUAL', 'AI_SUGGESTED', 'STUDY_PLANNER')),

    -- Chỉ THAM CHIẾU tới dữ liệu có sẵn, không sao chép
    subject_id UUID NULL REFERENCES subjects(id) ON DELETE SET NULL,
    topic_id UUID NULL REFERENCES topics(id) ON DELETE SET NULL,
    flashcard_deck_id UUID NULL REFERENCES flashcard_decks(id) ON DELETE SET NULL,
    study_plan_day_id UUID NULL REFERENCES study_plan_days(id) ON DELETE SET NULL,

    -- Khóa chống trùng (chuẩn hóa ở tầng service)
    dedupe_key TEXT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
);

-- Mỗi user chỉ có 1 Todo CHƯA hoàn thành cho cùng dedupe_key
CREATE UNIQUE INDEX IF NOT EXISTS uq_todos_user_dedupe_open
ON todos(user_id, dedupe_key)
WHERE dedupe_key IS NOT NULL AND status <> 'COMPLETED';

CREATE INDEX IF NOT EXISTS idx_todos_user_status
ON todos(user_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_todos_user_plan_day
ON todos(user_id, study_plan_day_id)
WHERE study_plan_day_id IS NOT NULL;

-- ─────────────────────────────────────────────
-- 2. Focus Session
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS focus_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    todo_id UUID NULL REFERENCES todos(id) ON DELETE SET NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS'
        CHECK (status IN ('IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED')),

    -- Pha Pomodoro hiện tại
    phase VARCHAR(20) NOT NULL DEFAULT 'FOCUS'
        CHECK (phase IN ('FOCUS', 'SHORT_BREAK', 'LONG_BREAK')),
    phase_seq INTEGER NOT NULL DEFAULT 1,

    -- Thời gian của pha hiện tại = phase_elapsed_ms đã chốt
    --   + (NOW() - phase_resumed_at) nếu đang chạy.
    -- Server là nguồn sự thật, KHÔNG phụ thuộc setInterval của client.
    phase_elapsed_ms BIGINT NOT NULL DEFAULT 0 CHECK (phase_elapsed_ms >= 0),
    phase_resumed_at TIMESTAMPTZ NULL,

    -- Cấu hình Pomodoro được chốt tại thời điểm bắt đầu phiên
    focus_minutes INTEGER NOT NULL DEFAULT 25 CHECK (focus_minutes BETWEEN 1 AND 180),
    short_break_minutes INTEGER NOT NULL DEFAULT 5 CHECK (short_break_minutes BETWEEN 1 AND 60),
    long_break_minutes INTEGER NOT NULL DEFAULT 15 CHECK (long_break_minutes BETWEEN 1 AND 120),
    long_break_every INTEGER NOT NULL DEFAULT 4 CHECK (long_break_every BETWEEN 2 AND 12),

    -- Kết quả thực tế
    completed_pomodoros INTEGER NOT NULL DEFAULT 0 CHECK (completed_pomodoros >= 0),
    -- Tổng thời gian tập trung THỰC TẾ (ms), chỉ cộng dồn ở pha FOCUS
    focus_ms BIGINT NOT NULL DEFAULT 0 CHECK (focus_ms >= 0),

    note TEXT NOT NULL DEFAULT '',

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- IN_PROGRESS <=> đang có đồng hồ chạy
    CHECK (
        (status = 'IN_PROGRESS' AND phase_resumed_at IS NOT NULL)
        OR (status <> 'IN_PROGRESS' AND phase_resumed_at IS NULL)
    ),
    CHECK ((status IN ('COMPLETED', 'CANCELLED')) = (ended_at IS NOT NULL))
);

-- Mỗi user chỉ có tối đa 1 phiên đang hoạt động (chặn race condition ở mức DB)
CREATE UNIQUE INDEX IF NOT EXISTS uq_focus_sessions_one_active
ON focus_sessions(user_id)
WHERE status IN ('IN_PROGRESS', 'PAUSED');

CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_started
ON focus_sessions(user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_ended
ON focus_sessions(user_id, ended_at DESC)
WHERE ended_at IS NOT NULL;

-- ─────────────────────────────────────────────
-- 3. Cấu hình Focus Room
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS focus_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    background_id VARCHAR(40) NOT NULL DEFAULT 'cottage',
    master_volume NUMERIC(3,2) NOT NULL DEFAULT 0.8
        CHECK (master_volume BETWEEN 0 AND 1),
    -- [{ "id": "rain", "enabled": true, "volume": 0.5 }, ...]
    sounds JSONB NOT NULL DEFAULT '[]'::jsonb,

    focus_minutes INTEGER NOT NULL DEFAULT 25 CHECK (focus_minutes BETWEEN 1 AND 180),
    short_break_minutes INTEGER NOT NULL DEFAULT 5 CHECK (short_break_minutes BETWEEN 1 AND 60),
    long_break_minutes INTEGER NOT NULL DEFAULT 15 CHECK (long_break_minutes BETWEEN 1 AND 120),
    long_break_every INTEGER NOT NULL DEFAULT 4 CHECK (long_break_every BETWEEN 2 AND 12),
    auto_start_next BOOLEAN NOT NULL DEFAULT FALSE,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
