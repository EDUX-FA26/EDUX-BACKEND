# ART-AI Backend API Specification

Version: 3.2 BRS Aligned  
Status: Draft for implementation  
Project: ART-AI (Academic Research Transparency & AI Audit System)  
Base URL: `/api`

---

## 0. Overview

ART-AI is an academic learning, assignment, grading, communication, and AI transparency platform.

The system supports:

- Authentication by `studentCode + password` for students.
- Account management and password reset.
- Academic structure management: semesters, subjects, classes, sessions/slots, assignments.
- Assignment material upload and assignment publication.
- Student assignment submission and submission versioning.
- AI usage declaration per submission.
- AI usage evaluation based on declared interactions.
- Lecturer review, grading, gradebook, final result, and classification.
- Notifications and email logs.
- Realtime chat between allowed academic users.
- Reports and analytics for Lecturer, Subject Head, and Admin.

The system does **not** perform:

- AI-generated content percentage detection.
- AI-written text detection.
- Plagiarism detection.

The system evaluates:

- How students use AI.
- Whether students critically engage with AI.
- Whether students reflect on AI responses.
- Whether students depend excessively on AI.

---

## 0.1 Common Conventions

### Authentication

All protected APIs require:

```http
Authorization: Bearer <access_token>
```

### Roles

```text
student
lecturer
subject_head
admin
system
```

### User Account Status

```text
active
inactive
pending_activation
```

Notes:

- `pending_activation` is used for auto-provisioned student accounts created during class student import.
- A pending activation account is not considered fully activated until the student completes the activation/change-password flow.

### Common Query Parameters

| Parameter    | Description        | Example     |
| ------------ | ------------------ | ----------- |
| `page`       | Current page       | `1`         |
| `limit`      | Items per page     | `10`        |
| `search`     | Search keyword     | `SE18D01`   |
| `sortBy`     | Sort field         | `createdAt` |
| `sortOrder`  | `asc` or `desc`    | `desc`      |
| `semesterId` | Filter by semester | `...`       |
| `subjectId`  | Filter by subject  | `...`       |
| `classId`    | Filter by class    | `...`       |
| `status`     | Filter by status   | `active`    |

### Common Response Format

```json
{
  "message": "Success",
  "data": {},
  "meta": {
    "page": 1,
    "limit": 10,
    "totalItems": 100,
    "totalPages": 10
  }
}
```

### Common Error Format

```json
{
  "message": "Validation error",
  "errors": [
    {
      "field": "studentCode",
      "message": "Student code is required"
    }
  ],
  "stack": "Error stack trace in development only"
}
```

### File Upload Constraints

Supported submission file formats:

```text
PDF, DOCX, XLSX, PPTX, ZIP
```

Maximum submission file size:

```text
10 MB
```

Assignment material formats:

```text
PDF, DOCX, PPTX, ZIP
```

---

---

# 1. Authentication APIs

## 1.1 Auth Endpoints

| #   | Method | Endpoint                 | Role   | Description                               |
| --- | ------ | ------------------------ | ------ | ----------------------------------------- |
| 1   | POST   | `/auth/register/student` | Public | Student self-registration by student code |
| 2   | POST   | `/auth/login`            | Public | Login for all roles                       |
| 3   | POST   | `/auth/refresh-token`    | Public | Refresh access token                      |
| 4   | POST   | `/auth/logout`           | All    | Logout current session                    |
| 5   | POST   | `/auth/forgot-password`  | Public | Request password reset email              |
| 6   | POST   | `/auth/reset-password`   | Public | Reset password using token                |
| 7   | PATCH  | `/auth/change-password`  | All    | Change password after login               |

## 1.2 Student Register

```http
POST /auth/register/student
```

Request:

```json
{
  "studentCode": "SE182345",
  "fullName": "Nguyen Van A",
  "email": "student@example.com",
  "password": "Password@123"
}
```

Business rules:

- `studentCode` must be unique.
- `email` must be unique.
- New self-registered student account defaults to `role = student` and `status = active`.
- Password must be hashed before storing.

## 1.3 Login

```http
POST /auth/login
```

Student login request:

```json
{
  "studentCode": "SE182345",
  "password": "Password@123"
}
```

Staff login request:

```json
{
  "username": "lecturer01",
  "password": "Password@123"
}
```

Response:

```json
{
  "message": "Login successfully",
  "data": {
    "accessToken": "jwt_access_token",
    "refreshToken": "jwt_refresh_token",
    "user": {
      "id": "user_id",
      "fullName": "Nguyen Van A",
      "email": "student@example.com",
      "studentCode": "SE182345",
      "role": "student"
    }
  }
}
```

---

---

# 2. User Management APIs

## 2.1 User Endpoints

| #   | Method | Endpoint                    | Role  | Description                 |
| --- | ------ | --------------------------- | ----- | --------------------------- |
| 1   | GET    | `/users/me`                 | All   | Get current user profile    |
| 2   | PATCH  | `/users/me`                 | All   | Update own profile          |
| 3   | GET    | `/users`                    | Admin | List users                  |
| 4   | POST   | `/users`                    | Admin | Create user                 |
| 5   | GET    | `/users/:id`                | Admin | Get user detail             |
| 6   | PUT    | `/users/:id`                | Admin | Update user                 |
| 7   | DELETE | `/users/:id`                | Admin | Soft delete/deactivate user |
| 8   | PATCH  | `/users/:id/status`         | Admin | Activate/deactivate user    |
| 9   | PATCH  | `/users/:id/role`           | Admin | Change user role            |
| 10  | PATCH  | `/users/:id/reset-password` | Admin | Admin reset password        |
| 11  | POST   | `/users/import`             | Admin | Import users from file      |

## 2.2 User Query Filters

```http
GET /users?role=student&search=SE18&page=1&limit=10
```

Supported filters:

- `role`
- `isActive`
- `search`
- `studentCode`
- `email`

Business rules:

- Admin cannot delete or deactivate their own account.
- When role changes from `student` to another role, `studentCode` may be set to `null`.
- `studentCode` is required only for student users.

---

---

# 3. Academic Structure APIs

Academic hierarchy:

```text
Semester
  └── Subject
       └── Class
            └── Session / Slot
                 └── Assignment
```

MongoDB design rule:

- Use IDs for stable query relationships.
- Use snapshots only for frequently displayed data such as subject, lecturer, and students.
- `Class` stores `semesterId`, not `semesterSnapshot`.

---

## 3.1 Semester APIs

| Method | Endpoint                 | Role  | Description                  |
| ------ | ------------------------ | ----- | ---------------------------- |
| GET    | `/semesters`             | All   | List semesters               |
| POST   | `/semesters`             | Admin | Create semester              |
| GET    | `/semesters/current`     | All   | Get current semester         |
| GET    | `/semesters/:id`         | All   | Get semester detail          |
| PUT    | `/semesters/:id`         | Admin | Update semester              |
| PATCH  | `/semesters/:id/current` | Admin | Set current semester         |
| PATCH  | `/semesters/:id/status`  | Admin | Activate/deactivate semester |

Create request:

```json
{
  "code": "SU26",
  "name": "Summer 2026",
  "academicYear": "2026",
  "startDate": "2026-05-01",
  "endDate": "2026-08-31",
  "isCurrent": true
}
```

---

## 3.2 Subject APIs

| Method | Endpoint               | Role                                   | Description                 |
| ------ | ---------------------- | -------------------------------------- | --------------------------- |
| GET    | `/subjects`            | Student, Lecturer, Subject Head, Admin | List subjects               |
| POST   | `/subjects`            | Admin                                  | Create subject              |
| GET    | `/subjects/:id`        | Student, Lecturer, Subject Head, Admin | Get subject detail          |
| PUT    | `/subjects/:id`        | Admin                                  | Update subject              |
| PATCH  | `/subjects/:id/status` | Admin                                  | Activate/deactivate subject |

Filters:

```http
GET /subjects?semesterId=...&search=SWD392
```

Subject example:

```json
{
  "code": "SWD392",
  "name": "Software Architecture and Design",
  "description": "Subject description",
  "departmentId": "department_id"
}
```

---

## 3.3 Class APIs

| Method | Endpoint                | Role                                   | Description                            |
| ------ | ----------------------- | -------------------------------------- | -------------------------------------- |
| GET    | `/classes`              | Lecturer, Subject Head, Admin          | List classes                           |
| POST   | `/classes`              | Admin                                  | Create class                           |
| GET    | `/classes/:id`          | Student, Lecturer, Subject Head, Admin | Get class detail                       |
| PUT    | `/classes/:id`          | Admin                                  | Update class                           |
| DELETE | `/classes/:id`          | Admin                                  | Delete/deactivate class                |
| GET    | `/students/me/classes`  | Student                                | Get classes of current student         |
| GET    | `/lecturers/me/classes` | Lecturer                               | Get classes taught by current lecturer |

Filters:

```http
GET /classes?semesterId=...&subjectId=...&lecturerId=...&search=SE18D01
```

Create class request:

```json
{
  "classCode": "SE18D01",
  "semesterId": "semester_id",
  "subjectId": "subject_id",
  "lecturerId": "lecturer_id"
}
```

Business rules:

- A class belongs to one semester.
- A class belongs to one subject.
- A class has one main lecturer.
- `Class` stores `subjectSnapshot`, `lecturerSnapshot`, and `studentSnapshots` for faster display.
- `semesterId` is stored for query and filtering.

---

## 3.4 Class Member APIs

| Method | Endpoint                                | Role                          | Description                |
| ------ | --------------------------------------- | ----------------------------- | -------------------------- |
| GET    | `/classes/:classId/students`            | Lecturer, Subject Head, Admin | List students in class     |
| POST   | `/classes/:classId/students`            | Admin, Lecturer               | Add one student to class   |
| POST   | `/classes/:classId/students/import`     | Admin, Lecturer               | Import students into class |
| DELETE | `/classes/:classId/students/:studentId` | Admin, Lecturer               | Remove student from class  |

Add student request:

```json
{
  "studentId": "student_id"
}
```

Import students request:

```http
POST /classes/:classId/students/import
Content-Type: multipart/form-data
```

Fields:

| Field  | Type | Required | Description                              |
| ------ | ---- | -------- | ---------------------------------------- |
| `file` | File | Yes      | Excel file containing studentCode values |

Business rules:

- Student cannot be duplicated in the same class.
- Adding/removing a student must sync `studentSnapshots` in `Class`.
- Class member data is used to query enrolled classes and control chat permission.
- Import file may contain `studentCode` values that do not yet exist in the system.
- If a `studentCode` does not exist, the system shall automatically provision a new Student account.
- Auto-provisioned student accounts shall be created with:
  - `role = student`
  - `status = pending_activation`
  - default password generated by system configuration
- The newly created `userId` shall immediately be assigned to the target class.
- Existing `studentCode` values shall reuse existing user records.
- Duplicate `studentCode` values within the same import file shall be rejected.
- Import must return a summary including imported students, skipped duplicates, and auto-provisioned accounts.

---

---

# 4. Session Management APIs

## 4.1 Session / Slot APIs

A session represents a learning slot inside a class and subject.

| Method | Endpoint                     | Role                            | Description              |
| ------ | ---------------------------- | ------------------------------- | ------------------------ |
| GET    | `/classes/:classId/sessions` | Student, Lecturer, Subject Head | List sessions of a class |
| POST   | `/classes/:classId/sessions` | Lecturer, Admin                 | Create session           |
| GET    | `/sessions/:id`              | Student, Lecturer, Subject Head | Get session detail       |
| PUT    | `/sessions/:id`              | Lecturer, Admin                 | Update session           |
| DELETE | `/sessions/:id`              | Lecturer, Admin                 | Delete session           |

List sessions:

```http
GET /classes/:classId/sessions?page=1&limit=10
```

Create request:

```json
{
  "sessionNo": 1,
  "title": "Introduction to Research Transparency",
  "description": "Overview of responsible AI usage",
  "startTime": "2026-06-20T08:00:00Z",
  "endTime": "2026-06-20T10:00:00Z"
}
```

Business rules:

- Student UI displays 10 sessions per page.
- A session belongs to exactly one class.
- A session can contain zero or many assignments.

## 4.2 Schedule APIs

| Method | Endpoint | Role | Description |
| --- | --- | --- | --- |
| GET | /students/me/schedule | Student | Get weekly schedule |

Query:
`http
GET /students/me/schedule?startDate=2026-06-01&endDate=2026-06-07
`

---

---

# 5. Assignment Management APIs

Assignments replace the old `grade-items` concept for the new business flow.

Old mapping:

```text
GradeItem -> Assignment
/classes/:classId/grade-items -> /classes/:classId/assignments
/grade-items/:id -> /assignments/:id
```

## 4.1 Assignment Endpoints

| Method | Endpoint                                  | Role                            | Description                                        |
| ------ | ----------------------------------------- | ------------------------------- | -------------------------------------------------- |
| GET    | `/classes/:classId/assignments`           | Student, Lecturer, Subject Head | List assignments in class                          |
| GET    | `/sessions/:sessionId/assignments`        | Student, Lecturer, Subject Head | List assignments in session                        |
| POST   | `/sessions/:sessionId/assignments`        | Lecturer                        | Create assignment in session                       |
| POST   | `/subjects/:subjectId/global-assignments` | Lecturer                        | Create global assignment cloned for multiple classes |
| GET    | `/assignments/:id`                        | Student, Lecturer, Subject Head | Get assignment detail                              |
| PUT    | `/assignments/:id`                        | Lecturer                        | Update assignment                                  |
| DELETE | `/assignments/:id`                        | Lecturer                        | Delete assignment                                  |
| PATCH  | `/assignments/:id/publish`                | Lecturer                        | Publish assignment                                 |
| PATCH  | `/assignments/:id/close`                  | Lecturer                        | Close assignment                                   |

Create assignment request:

```json
{
  "title": "Literature Review Draft",
  "description": "Submit your literature review draft.",
  "instructions": "Upload PDF or DOCX and declare AI usage if used.",
  "deadline": "2026-06-30T23:59:00Z",
  "maxScore": 10,
  "weight": 20,
  "aiDeclarationRequired": true,
  "minAiInteractions": 5,
  "maxAiInteractions": 10,
  "allowResubmission": true
}
```

Business rules:

- Assignment belongs to one session.
- Assignment belongs to one class through session.
- Deadline must be greater than current datetime when publishing.
- If `aiDeclarationRequired = true`, student must satisfy AI interaction rule before finalizing submission.
- Publishing assignment sends notification and email to students in the class.

---

## 4.2 Assignment Material APIs

| Method | Endpoint                               | Role                            | Description       |
| ------ | -------------------------------------- | ------------------------------- | ----------------- |
| GET    | `/assignments/:assignmentId/materials` | Student, Lecturer, Subject Head | List materials    |
| POST   | `/assignments/:assignmentId/materials` | Lecturer                        | Upload material   |
| GET    | `/materials/:id/download`              | Student, Lecturer, Subject Head | Download material |
| DELETE | `/materials/:id`                       | Lecturer                        | Delete material   |

Upload material request:

```http
POST /assignments/:assignmentId/materials
Content-Type: multipart/form-data
```

Fields:

| Field         | Type   | Required |
| ------------- | ------ | -------- |
| `file`        | File   | Yes      |
| `title`       | String | Optional |
| `description` | String | Optional |

Supported formats:

```text
PDF, DOCX, PPTX, ZIP
```

---

---

# 5. Submission Management APIs

## 5.1 Submission Endpoints

| Method | Endpoint                                    | Role                            | Description                            |
| ------ | ------------------------------------------- | ------------------------------- | -------------------------------------- |
| POST   | `/assignments/:assignmentId/submissions`    | Student                         | Create/update draft submission         |
| POST   | `/submissions/:id/finalize`                 | Student                         | Finalize draft submission              |
| GET    | `/assignments/:assignmentId/submissions/my` | Student                         | Get my submission for assignment       |
| GET    | `/assignments/:assignmentId/submissions`    | Lecturer, Subject Head          | List finalized assignment submissions  |
| GET    | `/students/me/submissions`                  | Student                         | Get all submissions of current student |
| GET    | `/submissions/:id`                          | Student, Lecturer, Subject Head | Get submission detail                  |
| DELETE | `/submissions/:id`                          | Student, Lecturer               | Withdraw/delete submission if allowed  |

Submission request:

```http
POST /assignments/:assignmentId/submissions
Content-Type: multipart/form-data
```

Fields:

| Field  | Type   | Required |
| ------ | ------ | -------- |
| `file` | File   | Yes      |
| `note` | String | Optional |

Submission status:

```text
draft
submitted
late
withdrawn
```

Business rules:

- Supported formats: PDF, DOCX, XLSX, PPTX, ZIP.
- Maximum file size: 10 MB.
- Uploading a file creates or updates a Draft Submission.
- A submission is considered finalized only when:
  - file upload is completed
  - AI declaration requirement is satisfied
- If `aiDeclarationRequired = true` and the valid interaction count is below `minAiInteractions`, submission status remains `draft`.
- Draft submissions are visible only to the owner student.
- Lecturer and Subject Head cannot view draft submissions.
- `GET /assignments/:assignmentId/submissions` must return only submissions with status `submitted` or `late`.
- If a student resubmits, create a new submission version.
- If finalized after deadline, status becomes `late`.
- Successful finalization sends email and in-app notification to the student.

Finalize submission request:

```http
POST /submissions/:id/finalize
```

Finalize business rules:

- Only the owner student can finalize their own submission.
- System validates uploaded file existence.
- System validates AI declaration requirement using `minAiInteractions` and `maxAiInteractions`.
- If validation fails, return `400 Bad Request`.
- If validation succeeds before deadline, status becomes `submitted`.
- If validation succeeds after deadline, status becomes `late`.

---

## 5.2 Submission Version APIs

| Method | Endpoint                                   | Role                            | Description                     |
| ------ | ------------------------------------------ | ------------------------------- | ------------------------------- |
| GET    | `/submissions/:submissionId/versions`      | Student, Lecturer, Subject Head | List submission versions        |
| POST   | `/submissions/:submissionId/versions`      | Student                         | Resubmit and create new version |
| GET    | `/submission-versions/:versionId`          | Student, Lecturer, Subject Head | Get version detail              |
| GET    | `/submission-versions/:versionId/download` | Student, Lecturer, Subject Head | Download submitted file         |
| GET    | `/submissions/:submissionId/download`      | Student, Lecturer, Subject Head | Download latest version         |

Create new version request:

```http
POST /submissions/:submissionId/versions
Content-Type: multipart/form-data
```

Fields:

| Field  | Type   | Required |
| ------ | ------ | -------- |
| `file` | File   | Yes      |
| `note` | String | Optional |

Business rules:

- Previous versions are immutable.
- Latest version is active.
- Resubmission creates or updates a draft version until the student finalizes it.
- AI interactions should be linked to the active submission or active version depending on implementation.
- Lecturer and Subject Head can view only finalized versions belonging to submissions with status `submitted` or `late`.

---

---

# 6. AI Declaration APIs

## 6.1 AI Interaction Endpoints

| Method | Endpoint                                              | Role                            | Description                  |
| ------ | ----------------------------------------------------- | ------------------------------- | ---------------------------- |
| GET    | `/submissions/:submissionId/ai-interactions`          | Student, Lecturer, Subject Head | List AI interactions         |
| POST   | `/submissions/:submissionId/ai-interactions`          | Student                         | Create AI interaction        |
| GET    | `/ai-interactions/:id`                                | Student, Lecturer, Subject Head | Get AI interaction detail    |
| PUT    | `/ai-interactions/:id`                                | Student                         | Update AI interaction        |
| DELETE | `/ai-interactions/:id`                                | Student                         | Delete AI interaction        |
| POST   | `/submissions/:submissionId/ai-interactions/validate` | Student                         | Validate min/max requirement |

Create request:

```json
{
  "aiTool": "chatgpt",
  "usagePurpose": "topic_research",
  "promptContent": "Suggest research questions about responsible AI usage in education.",
  "aiResponseSummary": "AI suggested several research questions about transparency and reflection.",
  "studentDecision": "partially_accepted",
  "reflectionText": "I used the suggestions only as references and rewrote the research question myself."
}
```

Allowed `aiTool`:

```text
chatgpt, gemini, claude, copilot, other
```

Allowed `usagePurpose`:

```text
brainstorming, topic_research, summarization, writing_improvement, critical_feedback, methodology_review, data_analysis, other
```

Allowed `studentDecision`:

```text
accepted, partially_accepted, rejected, reference_only
```

Business rules:

- Assignment controls whether AI declaration is required.
- Default min/max may be configured by assignment.
- If declaration is required, the student cannot finalize submission until valid interaction count is satisfied.
- `POST /submissions/:submissionId/ai-interactions/validate` is used by the Draft → Submitted workflow.
- Validation must check both `minAiInteractions` and `maxAiInteractions`.
- Validation success allows submission finalization.
- Validation failure prevents submission finalization and keeps submission status as `draft`.
- AI interactions are declarations by students, not AI detection results.

---

---

# 7. AI Evaluation APIs

## 7.1 AI Evaluation Endpoints

| Method | Endpoint                                               | Role                            | Description              |
| ------ | ------------------------------------------------------ | ------------------------------- | ------------------------ |
| POST   | `/submissions/:submissionId/ai-evaluation`             | Lecturer, System                | Evaluate AI usage        |
| POST   | `/submissions/:submissionId/ai-evaluation/recalculate` | Lecturer, Subject Head, System  | Recalculate evaluation   |
| GET    | `/submissions/:submissionId/ai-evaluation`             | Student, Lecturer, Subject Head | View evaluation          |
| GET    | `/classes/:classId/ai-evaluations`                     | Lecturer, Subject Head          | View class evaluations   |
| GET    | `/students/:studentId/ai-evaluations`                  | Lecturer, Subject Head          | View student evaluations |

Evaluation response:

```json
{
  "submissionId": "submission_id",
  "pattern": "critical_engagement",
  "riskLevel": "low",
  "promptQualityScore": 82,
  "reflectionQualityScore": 86,
  "criticalThinkingScore": 80,
  "aiDependencyScore": 25,
  "transparencyScore": 84,
  "summary": "Student demonstrates critical engagement with AI outputs."
}
```

Allowed patterns:

```text
critical_engagement
collaborative_usage
passive_usage
high_dependency
```

Business rules:

- Transparency score range: 0-100.
- Transparency score does not directly affect academic grade.
- Evaluation is based on declared interactions, not submitted file AI detection.

---

---

# 8. Review Management APIs

## 8.1 Review Endpoints

| Method | Endpoint                                         | Role                   | Description                         |
| ------ | ------------------------------------------------ | ---------------------- | ----------------------------------- |
| GET    | `/lecturer/classes/:classId/submission-overview` | Lecturer               | View finalized submissions in class |
| GET    | `/submissions/:submissionId/review`              | Lecturer, Subject Head | Get review                          |
| POST   | `/submissions/:submissionId/review`              | Lecturer               | Create review                       |
| PATCH  | `/submissions/:submissionId/review-status`       | Lecturer               | Update review status                |
| POST   | `/submissions/:submissionId/comments`            | Lecturer               | Add review comment                  |

Review status:

```text
pending
reviewed
needs_revision
flagged
```

Create review request:

```json
{
  "reviewStatus": "reviewed",
  "comment": "Good submission. AI usage declaration is clear."
}
```

---

---

# 9. Grading Management APIs

## 9.1 Grade APIs

### 9.1.1 Grade Endpoints

| Method | Endpoint                                  | Role                            | Description            |
| ------ | ----------------------------------------- | ------------------------------- | ---------------------- |
| POST   | `/submissions/:submissionId/grade`        | Lecturer                        | Grade submission       |
| GET    | `/submissions/:submissionId/grade`        | Student, Lecturer, Subject Head | View grade             |
| PUT    | `/submissions/:submissionId/grade`        | Lecturer                        | Update grade           |
| DELETE | `/submissions/:submissionId/grade`        | Lecturer                        | Delete grade           |
| GET    | `/assignments/:assignmentId/grades`       | Lecturer, Subject Head          | View assignment grades |
| GET    | `/classes/:classId/gradebook`             | Lecturer, Subject Head          | View class gradebook   |
| PATCH  | `/classes/:classId/gradebook/bulk-update` | Lecturer                        | Bulk update gradebook  |
| GET    | `/classes/:classId/gradebook/export`      | Lecturer, Subject Head          | Export gradebook       |

Create grade request:

```json
{
  "score": 8.5,
  "maxScore": 10,
  "feedback": "Strong critical engagement with AI."
}
```

Business rules:

- Score must be between 0 and `maxScore`.
- Each student has one grade per assignment.
- Grade and transparency score are separate.

---

---

## 9.2 Final Result & Academic Classification APIs

### 9.2.1 Final Result Endpoints

| Method | Endpoint                                             | Role                            | Description                    |
| ------ | ---------------------------------------------------- | ------------------------------- | ------------------------------ |
| POST   | `/classes/:classId/final-results/calculate`          | Lecturer                        | Calculate final results        |
| GET    | `/classes/:classId/final-results`                    | Lecturer, Subject Head          | View final results             |
| GET    | `/students/:studentId/classes/:classId/final-result` | Student, Lecturer, Subject Head | View one final result          |
| GET    | `/students/me/results`                               | Student                         | View current student's results |
| GET    | `/classes/:classId/final-results/export`             | Lecturer, Subject Head          | Export final results           |

Formula:

```text
Final Score = Σ((Assignment Score / Assignment Max Score) × 10 × Assignment Weight)
```

Business rules:

- Final Score is always normalized to a 10-point scale.
- Assignment `maxScore` may vary between assignments.
- Assignment `weight` should be stored and calculated as a decimal ratio.
- Final result remains within the 0–10 scale.
- Transparency Score does not directly affect Final Score.

Example:

```text
Assignment A:
Score = 80
Max Score = 100
Weight = 0.3

Normalized Score = (80 / 100) × 10 = 8
Contribution = 8 × 0.3 = 2.4
```

Classification rules:

```text
0.0 - 4.9   = poor
5.0 - 6.4   = average
6.5 - 7.9   = good
8.0 - 8.9   = very_good
9.0 - 10.0  = excellent
```

### 9.2.2 Classification Endpoints

| Method | Endpoint                              | Role                            | Description                 |
| ------ | ------------------------------------- | ------------------------------- | --------------------------- |
| GET    | `/classes/:classId/classifications`   | Lecturer, Subject Head          | View classifications        |
| GET    | `/classes/:classId/rankings`          | Lecturer, Subject Head          | View rankings               |
| GET    | `/students/:studentId/classification` | Student, Lecturer, Subject Head | View student classification |

---

---

# 10. Notification & Email APIs

## 10.1 Notification Endpoints

| Method | Endpoint                       | Role                          | Description                       |
| ------ | ------------------------------ | ----------------------------- | --------------------------------- |
| GET    | `/notifications`               | All                           | List current user's notifications |
| GET    | `/notifications/unread-count`  | All                           | Get unread count                  |
| PATCH  | `/notifications/:id/read`      | All                           | Mark notification as read         |
| PATCH  | `/notifications/read-all`      | All                           | Mark all as read                  |
| DELETE | `/notifications/:id`           | All                           | Delete notification               |
| POST   | `/notifications/announcements` | Lecturer, Subject Head, Admin | Send announcement                 |

Notification types:

```text
assignment_created
assignment_updated
deadline_reminder
submission_success
submission_reviewed
grade_published
flag_created
final_result_released
chat_message
system_announcement
```

## 10.2 Email Log Endpoints

| Method | Endpoint                | Role  | Description          |
| ------ | ----------------------- | ----- | -------------------- |
| GET    | `/email-logs`           | Admin | List email logs      |
| GET    | `/email-logs/:id`       | Admin | Get email log detail |
| POST   | `/email-logs/:id/retry` | Admin | Retry failed email   |

System email triggers:

- Assignment published.
- Submission finalized successfully.
- Deadline reminder.
- Grade published.
- Password reset.
- System announcement.

---

---

# 11. Realtime Chat APIs

Socket.IO is recommended for realtime message delivery. REST APIs are used for chat room discovery, history, and message management.

## 11.1 Chat Room Endpoints

| Method | Endpoint                      | Role                            | Description                    |
| ------ | ----------------------------- | ------------------------------- | ------------------------------ |
| GET    | `/chat/rooms`                 | Student, Lecturer, Subject Head | List my chat rooms             |
| POST   | `/chat/rooms`                 | Student, Lecturer, Subject Head | Create or get direct chat room |
| GET    | `/chat/rooms/:roomId`         | Room Member                     | Get room detail                |
| PATCH  | `/chat/rooms/:roomId/archive` | Room Member                     | Archive room                   |
| GET    | `/chat/contacts`              | Student, Lecturer, Subject Head | List available contacts        |

Create room request:

```json
{
  "memberIds": ["user_id_1", "user_id_2"],
  "context": {
    "classId": "class_id",
    "subjectId": "subject_id"
  }
}
```

Business rules:

- Student can chat with classmates in the same class.
- Student can chat with lecturers who teach their classes.
- Lecturer can chat with students in their classes.
- Lecturer can chat with Subject Head in the same department/subject scope.
- Subject Head can chat with lecturers and students within managed scope.

## 11.2 Chat Message Endpoints

| Method | Endpoint                         | Role                            | Description          |
| ------ | -------------------------------- | ------------------------------- | -------------------- |
| GET    | `/chat/rooms/:roomId/messages`   | Room Member                     | Get message history  |
| POST   | `/chat/rooms/:roomId/messages`   | Room Member                     | Send message         |
| PATCH  | `/chat/messages/:messageId/read` | Room Member                     | Mark message as read |
| DELETE | `/chat/messages/:messageId`      | Sender                          | Delete own message   |
| GET    | `/chat/messages/search`          | Student, Lecturer, Subject Head | Search messages      |

Send message request:

```json
{
  "messageType": "text",
  "content": "Please check the deadline for assignment 1."
}
```

Supported message types:

```text
text
image
file
```

## 11.3 Socket Events

Client emits:

```text
chat:join_room
chat:send_message
chat:typing
chat:mark_read
```

Server emits:

```text
chat:new_message
chat:typing
chat:message_read
chat:room_updated
notification:new
```

---

---

# 12. Reporting & Analytics APIs

## 12.1 Dashboard, Reporting & Analytics APIs

Student does not have a dashboard in the new business flow. Student home is semester → subject → session.

### 12.1.1 Student Home APIs

| Method | Endpoint                                  | Role    | Description                                           |
| ------ | ----------------------------------------- | ------- | ----------------------------------------------------- |
| GET    | `/student/home`                           | Student | Load current semester, enrolled subjects, and classes |
| GET    | `/student/semesters/:semesterId/subjects` | Student | Load enrolled subjects in selected semester           |
| GET    | `/student/classes/:classId/sessions`      | Student | Load sessions of selected class                       |

Student home response example:

```json
{
  "currentSemester": {
    "id": "semester_id",
    "name": "Summer 2026"
  },
  "subjects": [
    {
      "subjectId": "subject_id",
      "subjectCode": "SWD392",
      "subjectName": "Software Architecture and Design",
      "classId": "class_id",
      "classCode": "SE18D01",
      "lecturerName": "Nguyen Van A"
    }
  ]
}
```

### 12.1.2 Lecturer Home & Analytics APIs

| Method | Endpoint                                           | Role     | Description                                |
| ------ | -------------------------------------------------- | -------- | ------------------------------------------ |
| GET    | `/lecturer/home`                                   | Lecturer | Load lecturer classes and current semester |
| GET    | `/lecturer/classes/:classId/overview`              | Lecturer | Overview of selected class                 |
| GET    | `/lecturer/classes/:classId/submission-statistics` | Lecturer | Submission statistics                      |
| GET    | `/lecturer/classes/:classId/ai-statistics`         | Lecturer | AI usage statistics                        |

Metrics:

- Total students.
- Draft / submitted / late submissions.
- Pending reviews.
- Average score.
- AI usage distribution.
- Flagged submissions.

### 12.1.3 Subject Head Analytics APIs

| Method | Endpoint                                        | Role         | Description                       |
| ------ | ----------------------------------------------- | ------------ | --------------------------------- |
| GET    | `/subject-head/overview`                        | Subject Head | Overall managed scope analytics   |
| GET    | `/subject-head/classes`                         | Subject Head | View classes in managed scope     |
| GET    | `/subject-head/classes/:classId/analytics`      | Subject Head | Class analytics                   |
| GET    | `/subject-head/subjects/:subjectId/analytics`   | Subject Head | Subject analytics                 |
| GET    | `/subject-head/students/:studentId/detail`      | Subject Head | View detailed student information |
| GET    | `/subject-head/lecturers/:lecturerId/analytics` | Subject Head | Lecturer activity analytics       |

Metrics:

- AI usage by class.
- AI usage by subject.
- High dependency cases.
- Average score by class.
- Average score by subject.
- Lecturer review activity.
- Pass rate.
- Score distribution.

### 12.1.4 Admin Dashboard APIs

| Method | Endpoint                 | Role  | Description               |
| ------ | ------------------------ | ----- | ------------------------- |
| GET    | `/admin/dashboard`       | Admin | Admin system dashboard    |
| GET    | `/admin/system-activity` | Admin | View system activity logs |

Metrics:

- Total users.
- Total classes.
- Total subjects.
- Total submissions.
- Total AI interactions.
- Email success/failure.
- Active users.

---

---

## 12.2 Report & Export APIs

### 12.2.1 Academic Reports

| Method | Endpoint                                    | Role                   | Description           |
| ------ | ------------------------------------------- | ---------------------- | --------------------- |
| GET    | `/reports/classes/:classId/grade-summary`   | Lecturer, Subject Head | Grade summary         |
| GET    | `/reports/classes/:classId/final-results`   | Lecturer, Subject Head | Final results report  |
| GET    | `/reports/classes/:classId/rankings`        | Lecturer, Subject Head | Ranking report        |
| GET    | `/reports/classes/:classId/classifications` | Lecturer, Subject Head | Classification report |

### 12.2.2 AI Usage Reports

| Method | Endpoint                                  | Role                   | Description              |
| ------ | ----------------------------------------- | ---------------------- | ------------------------ |
| GET    | `/reports/classes/:classId/ai-usage`      | Lecturer, Subject Head | Class AI usage report    |
| GET    | `/reports/subjects/:subjectId/ai-usage`   | Subject Head           | Subject AI usage report  |
| GET    | `/reports/semesters/:semesterId/ai-usage` | Subject Head           | Semester AI usage report |
| GET    | `/reports/suspicious-cases`               | Subject Head           | Suspicious cases report  |

### 12.2.3 Export APIs

| Method | Endpoint                                | Role                   | Description            |
| ------ | --------------------------------------- | ---------------------- | ---------------------- |
| GET    | `/reports/classes/:classId/export`      | Lecturer, Subject Head | Export class report    |
| GET    | `/reports/subjects/:subjectId/export`   | Subject Head           | Export subject report  |
| GET    | `/reports/semesters/:semesterId/export` | Subject Head           | Export semester report |

Export query:

```http
GET /reports/classes/:classId/export?type=grade-summary&format=xlsx
```

Supported formats:

```text
xlsx
pdf
csv
```

---

---

# 13. Flag Management APIs

## 13.1 Flag Endpoints

| Method | Endpoint                           | Role                   | Description           |
| ------ | ---------------------------------- | ---------------------- | --------------------- |
| GET    | `/flags`                           | Lecturer, Subject Head | List flags            |
| GET    | `/submissions/:submissionId/flags` | Lecturer, Subject Head | List submission flags |
| POST   | `/submissions/:submissionId/flags` | Lecturer, Subject Head | Create manual flag    |
| PATCH  | `/flags/:id/resolve`               | Lecturer, Subject Head | Resolve flag          |
| PATCH  | `/flags/:id/level`                 | Lecturer, Subject Head | Update severity level |
| PATCH  | `/flags/:id/dismiss`               | Lecturer, Subject Head | Dismiss flag          |

Flag types:

```text
low_quality_prompt
high_ai_dependency
weak_reflection
all_responses_accepted
missing_ai_interactions
suspicious_declaration
manual
```

Severity:

```text
low
medium
high
```

Business rules:

- Flags indicate suspicious AI usage behavior only.
- Flags do not indicate plagiarism or AI-generated text detection.

---

---

# 14. System Monitoring APIs

| Method | Endpoint                | Role   | Description     |
| ------ | ----------------------- | ------ | --------------- |
| GET    | `/monitoring/health`    | Public | Health check    |
| GET    | `/monitoring/readiness` | Public | Readiness check |
| GET    | `/monitoring/liveness`  | Public | Liveness check  |
| GET    | `/monitoring/metrics`   | Admin  | System metrics  |

---

---

# 15. Backward Compatibility Notes

The old API used `grade-items` as the main assignment milestone resource.

Recommended migration:

| Old Endpoint                            | New Endpoint                             |
| --------------------------------------- | ---------------------------------------- |
| `/classes/:classId/grade-items`         | `/classes/:classId/assignments`          |
| `/grade-items/:id`                      | `/assignments/:id`                       |
| `/grade-items/:gradeItemId/submissions` | `/assignments/:assignmentId/submissions` |
| `/grade-items/:gradeItemId/grades`      | `/assignments/:assignmentId/grades`      |

During transition, the backend may support both names:

- `grade-items` as deprecated alias.
- `assignments` as canonical endpoint.

---

---

# 16. Core MVP API Priority

Recommended implementation order:

1. Module 1 Authentication APIs.
2. Module 2 User Management APIs.
3. Module 3 Academic Structure APIs.
4. Module 4 Session Management APIs.
5. Module 5 Assignment Management APIs.
6. Module 6 Submission Management APIs.
7. Module 7 AI Declaration & AI Evaluation APIs.
8. Module 8 Review Management APIs.
9. Module 9 Grading Management APIs.
10. Module 10 Notification & Email APIs.
11. Module 11 Realtime Chat APIs.
12. Module 12 Reporting & Analytics APIs.
13. Module 13 Flag Management APIs.
14. Module 14 System Monitoring APIs.
15. Module 15 Test & Quiz Management APIs.

---

---

# 17. Core Philosophy

ART-AI does not evaluate:

- AI-generated percentage.
- AI-generated text detection.
- Plagiarism detection.

ART-AI evaluates:

- How students use AI.
- Whether students critically engage with AI.
- Whether students reflect on AI responses.
- Whether students depend excessively on AI.

The system promotes transparency, accountability, responsible AI-assisted learning, and academic monitoring.

---

# 18. BRS Traceability Matrix

This section maps BUSINESS REQUIREMENT SPECIFICATION (BRS) modules to implementation modules and owners.

| BRS Module | BR Code / Scope         | API Module                          | Owner                 |
| ---------- | ----------------------- | ----------------------------------- | --------------------- |
| Module 1   | BR-AUTH-\*              | Authentication APIs                 | Member 129            |
| Module 2   | User Management         | User Management APIs                | Member 129            |
| Module 3   | BR-CLASS-\*             | Academic Structure APIs             | Member 36             |
| Module 4   | BR-SESSION-\*           | Session Management APIs             | Member 36             |
| Module 5   | BR-ASSIGNMENT-\*        | Assignment Management APIs          | Member 45             |
| Module 6   | BR-SUBMISSION-\*        | Submission Management APIs          | Member 45             |
| Module 7   | BR-AI-_ / BR-AI-EVAL-_  | AI Declaration & AI Evaluation APIs | Member 78             |
| Module 8   | BR-REVIEW-\*            | Review Management APIs              | Member 78             |
| Module 9   | BR-GRADE-\*             | Grading & Final Result APIs         | Member 36 + Member 78 |
| Module 9.1 | BR-GRADE-001 + 002      | Grade & Gradebook APIs              | Member 36             |
| Module 9.2 | BR-GRADE-003            | Final Result APIs                   | Member 78             |
| Module 9.3 | Academic Classification | Classification / Ranking APIs       | Member 78             |
| Module 10  | BR-NOTIFY-\*            | Notification & Email APIs           | Member 45             |
| Module 11  | BR-CHAT-\*              | Realtime Chat APIs                  | Member 129            |
| Module 12  | BR-REPORT-\*            | Reporting & Analytics APIs          | Member 129            |
| Module 13  | BR-PORTAL-\*            | Academic Portal APIs                | Member 129            |
| Module 14  | BR-FLAG-\*              | Flag Management APIs                | TBD                   |
| Module 15  | BR-TEST-\*              | Test & Quiz APIs                    | TBD                   |
| Module 16  | Monitoring / System Ops | System Monitoring APIs              | TBD                   |

---

## 19.1 Updated BR Impact Mapping

### BR-CLASS-001 Import Students To Class

Related APIs:

- `POST /classes/:classId/students/import`
- `POST /classes/:classId/students`
- `GET /classes/:classId/students`

Implementation owner:

- Member 36

Support owner:

- Member 129 for User auto-provision helper.

---

### BR-SUBMISSION-001 Submit Assignment

Related APIs:

- `POST /assignments/:assignmentId/submissions`
- `POST /submissions/:id/finalize`
- `GET /assignments/:assignmentId/submissions`
- `GET /assignments/:assignmentId/submissions/my`

Implementation owner:

- Member 56

Support owner:

- Member 78 for AI interaction validation.

---

### BR-AI-001 AI Declaration Requirement

Related APIs:

- `POST /submissions/:submissionId/ai-interactions/validate`
- `POST /submissions/:submissionId/ai-interactions`
- `GET /submissions/:submissionId/ai-interactions`

Implementation owner:

- Member 78

---

### BR-GRADE-003 Final Score Calculation

Related APIs:

- `POST /classes/:classId/final-results/calculate`
- `GET /classes/:classId/final-results`
- `GET /students/:studentId/classes/:classId/final-result`

Formula:

```text
Final Score = Σ((Score / Max Score) × 10 × Weight)
```

Implementation owner:

- Member 129

---

# 14. News Endpoints

| Method | Endpoint | Role | Description |
| ------ | -------- | ---- | ----------- |
| GET | `/news` | Student, Lecturer, Subject Head, Admin | List published news |
| GET | `/news/:id` | Student, Lecturer, Subject Head, Admin | Get news details |
| POST | `/news` | Admin, Subject Head | Create a news post |
| PUT | `/news/:id` | Admin, Subject Head | Update a news post |
| DELETE | `/news/:id` | Admin, Subject Head | Delete a news post |


---

# 13. Academic Portal APIs

## 13.1 Portal Endpoints

| Method | Endpoint | Role | Description |
| --- | --- | --- | --- |
| GET | /portal/attendance/classes/:classId | Student | View attendance for a specific class |
| GET | /portal/transactions/me | Student | View tuition and transaction history |
| GET | /portal/curriculum/me | Student | View academic curriculum roadmap |
| GET | /portal/transcript/me | Student | View cumulative academic transcript |

---

# 15. Test & Quiz Management APIs

## 15.1 Test Endpoints

| Method | Endpoint | Role | Description |
| --- | --- | --- | --- |
| GET | /classes/:classId/tests | Student, Lecturer | List tests in a class |
| POST | /classes/:classId/tests | Lecturer | Create a new test |
| GET | /tests/:id | Student, Lecturer | Get test details |
| POST | /tests/:id/questions | Lecturer | Add questions to a test |
| POST | /tests/:id/submit | Student | Submit test answers |
| GET | /tests/:id/analytics | Lecturer | View test score analytics and question statistics |
