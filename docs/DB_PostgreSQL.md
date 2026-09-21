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

-- 13. AI Evaluations Table (Đánh giá mức độ minh bạch AI)
CREATE TABLE IF NOT EXISTS ai_evaluations (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
submission_version_id UUID UNIQUE NOT NULL REFERENCES submission_versions(id) ON DELETE CASCADE,
assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
pattern VARCHAR(100) NOT NULL CHECK (pattern IN ('critical_engagement', 'collaborative_usage', 'passive_usage', 'high_dependency')),
risk_level VARCHAR(50) DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
transparency_score NUMERIC(5,2) DEFAULT 0 CHECK (transparency_score BETWEEN 0 AND 100),
prompt_quality_score NUMERIC(5,2) DEFAULT 0 CHECK (prompt_quality_score BETWEEN 0 AND 100),
reflection_quality_score NUMERIC(5,2) DEFAULT 0 CHECK (reflection_quality_score BETWEEN 0 AND 100),
critical_thinking_score NUMERIC(5,2) DEFAULT 0 CHECK (critical_thinking_score BETWEEN 0 AND 100),
ai_dependency_score NUMERIC(5,2) DEFAULT 0 CHECK (ai_dependency_score BETWEEN 0 AND 100),
summary TEXT DEFAULT '',
evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 14. Submission Flags Table (Cờ cảnh báo hành vi AI bất thường - Đã loại bỏ subject_head)
CREATE TABLE IF NOT EXISTS submission_flags (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
submission_version_id UUID REFERENCES submission_versions(id) ON DELETE SET NULL,
assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
flag_type VARCHAR(100) NOT NULL CHECK (flag_type IN ('low_quality_prompt', 'high_ai_dependency', 'weak_reflection', 'all_responses_accepted', 'missing_ai_interactions', 'suspicious_declaration', 'manual')),
description TEXT DEFAULT '',
flagged_by VARCHAR(50) NOT NULL CHECK (flagged_by IN ('system', 'lecturer')),
flagged_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
suspect_level VARCHAR(50) DEFAULT 'low' CHECK (suspect_level IN ('low', 'medium', 'high')),
status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'resolved', 'dismissed')),
resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
resolved_at TIMESTAMP WITH TIME ZONE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 15. Submission Reviews Table (Giảng viên review bài nộp)
CREATE TABLE IF NOT EXISTS submission_reviews (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
submission_version_id UUID REFERENCES submission_versions(id) ON DELETE SET NULL,
lecturer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
review_status VARCHAR(50) DEFAULT 'pending' CHECK (review_status IN ('pending', 'reviewed', 'needs_revision', 'flagged')),
comment TEXT DEFAULT '',
reviewed_at TIMESTAMP WITH TIME ZONE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 16. Grades Table (Điểm số học thuật)
CREATE TABLE IF NOT EXISTS grades (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
submission_id UUID UNIQUE NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
score NUMERIC(5,2) NOT NULL CHECK (score >= 0),
max_score NUMERIC(5,2) DEFAULT 10 CHECK (max_score >= 0),
feedback TEXT DEFAULT '',
graded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
graded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT uk_grade_assignment_student UNIQUE (assignment_id, student_id)
);

-- 17. Final Results Table (Điểm tổng kết môn)
CREATE TABLE IF NOT EXISTS final_results (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
semester_id UUID NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
final_score NUMERIC(5,2) NOT NULL CHECK (final_score BETWEEN 0 AND 10),
classification VARCHAR(50) NOT NULL CHECK (classification IN ('poor', 'average', 'good', 'very_good', 'excellent')),
calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT uk_final_result_student_class UNIQUE (student_id, class_id)
);

-- 18. Notifications Table (Thông báo hệ thống)
CREATE TABLE IF NOT EXISTS notifications (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
title VARCHAR(255) NOT NULL,
message TEXT NOT NULL,
type VARCHAR(100) NOT NULL CHECK (type IN ('assignment_created', 'assignment_updated', 'deadline_reminder', 'submission_success', 'submission_reviewed', 'flag_created', 'grade_published', 'final_result_released', 'chat_message', 'system_announcement')),
related_entity_type VARCHAR(100),
related_entity_id UUID,
is_read BOOLEAN DEFAULT FALSE,
read_at TIMESTAMP WITH TIME ZONE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 19. Email Logs Table (Lịch sử gửi email)
CREATE TABLE IF NOT EXISTS email_logs (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
to_email VARCHAR(255) NOT NULL,
subject VARCHAR(255) NOT NULL,
body TEXT NOT NULL,
type VARCHAR(100) NOT NULL CHECK (type IN ('assignment_created', 'deadline_reminder', 'submission_success', 'grade_published', 'password_reset', 'system')),
status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
error_message TEXT DEFAULT '',
sent_at TIMESTAMP WITH TIME ZONE,
related_entity_type VARCHAR(100),
related_entity_id UUID,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 20. Chat Rooms Table (Phòng chat realtime - Đã loại bỏ các type liên quan subject_head)
CREATE TABLE IF NOT EXISTS chat_rooms (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
type VARCHAR(100) NOT NULL CHECK (type IN ('student_lecturer', 'student_student', 'group')),
name VARCHAR(255) DEFAULT '',
class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
semester_id UUID REFERENCES semesters(id) ON DELETE SET NULL,
created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
last_message_at TIMESTAMP WITH TIME ZONE,
is_active BOOLEAN DEFAULT TRUE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 21. Chat Members Table (Thành viên phòng chat - Đã loại bỏ subject_head)
CREATE TABLE IF NOT EXISTS chat_members (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
role_at_room VARCHAR(50) NOT NULL CHECK (role_at_room IN ('student', 'lecturer', 'admin')),
joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
last_read_at TIMESTAMP WITH TIME ZONE,
is_muted BOOLEAN DEFAULT FALSE,
is_active BOOLEAN DEFAULT TRUE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT uk_chat_room_user UNIQUE (room_id, user_id)
);

-- 22. Chat Messages Table (Tin nhắn chat)
CREATE TABLE IF NOT EXISTS chat_messages (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
message_type VARCHAR(50) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file')),
content TEXT DEFAULT '',
attachments JSONB DEFAULT '[]'::jsonb,
is_deleted BOOLEAN DEFAULT FALSE,
deleted_at TIMESTAMP WITH TIME ZONE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 23. Refresh Tokens Table (Xác thực JWT Refresh Token)
CREATE TABLE IF NOT EXISTS refresh_tokens (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
token_hash VARCHAR(255) UNIQUE NOT NULL,
expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
revoked_at TIMESTAMP WITH TIME ZONE,
user_agent TEXT DEFAULT '',
ip_address VARCHAR(100) DEFAULT '',
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 24. Password Reset Tokens Table (Token đổi mật khẩu)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
token_hash VARCHAR(255) UNIQUE NOT NULL,
expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
used_at TIMESTAMP WITH TIME ZONE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 25. News Table (Bảng tin / Thông báo chung)
CREATE TABLE IF NOT EXISTS news (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
uuid VARCHAR(255) UNIQUE NOT NULL,
title VARCHAR(255) NOT NULL,
content TEXT NOT NULL,
cover_image_url TEXT,
author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
target_role VARCHAR(50) DEFAULT 'LECTURER_ONLY' CHECK (target_role IN ('LECTURER_ONLY', 'ALL')),
is_published BOOLEAN DEFAULT TRUE,
published_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 26. Tests Table (Định nghĩa bài kiểm tra / Quiz)
CREATE TABLE IF NOT EXISTS tests (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
uuid VARCHAR(255) UNIQUE NOT NULL,
parent_test_id UUID REFERENCES tests(id) ON DELETE SET NULL,
class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
title VARCHAR(255) NOT NULL,
description TEXT DEFAULT '',
duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
show_results_to_students BOOLEAN DEFAULT TRUE,
is_active BOOLEAN DEFAULT TRUE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 27. Test Questions Table
CREATE TABLE IF NOT EXISTS test_questions (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
type VARCHAR(50) NOT NULL CHECK (type IN ('MULTIPLE_CHOICE', 'CHECKBOX', 'TRUE_FALSE')),
content TEXT NOT NULL,
options JSONB DEFAULT '[]'::jsonb,
correct_answers JSONB DEFAULT '[]'::jsonb,
points NUMERIC(5,2) DEFAULT 1 CHECK (points >= 0),
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 28. Test Attempts Table (Lượt làm bài của sinh viên)
CREATE TABLE IF NOT EXISTS test_attempts (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
submitted_at TIMESTAMP WITH TIME ZONE,
is_completed BOOLEAN DEFAULT FALSE,
score NUMERIC(5,2) DEFAULT 0,
max_score NUMERIC(5,2) DEFAULT 0,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 29. Test Attempt Answers Table
CREATE TABLE IF NOT EXISTS test_attempt_answers (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
attempt_id UUID NOT NULL REFERENCES test_attempts(id) ON DELETE CASCADE,
question_id UUID NOT NULL REFERENCES test_questions(id) ON DELETE CASCADE,
selected_options JSONB DEFAULT '[]'::jsonb,
is_correct BOOLEAN DEFAULT FALSE,
created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT uk_attempt_question UNIQUE (attempt_id, question_id)
);
