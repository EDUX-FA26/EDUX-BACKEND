BEGIN;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Departments Table (Khoa / Bộ môn - Đã loại bỏ subject_head_id)
CREATE TABLE IF NOT EXISTS departments (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
code VARCHAR(100) UNIQUE NOT NULL,
name VARCHAR(255) NOT NULL,
is_active BOOLEAN DEFAULT TRUE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users Table (Người dùng cốt lõi: Giảm bớt tải, loại bỏ profile JSONB và role subject_head)
CREATE TABLE IF NOT EXISTS users (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
email VARCHAR(255) UNIQUE NOT NULL,
username VARCHAR(255) UNIQUE,
password_hash VARCHAR(255) NOT NULL,
role VARCHAR(50) NOT NULL CHECK (role IN ('student', 'lecturer', 'admin')),

    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP

);

-- 3. User Profiles Table (Bảng thông tin chi tiết / profile tách rời của người dùng)
CREATE TABLE IF NOT EXISTS user_profiles (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
avatar_url TEXT DEFAULT '',
full_name VARCHAR(255) NOT NULL,
student_code VARCHAR(100) UNIQUE,
department_id UUID REFERENCES departments(id) ON DELETE SET NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP

);

-- 4. Semesters Table (Học kỳ)
CREATE TABLE IF NOT EXISTS semesters (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
code VARCHAR(100) UNIQUE NOT NULL,
name VARCHAR(255) NOT NULL,
academic_year VARCHAR(100) NOT NULL,
start_date TIMESTAMP WITH TIME ZONE NOT NULL,
end_date TIMESTAMP WITH TIME ZONE NOT NULL,
is_current BOOLEAN DEFAULT FALSE,
is_active BOOLEAN DEFAULT TRUE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Subjects Table (Môn học)
CREATE TABLE IF NOT EXISTS subjects (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
code VARCHAR(100) UNIQUE NOT NULL,
name VARCHAR(255) NOT NULL,
description TEXT DEFAULT '',
department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
credits INT DEFAULT 0 CHECK (credits >= 0),
is_active BOOLEAN DEFAULT TRUE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Classes Table (Lớp học phần)
CREATE TABLE IF NOT EXISTS classes (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
class_code VARCHAR(100) NOT NULL,
semester_id UUID NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
lecturer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
max_students INT DEFAULT 0 CHECK (max_students >= 0),
is_active BOOLEAN DEFAULT TRUE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT uk_class_code_semester_subject UNIQUE (class_code, semester_id, subject_id)
);

-- 7. Class Members Table (Thành viên lớp học / Danh sách sinh viên)
CREATE TABLE IF NOT EXISTS class_members (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'dropped', 'completed')),
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT uk_class_student UNIQUE (class_id, student_id)
);

CREATE TABLE IF NOT EXISTS class_materials (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
class_id UUID NOT NULL
REFERENCES classes(id) ON DELETE CASCADE,
title VARCHAR(255) NOT NULL,
description TEXT DEFAULT '',
file_name VARCHAR(255) NOT NULL,
file_key TEXT NOT NULL,
file_type VARCHAR(100),
file_size BIGINT,
is_private BOOLEAN DEFAULT TRUE,
uploaded_by UUID NOT NULL
REFERENCES users(id) ON DELETE CASCADE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Sessions Table (Buổi học / Slot học)
CREATE TABLE IF NOT EXISTS sessions (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
title VARCHAR(255) NOT NULL,
noteTEXT DEFAULT '',
session_no INT NOT NULL CHECK (session_no >= 1),
learning_date TIMESTAMP WITH TIME ZONE,
is_published BOOLEAN DEFAULT TRUE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT uk_class_session_no UNIQUE (class_id, session_no)
);

-- 9. Assignments Table (Bài tập / Grade Item)
CREATE TABLE IF NOT EXISTS assignments (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
uuid VARCHAR(255) UNIQUE NOT NULL,
class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
title VARCHAR(255) NOT NULL,
description TEXT DEFAULT '',
instructions TEXT DEFAULT '',
deadline TIMESTAMP WITH TIME ZONE NOT NULL,
max_score NUMERIC(5,2) DEFAULT 10 CHECK (max_score >= 0),
weight NUMERIC(5,2) DEFAULT 0 CHECK (weight >= 0 AND weight <= 100),
ai_declaration_required BOOLEAN DEFAULT TRUE,
min_ai_interactions INT DEFAULT 1 CHECK (min_ai_interactions >= 0),
max_ai_interactions INT DEFAULT 20 CHECK (max_ai_interactions >= 0),
allow_late_submission BOOLEAN DEFAULT TRUE,
publish_status VARCHAR(50) DEFAULT 'draft' CHECK (publish_status IN ('draft', 'published', 'closed')),
published_at TIMESTAMP WITH TIME ZONE,
created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignment_materials (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    assignment_id UUID NOT NULL
        REFERENCES assignments(id) ON DELETE CASCADE,
    description TEXT DEFAULT '',
    file_name VARCHAR(255) NOT NULL,
    file_key TEXT NOT NULL,
    file_type VARCHAR(100),
    file_size BIGINT,
    uploaded_by UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP

);

-- 10. Submissions Table (Bài nộp của sinh viên)
CREATE TABLE IF NOT EXISTS submissions (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
uuid VARCHAR(255) UNIQUE NOT NULL,
assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
latest_version_no INT DEFAULT 1 CHECK (latest_version_no >= 1),
status VARCHAR(50) DEFAULT 'submitted' CHECK (status IN ('pending', 'submitted', 'resubmitted', 'late', 'evaluated', 'reviewed', 'graded', 'flagged', 'withdrawn')),
submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
last_submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT uk_assignment_student UNIQUE (assignment_id, student_id)
);

-- 11. Submission Versions Table (Các phiên bản nộp bài)
CREATE TABLE IF NOT EXISTS submission_versions (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
version_no INT NOT NULL CHECK (version_no >= 1),
files JSONB NOT NULL DEFAULT '[]'::jsonb,
content_hash VARCHAR(255),
note TEXT DEFAULT '',
submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
is_latest BOOLEAN DEFAULT TRUE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT uk_submission_version UNIQUE (submission_id, version_no)
);

-- 12. AI Interactions Table (Khai báo tương tác AI của sinh viên)
CREATE TABLE IF NOT EXISTS ai_interactions (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
uuid VARCHAR(255) UNIQUE NOT NULL,
submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
submission_version_id UUID NOT NULL REFERENCES submission_versions(id) ON DELETE CASCADE,
assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
ai_tool VARCHAR(100) NOT NULL CHECK (ai_tool IN ('chatgpt', 'gemini', 'claude', 'copilot', 'other')),
usage_purpose VARCHAR(100) NOT NULL CHECK (usage_purpose IN ('brainstorming', 'topic_research', 'summarization', 'writing_improvement', 'critical_feedback', 'methodology_review', 'data_analysis', 'other')),
prompt_content TEXT NOT NULL,
ai_response_summary TEXT NOT NULL,
student_decision VARCHAR(50) NOT NULL CHECK (student_decision IN ('accepted', 'partially_accepted', 'rejected', 'reference_only')),
reflection_text TEXT NOT NULL,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
