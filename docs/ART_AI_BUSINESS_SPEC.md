# ART-AI BUSINESS REQUIREMENT SPECIFICATION (BRS)

Version: 2.0
Project: ART-AI (Academic Research Transparency & AI Audit System)

---

# 1. SYSTEM OVERVIEW

## 1.1 Purpose

ART-AI is an academic learning and transparency platform designed to support assignment management, submission management, grading, communication, and responsible Generative AI usage in higher education.

The platform evaluates:

* How students use AI
* How students reflect on AI responses
* How students critically engage with AI
* Whether students depend excessively on AI

The platform does NOT evaluate:

* AI Generated Percentage
* AI Generated Text Detection
* Plagiarism Detection

---

# 2. ACTORS

## ACT-001 Student

Responsibilities:

* Study course materials
* Submit assignments
* Declare AI usage
* View grades
* Communicate with lecturers

---

## ACT-002 Lecturer

Responsibilities:

* Manage assignments
* Review submissions
* Grade students
* Review AI declarations
* Communicate with students

---

## ACT-003 Subject Head

Responsibilities:

* Monitor classes
* Monitor lecturers
* Monitor AI transparency
* View reports and analytics

---

## ACT-004 Administrator

Responsibilities:

* Manage users
* Manage permissions
* Manage system settings

---

# 3. DOMAIN STRUCTURE

Academic Hierarchy

Semester
└── Subject
└── Class
└── Session
└── Assignment
└── Submission
└── AI Declaration

---

# 4. AUTHENTICATION REQUIREMENTS

## BR-AUTH-001 Student Registration

Actor:
Student

Description:
Students may self-register an account.

Inputs:

* StudentCode
* FullName
* Email
* Password

Business Rules:

* StudentCode must be unique.
* Email must be unique.
* Password minimum length = 8.
* Account status defaults to ACTIVE.

Outputs:

* New account created.

---

## BR-AUTH-002 Login

Actors:

* Student
* Lecturer
* Subject Head
* Admin

Description:

Users shall authenticate before accessing the system.

Credentials:

Student:

* StudentCode
* Password

Staff:

* Username
* Password

Outputs:

* Access Token
* Refresh Token

---

## BR-AUTH-003 Change Password

Authenticated users may change password.

Business Rules:

* Old password required.
* New password must differ from current password.

---

## BR-AUTH-004 Forgot Password

Users may request password reset via email.

---

# 5. SEMESTER & SUBJECT REQUIREMENTS

## BR-SEM-001 View Semester

Actor:
Student

Flow:

1. Login.
2. System loads current semester.
3. Student may switch semester.

Business Rules:

* Current semester selected by default.

---

## BR-SUBJECT-001 View Subjects

Actor:
Student

Flow:

1. Select semester.
2. System loads enrolled subjects.

Outputs:

* Subject list.

---

# 6. SESSION MANAGEMENT

## BR-SESSION-001 View Sessions

Actor:
Student

Description:

Students shall view all sessions belonging to a selected subject.

Business Rules:

* 10 sessions displayed per page.
* Pagination required.

Outputs:

* Session list.

---

## BR-SESSION-002 View Session Detail

Actor:
Student

Displayed Information:

* Session Name
* Description
* Learning Materials
* Assignments

---

# 7. ASSIGNMENT MANAGEMENT

## BR-ASSIGNMENT-001 Create Assignment

Actor:
Lecturer

Inputs:

* Title
* Description
* Instructions
* Deadline
* AI Declaration Required

Business Rules:

* Assignment belongs to one session.
* Deadline must be future datetime.

Outputs:

* Assignment created.

---

## BR-ASSIGNMENT-002 Upload Learning Materials

Actor:
Lecturer

Supported Formats:

* PDF
* DOCX
* PPTX
* ZIP

Outputs:

* Materials attached to assignment.

---

## BR-ASSIGNMENT-003 Assignment Publication Notification

Trigger:

Assignment published.

Recipients:

All students in class.

Channels:

* Email
* In-App Notification

---

# 8. SUBMISSION MANAGEMENT

## BR-SUBMISSION-001 Submit Assignment

Actor:
Student

Inputs:

* Assignment File

Supported Formats:

* PDF
* DOCX
* XLSX
* PPTX
* ZIP

Business Rules:

* Maximum file size = 10 MB.
* Submission must occur before deadline.
* Late submission status shall be recorded.

Outputs:

* Submission created.

---

## BR-SUBMISSION-002 Submission Versioning

Description:

Every resubmission creates a new version.

Example:

Version 1
Version 2
Version 3

Business Rules:

* Latest version is active.
* Previous versions remain immutable.

---

## BR-SUBMISSION-003 Submission Confirmation Email

Trigger:

Successful submission.

Email Content:

* Student Name
* Subject
* Assignment
* Submission Time
* Version Number

---

# 9. AI DECLARATION REQUIREMENTS

## BR-AI-001 AI Declaration Requirement

Description:

Assignments may require AI declaration.

Configuration:

* Require AI Declaration
* Minimum Interactions
* Maximum Interactions

Business Rules:

* If required, submission cannot be finalized until requirement satisfied.

---

## BR-AI-002 Create AI Interaction

Actor:
Student

Required Fields:

* AI Tool
* Usage Purpose
* Prompt
* Response Summary
* Decision
* Reflection

Outputs:

* Interaction stored.

---

## BR-AI-003 AI Tool Types

Allowed Values:

* CHATGPT
* GEMINI
* CLAUDE
* COPILOT
* OTHER

---

## BR-AI-004 Usage Purpose Types

Allowed Values:

* BRAINSTORMING
* TOPIC_RESEARCH
* SUMMARIZATION
* WRITING_IMPROVEMENT
* CRITICAL_FEEDBACK
* METHODOLOGY_REVIEW
* DATA_ANALYSIS
* OTHER

---

## BR-AI-005 Decision Types

Allowed Values:

* ACCEPTED
* PARTIALLY_ACCEPTED
* REJECTED
* REFERENCE_ONLY

---

# 10. AI EVALUATION

## BR-AI-EVAL-001 Evaluate AI Usage

Description:

System evaluates transparency and responsible AI usage.

Evaluation Dimensions:

* Prompt Quality
* Reflection Quality
* Critical Thinking
* AI Dependency

Outputs:

* Transparency Score

Range:

0 - 100

---

## BR-AI-EVAL-002 Transparency Score

Business Rules:

* Transparency Score does NOT affect academic grade.
* Transparency Score is reported separately.

---

# 11. REVIEW MANAGEMENT

## BR-REVIEW-001 Review Submission

Actor:
Lecturer

Review Status:

* PENDING
* REVIEWED
* NEEDS_REVISION
* FLAGGED

Outputs:

* Updated review record.

---

# 12. GRADING MANAGEMENT

## BR-GRADE-001 Grade Submission

Actor:
Lecturer

Inputs:

* Score
* Feedback

Business Rules:

* Score cannot exceed Max Score.

Outputs:

* Grade created.

---

## BR-GRADE-002 Gradebook

Actor:
Lecturer

Capabilities:

* View class grades.
* Update grades.
* Export grades.

Supported Export Formats:

* Excel
* CSV

---

# 13. NOTIFICATION REQUIREMENTS

## BR-NOTIFY-001 Assignment Created

Trigger:

Assignment published.

Recipients:

Students.

---

## BR-NOTIFY-002 Submission Successful

Trigger:

Student submission.

Recipients:

Student.

---

## BR-NOTIFY-003 Deadline Reminder

Trigger:

Before deadline.

Reminder Schedule:

* 24 hours
* 12 hours
* 1 hour

---

## BR-NOTIFY-004 Grade Published

Trigger:

Grade released.

Recipients:

Student.

---

# 14. REALTIME CHAT REQUIREMENTS

## BR-CHAT-001 Student ↔ Lecturer Chat

Condition:

Lecturer teaches student's subject.

---

## BR-CHAT-002 Student ↔ Student Chat

Condition:

Students belong to same class.

---

## BR-CHAT-003 Lecturer ↔ Subject Head Chat

Condition:

Same department.

---

## BR-CHAT-004 Message Types

Supported:

* TEXT
* IMAGE
* FILE

---

## BR-CHAT-005 Chat Features

Supported:

* Online Status
* Last Seen
* Unread Count
* Search Messages

---

# 15. REPORTING & ANALYTICS

## BR-REPORT-001 Lecturer Dashboard

Metrics:

* Total Classes
* Total Students
* Pending Reviews
* Average Score
* AI Usage Distribution

---

## BR-REPORT-002 Subject Head Dashboard

Metrics:

* AI Usage By Class
* AI Usage By Subject
* Average Score
* Pass Rate
* Lecturer Activity

---

## BR-REPORT-003 Administrator Dashboard

Metrics:

* Total Users
* Total Classes
* Total Subjects
* Total Submissions
* Total AI Interactions

---

# 16. FLAG MANAGEMENT

## BR-FLAG-001 Create Flag

Flag Types:

* LOW_QUALITY_PROMPT
* HIGH_AI_DEPENDENCY
* WEAK_REFLECTION
* ALL_RESPONSES_ACCEPTED
* MISSING_AI_INTERACTIONS
* SUSPICIOUS_DECLARATION
* MANUAL

---

## BR-FLAG-002 Flag Severity

Allowed Values:

* LOW
* MEDIUM
* HIGH

---

## BR-FLAG-003 Resolve Flag

Authorized Roles:

* Lecturer
* Subject Head

Outputs:

* Flag status updated.

---

# 17. CORE PHILOSOPHY

The purpose of ART-AI is not to detect AI-generated content.

The purpose of ART-AI is to promote:

* Transparency
* Accountability
* Responsible AI Usage
* Critical Thinking

through structured declaration, reflection, evaluation and academic monitoring.
