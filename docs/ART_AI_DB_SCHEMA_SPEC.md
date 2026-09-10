# ART-AI Mongoose Database Schema Specification

Version: 2.0  
Status: Revised for New Business Requirements  
Project: ART-AI (Academic Research Transparency & AI Audit System)

---

# 1. Overview

This document defines the MongoDB/Mongoose schema design for ART-AI after updating the business direction from a pure AI transparency audit system into an academic learning management and AI transparency platform.

ART-AI is not:

- An AI detector
- A plagiarism checker
- An AI-generated percentage checker

ART-AI focuses on:

- Student authentication by StudentCode + password
- Semester, subject, class and learning session management
- Assignment creation and submission
- Submission versioning
- AI usage declaration
- AI usage evaluation
- Lecturer review and grading
- Notifications and email logs
- Realtime chat between users
- Reporting and academic analytics

---

# 2. MongoDB Design Strategy

ART-AI uses a hybrid MongoDB design.

The system uses:

- `ObjectId` references for accurate querying and data relationships
- Embedded snapshots for frequently displayed information

## 2.1 Design Rule

Use this rule:

```text
ID for query.
Snapshot for fast display.
```

Example:

```js
{
  subjectId: ObjectId("..."),

  subjectSnapshot: {
    code: "SWD392",
    name: "Software Architecture and Design"
  }
}
```

The system queries by `subjectId`, but displays `subjectSnapshot` without extra lookup.

---

## 2.2 Snapshot Decision

The system should snapshot:

- Subject information inside Class
- Lecturer information inside Class
- Student information inside Class
- Assignment information inside Submission
- Student information inside Submission
- Class information inside Submission
- Sender information inside Chat Message if needed

The system should NOT snapshot semester inside Class by default.

Reason:

- Semester data is small and rarely changes.
- Semester is mainly used as a filter.
- Storing only `semesterId` keeps Class schema cleaner.

---

# 3. Common Setup

```js
const mongoose = require('mongoose')
const { Schema } = mongoose
```

---

# 4. Common Sub-Schemas

## 4.1 Subject Snapshot Schema

```js
const SubjectSnapshotSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    }
  },
  { _id: false }
)
```

---

## 4.2 Lecturer Snapshot Schema

```js
const LecturerSnapshotSchema = new Schema(
  {
    lecturerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    }
  },
  { _id: false }
)
```

---

## 4.3 Student Snapshot Schema

```js
const StudentSnapshotSchema = new Schema(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    studentCode: {
      type: String,
      required: true,
      trim: true
    },
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    }
  },
  { _id: false }
)
```

---

## 4.4 File Metadata Schema

```js
const FileMetadataSchema = new Schema(
  {
    originalName: {
      type: String,
      required: true,
      trim: true
    },
    storageKey: {
      type: String,
      required: true
    },
    mimeType: {
      type: String,
      required: true
    },
    fileSize: {
      type: Number,
      required: true,
      min: 0
    },
    fileUrl: {
      type: String,
      default: null
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
)
```

---

# 5. User Schema

Stores all users in the system.

Roles:

- student
- lecturer
- subject_head
- admin

Students authenticate using `studentCode + password`.

Staff users authenticate using `username/email + password`.

```js
const UserSchema = new Schema(
  {
    uuid: {
      type: String,
      required: true,
      unique: true
    },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true
    },

    username: {
      type: String,
      default: null,
      trim: true
    },

    passwordHash: {
      type: String,
      required: true
    },

    fullName: {
      type: String,
      required: true,
      trim: true
    },

    studentCode: {
      type: String,
      default: null,
      trim: true
    },

    role: {
      type: String,
      required: true,
      enum: ['student', 'lecturer', 'subject_head', 'admin']
    },

    departmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Department',
      default: null
    },

    isActive: {
      type: Boolean,
      default: true
    },

    profile: {
      type: Object,
      default: {}
    },

    lastLoginAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
)

UserSchema.index({ email: 1 }, { unique: true })
UserSchema.index({ username: 1 }, { unique: true, sparse: true })
UserSchema.index({ studentCode: 1 }, { unique: true, sparse: true })
UserSchema.index({ role: 1 })
UserSchema.index({ departmentId: 1 })

const User = mongoose.model('User', UserSchema)
```

---

# 6. Department Schema

Stores academic departments or subject groups.

Example:

- Software Engineering
- Information Systems
- Artificial Intelligence

```js
const DepartmentSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },

    name: {
      type: String,
      required: true,
      trim: true
    },

    subjectHeadId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
)

DepartmentSchema.index({ code: 1 }, { unique: true })
DepartmentSchema.index({ subjectHeadId: 1 })

const Department = mongoose.model('Department', DepartmentSchema)
```

---

# 7. Semester Schema

Stores academic semesters.

Examples:

- Spring 2026
- Summer 2026
- Fall 2026

```js
const SemesterSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },

    name: {
      type: String,
      required: true,
      trim: true
    },

    academicYear: {
      type: String,
      required: true,
      trim: true
    },

    startDate: {
      type: Date,
      required: true
    },

    endDate: {
      type: Date,
      required: true
    },

    isCurrent: {
      type: Boolean,
      default: false
    },

    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
)

SemesterSchema.index({ code: 1 }, { unique: true })
SemesterSchema.index({ isCurrent: 1 })
SemesterSchema.index({ academicYear: 1 })

const Semester = mongoose.model('Semester', SemesterSchema)
```

---

# 8. Subject Schema

Stores master data for subjects.

Examples:

- SWD392
- PRM392
- SWT301

```js
const SubjectSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },

    name: {
      type: String,
      required: true,
      trim: true
    },

    description: {
      type: String,
      default: ''
    },

    departmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Department',
      default: null
    },

    credits: {
      type: Number,
      default: 0,
      min: 0
    },

    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
)

SubjectSchema.index({ code: 1 }, { unique: true })
SubjectSchema.index({ departmentId: 1 })

const Subject = mongoose.model('Subject', SubjectSchema)
```

---

# 9. Class Schema

Stores classes opened for a specific semester and subject.

Examples:

- SE18D01
- SE18B01

Important:

- `semesterId` is stored as an ObjectId reference only.
- Semester snapshot is not embedded by default.
- `subjectSnapshot`, `lecturerSnapshot`, and `studentSnapshots` are embedded for fast display.

```js
const ClassSchema = new Schema(
  {
    classCode: {
      type: String,
      required: true,
      trim: true
    },

    semesterId: {
      type: Schema.Types.ObjectId,
      ref: 'Semester',
      required: true
    },

    subjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Subject',
      required: true
    },

    subjectSnapshot: {
      type: SubjectSnapshotSchema,
      required: true
    },

    lecturerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    lecturerSnapshot: {
      type: LecturerSnapshotSchema,
      required: true
    },

    studentSnapshots: {
      type: [StudentSnapshotSchema],
      default: []
    },

    maxStudents: {
      type: Number,
      default: 0,
      min: 0
    },

    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
)

ClassSchema.index({ classCode: 1, semesterId: 1, subjectId: 1 }, { unique: true })
ClassSchema.index({ semesterId: 1 })
ClassSchema.index({ subjectId: 1 })
ClassSchema.index({ lecturerId: 1 })
ClassSchema.index({ 'studentSnapshots.studentId': 1 })

const Class = mongoose.model('Class', ClassSchema)
```

---

# 10. Class Member Schema

Stores student membership in classes.

Although `Class` embeds `studentSnapshots`, this collection is recommended for:

- Fast lookup by student
- Avoiding very large class documents
- Querying student enrolled subjects
- Checking chat permissions
- Checking submission permissions

```js
const ClassMemberSchema = new Schema(
  {
    classId: {
      type: Schema.Types.ObjectId,
      ref: 'Class',
      required: true
    },

    semesterId: {
      type: Schema.Types.ObjectId,
      ref: 'Semester',
      required: true
    },

    subjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Subject',
      required: true
    },

    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    studentSnapshot: {
      type: StudentSnapshotSchema,
      required: true
    },

    status: {
      type: String,
      enum: ['active', 'dropped', 'completed'],
      default: 'active'
    }
  },
  { timestamps: true }
)

ClassMemberSchema.index({ classId: 1, studentId: 1 }, { unique: true })
ClassMemberSchema.index({ studentId: 1, semesterId: 1 })
ClassMemberSchema.index({ classId: 1 })

const ClassMember = mongoose.model('ClassMember', ClassMemberSchema)
```

---

# 11. Session Schema

Stores learning slots/sessions inside a class.

A subject may have multiple sessions.  
A class has its own sessions because each lecturer may upload different materials or assignments.

Example:

- Session 1
- Session 2
- Session 3
- ...
- Session 20

Pagination rule:

- 10 sessions per page in UI

```js
const SessionSchema = new Schema(
  {
    uuid: {
      type: String,
      required: true,
      unique: true
    },

    parentSessionId: {
      type: Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
      description: 'Used for Master Syllabus. If a slot is synced to a class, it references the master slot here.'
    },

    classId: {
      type: Schema.Types.ObjectId,
      ref: 'Class',
      default: null,
      description: 'Optional. If null, this is a Master Session belonging to the Subject.'
    },

    semesterId: {
      type: Schema.Types.ObjectId,
      ref: 'Semester',
      required: true
    },

    subjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Subject',
      required: true
    },

    title: {
      type: String,
      required: true,
      trim: true
    },

    description: {
      type: String,
      default: ''
    },

    sessionNo: {
      type: Number,
      required: true,
      min: 1
    },

    learningDate: {
      type: Date,
      default: null
    },

    materials: {
      type: [FileMetadataSchema],
      default: []
    },

    isPublished: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
)

SessionSchema.index({ classId: 1, sessionNo: 1 }, { unique: true })
SessionSchema.index({ semesterId: 1, subjectId: 1 })
SessionSchema.index({ classId: 1 })

const Session = mongoose.model('Session', SessionSchema)
```

---

# 12. Assignment Schema

Stores assignments inside sessions.

This replaces the old `GradeItem` concept.

An assignment may also be a grading item if it has `weight > 0`.

```js
const AssignmentSchema = new Schema(
  {
    uuid: {
      type: String,
      required: true,
      unique: true
    },

    parentAssignmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Assignment',
      default: null,
      description: 'Used for Global Assignments. When an assignment is pushed to multiple classes, they share the same parentAssignmentId.'
    },

    classId: {
      type: Schema.Types.ObjectId,
      ref: 'Class',
      default: null,
      description: 'Optional. If null, this is a Global Assignment.'
    },

    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
      description: 'Optional. If null, the assignment is not tied to a specific session.'
    },

    semesterId: {
      type: Schema.Types.ObjectId,
      ref: 'Semester',
      required: true
    },

    subjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Subject',
      required: true
    },

    title: {
      type: String,
      required: true,
      trim: true
    },

    description: {
      type: String,
      default: ''
    },

    instructions: {
      type: String,
      default: ''
    },

    materials: {
      type: [FileMetadataSchema],
      default: []
    },

    deadline: {
      type: Date,
      required: true
    },

    maxScore: {
      type: Number,
      default: 10,
      min: 0
    },

    weight: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },

    aiDeclarationRequired: {
      type: Boolean,
      default: true
    },

    minAiInteractions: {
      type: Number,
      default: 1,
      min: 0
    },

    maxAiInteractions: {
      type: Number,
      default: 20,
      min: 0
    },

    allowLateSubmission: {
      type: Boolean,
      default: true
    },

    publishStatus: {
      type: String,
      enum: ['draft', 'published', 'closed'],
      default: 'draft'
    },

    publishedAt: {
      type: Date,
      default: null
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  { timestamps: true }
)

AssignmentSchema.index({ uuid: 1 }, { unique: true })
AssignmentSchema.index({ classId: 1, sessionId: 1 })
AssignmentSchema.index({ semesterId: 1, subjectId: 1 })
AssignmentSchema.index({ deadline: 1 })
AssignmentSchema.index({ publishStatus: 1 })

const Assignment = mongoose.model('Assignment', AssignmentSchema)
```

---

# 13. Submission Schema

Stores the logical submission record for one student and one assignment.

A submission may have multiple versions.

```js
const SubmissionSchema = new Schema(
  {
    uuid: {
      type: String,
      required: true,
      unique: true
    },

    assignmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Assignment',
      required: true
    },

    classId: {
      type: Schema.Types.ObjectId,
      ref: 'Class',
      required: true
    },

    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'Session',
      required: true
    },

    semesterId: {
      type: Schema.Types.ObjectId,
      ref: 'Semester',
      required: true
    },

    subjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Subject',
      required: true
    },

    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    studentSnapshot: {
      type: StudentSnapshotSchema,
      required: true
    },

    latestVersionNo: {
      type: Number,
      default: 1,
      min: 1
    },

    status: {
      type: String,
      enum: [
        'pending',
        'submitted',
        'resubmitted',
        'late',
        'evaluated',
        'reviewed',
        'graded',
        'flagged',
        'withdrawn'
      ],
      default: 'submitted'
    },

    submittedAt: {
      type: Date,
      default: Date.now
    },

    lastSubmittedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
)

SubmissionSchema.index({ uuid: 1 }, { unique: true })
SubmissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true })
SubmissionSchema.index({ studentId: 1, semesterId: 1 })
SubmissionSchema.index({ classId: 1, assignmentId: 1 })
SubmissionSchema.index({ subjectId: 1, semesterId: 1 })

const Submission = mongoose.model('Submission', SubmissionSchema)
```

---

# 14. Submission Version Schema

Stores every submitted file version.

Uploaded files are final academic artifacts only.

The system does not detect AI-generated content from these files.

Supported submission formats:

- PDF
- DOCX
- XLSX
- PPTX
- ZIP

Maximum file size:

- 10 MB

This limit should be validated at API/middleware level.

```js
const SubmissionVersionSchema = new Schema(
  {
    submissionId: {
      type: Schema.Types.ObjectId,
      ref: 'Submission',
      required: true
    },

    assignmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Assignment',
      required: true
    },

    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    versionNo: {
      type: Number,
      required: true,
      min: 1
    },

    files: {
      type: [FileMetadataSchema],
      required: true,
      default: []
    },

    contentHash: {
      type: String,
      default: null
    },

    note: {
      type: String,
      default: ''
    },

    submittedAt: {
      type: Date,
      default: Date.now
    },

    isLatest: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
)

SubmissionVersionSchema.index({ submissionId: 1, versionNo: 1 }, { unique: true })
SubmissionVersionSchema.index({ submissionId: 1, isLatest: 1 })
SubmissionVersionSchema.index({ assignmentId: 1, studentId: 1 })

const SubmissionVersion = mongoose.model('SubmissionVersion', SubmissionVersionSchema)
```

---

# 15. AI Interaction Schema

Stores student-declared AI interactions.

Each interaction should belong to a submission version because AI declaration may change between resubmissions.

```js
const AiInteractionSchema = new Schema(
  {
    uuid: {
      type: String,
      required: true,
      unique: true
    },

    submissionId: {
      type: Schema.Types.ObjectId,
      ref: 'Submission',
      required: true
    },

    submissionVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'SubmissionVersion',
      required: true
    },

    assignmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Assignment',
      required: true
    },

    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    aiTool: {
      type: String,
      required: true,
      enum: ['chatgpt', 'gemini', 'claude', 'copilot', 'other']
    },

    usagePurpose: {
      type: String,
      required: true,
      enum: [
        'brainstorming',
        'topic_research',
        'summarization',
        'writing_improvement',
        'critical_feedback',
        'methodology_review',
        'data_analysis',
        'other'
      ]
    },

    promptContent: {
      type: String,
      required: true
    },

    aiResponseSummary: {
      type: String,
      required: true
    },

    studentDecision: {
      type: String,
      required: true,
      enum: ['accepted', 'partially_accepted', 'rejected', 'reference_only']
    },

    reflectionText: {
      type: String,
      required: true
    }
  },
  { timestamps: true }
)

AiInteractionSchema.index({ uuid: 1 }, { unique: true })
AiInteractionSchema.index({ submissionId: 1 })
AiInteractionSchema.index({ submissionVersionId: 1 })
AiInteractionSchema.index({ assignmentId: 1, studentId: 1 })

const AiInteraction = mongoose.model('AiInteraction', AiInteractionSchema)
```

---

# 16. AI Evaluation Schema

Stores AI usage evaluation results.

The system evaluates how students use AI, not whether AI wrote the final submission.

```js
const AiEvaluationSchema = new Schema(
  {
    submissionId: {
      type: Schema.Types.ObjectId,
      ref: 'Submission',
      required: true
    },

    submissionVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'SubmissionVersion',
      required: true
    },

    assignmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Assignment',
      required: true
    },

    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    classId: {
      type: Schema.Types.ObjectId,
      ref: 'Class',
      required: true
    },

    pattern: {
      type: String,
      required: true,
      enum: [
        'critical_engagement',
        'collaborative_usage',
        'passive_usage',
        'high_dependency'
      ]
    },

    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low'
    },

    transparencyScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },

    promptQualityScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },

    reflectionQualityScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },

    criticalThinkingScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },

    aiDependencyScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },

    summary: {
      type: String,
      default: ''
    },

    evaluatedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
)

AiEvaluationSchema.index({ submissionVersionId: 1 }, { unique: true })
AiEvaluationSchema.index({ submissionId: 1 })
AiEvaluationSchema.index({ assignmentId: 1 })
AiEvaluationSchema.index({ studentId: 1 })
AiEvaluationSchema.index({ classId: 1 })

const AiEvaluation = mongoose.model('AiEvaluation', AiEvaluationSchema)
```

---

# 17. Submission Flag Schema

Stores flags related to suspicious or problematic AI usage behavior.

Flags are not plagiarism detection and are not AI-generated text detection.

```js
const SubmissionFlagSchema = new Schema(
  {
    submissionId: {
      type: Schema.Types.ObjectId,
      ref: 'Submission',
      required: true
    },

    submissionVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'SubmissionVersion',
      default: null
    },

    assignmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Assignment',
      required: true
    },

    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    classId: {
      type: Schema.Types.ObjectId,
      ref: 'Class',
      required: true
    },

    flagType: {
      type: String,
      required: true,
      enum: [
        'low_quality_prompt',
        'high_ai_dependency',
        'weak_reflection',
        'all_responses_accepted',
        'missing_ai_interactions',
        'suspicious_declaration',
        'manual'
      ]
    },

    description: {
      type: String,
      default: ''
    },

    flaggedBy: {
      type: String,
      enum: ['system', 'lecturer', 'subject_head'],
      required: true
    },

    flaggedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    suspectLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low'
    },

    status: {
      type: String,
      enum: ['open', 'reviewed', 'resolved', 'dismissed'],
      default: 'open'
    },

    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    resolvedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
)

SubmissionFlagSchema.index({ submissionId: 1 })
SubmissionFlagSchema.index({ assignmentId: 1 })
SubmissionFlagSchema.index({ classId: 1, suspectLevel: 1 })
SubmissionFlagSchema.index({ studentId: 1 })
SubmissionFlagSchema.index({ status: 1 })

const SubmissionFlag = mongoose.model('SubmissionFlag', SubmissionFlagSchema)
```

---

# 18. Submission Review Schema

Stores lecturer review comments and review status.

```js
const SubmissionReviewSchema = new Schema(
  {
    submissionId: {
      type: Schema.Types.ObjectId,
      ref: 'Submission',
      required: true
    },

    submissionVersionId: {
      type: Schema.Types.ObjectId,
      ref: 'SubmissionVersion',
      default: null
    },

    lecturerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    reviewStatus: {
      type: String,
      enum: ['pending', 'reviewed', 'needs_revision', 'flagged'],
      default: 'pending'
    },

    comment: {
      type: String,
      default: ''
    },

    reviewedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
)

SubmissionReviewSchema.index({ submissionId: 1 })
SubmissionReviewSchema.index({ submissionVersionId: 1 })
SubmissionReviewSchema.index({ lecturerId: 1 })

const SubmissionReview = mongoose.model('SubmissionReview', SubmissionReviewSchema)
```

---

# 19. Grade Schema

Stores lecturer grading result for a student assignment.

Academic grade is independent from AI transparency score.

```js
const GradeSchema = new Schema(
  {
    submissionId: {
      type: Schema.Types.ObjectId,
      ref: 'Submission',
      required: true,
      unique: true
    },

    assignmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Assignment',
      required: true
    },

    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    classId: {
      type: Schema.Types.ObjectId,
      ref: 'Class',
      required: true
    },

    score: {
      type: Number,
      required: true,
      min: 0
    },

    maxScore: {
      type: Number,
      default: 10,
      min: 0
    },

    feedback: {
      type: String,
      default: ''
    },

    gradedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    gradedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
)

GradeSchema.index({ submissionId: 1 }, { unique: true })
GradeSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true })
GradeSchema.index({ classId: 1 })
GradeSchema.index({ studentId: 1 })

const Grade = mongoose.model('Grade', GradeSchema)
```

---

# 20. Final Result Schema

Stores final weighted result of a student in a class.

Formula:

```text
Final Score = Σ(Assignment Score × Assignment Weight)
```

```js
const FinalResultSchema = new Schema(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    classId: {
      type: Schema.Types.ObjectId,
      ref: 'Class',
      required: true
    },

    semesterId: {
      type: Schema.Types.ObjectId,
      ref: 'Semester',
      required: true
    },

    subjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Subject',
      required: true
    },

    finalScore: {
      type: Number,
      required: true,
      min: 0,
      max: 10
    },

    classification: {
      type: String,
      required: true,
      enum: ['poor', 'average', 'good', 'very_good', 'excellent']
    },

    calculatedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
)

FinalResultSchema.index({ studentId: 1, classId: 1 }, { unique: true })
FinalResultSchema.index({ classId: 1 })
FinalResultSchema.index({ semesterId: 1, subjectId: 1 })

const FinalResult = mongoose.model('FinalResult', FinalResultSchema)
```

---

# 21. Notification Schema

Stores in-app notifications.

Email sending should also create an EmailLog record.

```js
const NotificationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    title: {
      type: String,
      required: true
    },

    message: {
      type: String,
      required: true
    },

    type: {
      type: String,
      required: true,
      enum: [
        'assignment_created',
        'assignment_updated',
        'deadline_reminder',
        'submission_success',
        'submission_reviewed',
        'flag_created',
        'grade_published',
        'final_result_released',
        'chat_message',
        'system_announcement'
      ]
    },

    relatedEntityType: {
      type: String,
      default: null
    },

    relatedEntityId: {
      type: Schema.Types.ObjectId,
      default: null
    },

    isRead: {
      type: Boolean,
      default: false
    },

    readAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
)

NotificationSchema.index({ userId: 1, isRead: 1 })
NotificationSchema.index({ type: 1 })
NotificationSchema.index({ relatedEntityType: 1, relatedEntityId: 1 })

const Notification = mongoose.model('Notification', NotificationSchema)
```

---

# 22. Email Log Schema

Stores email delivery history.

Examples:

- Assignment published email
- Submission confirmation email
- Deadline reminder email
- Grade published email
- Password reset email

```js
const EmailLogSchema = new Schema(
  {
    to: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },

    subject: {
      type: String,
      required: true
    },

    body: {
      type: String,
      required: true
    },

    type: {
      type: String,
      enum: [
        'assignment_created',
        'deadline_reminder',
        'submission_success',
        'grade_published',
        'password_reset',
        'system'
      ],
      required: true
    },

    status: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending'
    },

    errorMessage: {
      type: String,
      default: ''
    },

    sentAt: {
      type: Date,
      default: null
    },

    relatedEntityType: {
      type: String,
      default: null
    },

    relatedEntityId: {
      type: Schema.Types.ObjectId,
      default: null
    }
  },
  { timestamps: true }
)

EmailLogSchema.index({ to: 1 })
EmailLogSchema.index({ type: 1 })
EmailLogSchema.index({ status: 1 })

const EmailLog = mongoose.model('EmailLog', EmailLogSchema)
```

---

# 23. Chat Room Schema

Stores chat room metadata.

Supported chat types:

- student_lecturer
- student_student
- lecturer_subject_head
- subject_head_student
- group

```js
const ChatRoomSchema = new Schema(
  {
    type: {
      type: String,
      enum: [
        'student_lecturer',
        'student_student',
        'lecturer_subject_head',
        'subject_head_student',
        'group'
      ],
      required: true
    },

    name: {
      type: String,
      default: ''
    },

    classId: {
      type: Schema.Types.ObjectId,
      ref: 'Class',
      default: null
    },

    subjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Subject',
      default: null
    },

    semesterId: {
      type: Schema.Types.ObjectId,
      ref: 'Semester',
      default: null
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    lastMessageAt: {
      type: Date,
      default: null
    },

    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
)

ChatRoomSchema.index({ type: 1 })
ChatRoomSchema.index({ classId: 1 })
ChatRoomSchema.index({ subjectId: 1 })
ChatRoomSchema.index({ semesterId: 1 })
ChatRoomSchema.index({ lastMessageAt: -1 })

const ChatRoom = mongoose.model('ChatRoom', ChatRoomSchema)
```

---

# 24. Chat Member Schema

Stores members of each chat room.

This supports filtering and authorization.

```js
const ChatMemberSchema = new Schema(
  {
    roomId: {
      type: Schema.Types.ObjectId,
      ref: 'ChatRoom',
      required: true
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    roleAtRoom: {
      type: String,
      enum: ['student', 'lecturer', 'subject_head', 'admin'],
      required: true
    },

    joinedAt: {
      type: Date,
      default: Date.now
    },

    lastReadAt: {
      type: Date,
      default: null
    },

    isMuted: {
      type: Boolean,
      default: false
    },

    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
)

ChatMemberSchema.index({ roomId: 1, userId: 1 }, { unique: true })
ChatMemberSchema.index({ userId: 1 })
ChatMemberSchema.index({ roomId: 1 })

const ChatMember = mongoose.model('ChatMember', ChatMemberSchema)
```

---

# 25. Chat Message Schema

Stores realtime chat messages.

```js
const ChatMessageSchema = new Schema(
  {
    roomId: {
      type: Schema.Types.ObjectId,
      ref: 'ChatRoom',
      required: true
    },

    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    messageType: {
      type: String,
      enum: ['text', 'image', 'file'],
      default: 'text'
    },

    content: {
      type: String,
      default: ''
    },

    attachments: {
      type: [FileMetadataSchema],
      default: []
    },

    isDeleted: {
      type: Boolean,
      default: false
    },

    deletedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
)

ChatMessageSchema.index({ roomId: 1, createdAt: -1 })
ChatMessageSchema.index({ senderId: 1 })

const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema)
```

---

# 26. Refresh Token Schema

Stores refresh tokens for authentication.

```js
const RefreshTokenSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    tokenHash: {
      type: String,
      required: true,
      unique: true
    },

    expiresAt: {
      type: Date,
      required: true
    },

    revokedAt: {
      type: Date,
      default: null
    },

    userAgent: {
      type: String,
      default: ''
    },

    ipAddress: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
)

RefreshTokenSchema.index({ userId: 1 })
RefreshTokenSchema.index({ tokenHash: 1 }, { unique: true })
RefreshTokenSchema.index({ expiresAt: 1 })

const RefreshToken = mongoose.model('RefreshToken', RefreshTokenSchema)
```

---

# 27. Password Reset Token Schema

Stores password reset requests.

```js
const PasswordResetTokenSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    tokenHash: {
      type: String,
      required: true,
      unique: true
    },

    expiresAt: {
      type: Date,
      required: true
    },

    usedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
)

PasswordResetTokenSchema.index({ userId: 1 })
PasswordResetTokenSchema.index({ tokenHash: 1 }, { unique: true })
PasswordResetTokenSchema.index({ expiresAt: 1 })

const PasswordResetToken = mongoose.model('PasswordResetToken', PasswordResetTokenSchema)
```

---

# 28. Query Examples

## 28.1 Student Home - View Subjects by Current Semester

Step 1: Get current semester.

```js
const currentSemester = await Semester.findOne({ isCurrent: true })
```

Step 2: Find classes of current student.

```js
const classes = await ClassMember.find({
  studentId,
  semesterId: currentSemester._id,
  status: 'active'
})
  .populate('classId')
```

Because `Class` contains `subjectSnapshot`, the UI can display subject cards without extra Subject lookup.

---

## 28.2 Student Views Sessions of a Subject

```js
const sessions = await Session.find({
  classId,
  subjectId,
  semesterId,
  isPublished: true
})
  .sort({ sessionNo: 1 })
  .skip((page - 1) * 10)
  .limit(10)
```

---

## 28.3 Lecturer Views Classes

```js
const classes = await Class.find({
  lecturerId,
  semesterId,
  isActive: true
})
```

---

## 28.4 Lecturer Views Submissions of Assignment

```js
const submissions = await Submission.find({
  assignmentId,
  classId
})
```

---

## 28.5 Subject Head Views Classes by Department

Step 1: Find subjects in department.

```js
const subjects = await Subject.find({ departmentId })
const subjectIds = subjects.map(subject => subject._id)
```

Step 2: Find classes.

```js
const classes = await Class.find({
  semesterId,
  subjectId: { $in: subjectIds },
  isActive: true
})
```

---

# 29. Important Business Notes

## 29.1 Semester Snapshot Decision

`Class` does not embed `semesterSnapshot`.

Reason:

- Semester is usually used for filtering.
- Semester data is small.
- Semester rarely changes.
- Dropdown can query the `semesters` collection directly.

Recommended Class structure:

```js
{
  semesterId,

  subjectId,
  subjectSnapshot,

  lecturerId,
  lecturerSnapshot,

  studentSnapshots
}
```

---

## 29.2 Subject Snapshot Decision

`Class` embeds `subjectSnapshot`.

Reason:

- Subject code and name are displayed frequently.
- Student home needs fast subject cards.
- Lecturer class list needs fast subject display.

---

## 29.3 Student Snapshot Decision

`Class` embeds `studentSnapshots` for quick class detail display.

However, `ClassMember` is still required for scalable querying.

Use:

- `Class.studentSnapshots` for class detail display.
- `ClassMember` for querying student enrollment.

---

## 29.4 Assignment vs Grade Item

The old `GradeItem` collection should be replaced by `Assignment`.

Reason:

- Business now uses Session/Slot.
- Assignment belongs to Session.
- Assignment can have materials, deadline, AI requirement and grade weight.

If backward compatibility is needed, keep the model name `GradeItem` internally but rename the business concept to `Assignment`.

---

## 29.5 AI Evaluation vs Academic Grade

AI transparency score must not be mixed directly into academic score.

Store separately:

- `Grade.score`
- `AiEvaluation.transparencyScore`

---

# 30. Model Exports

```js
module.exports = {
  User,
  Department,
  Semester,
  Subject,
  Class,
  ClassMember,
  Session,
  Assignment,
  Submission,
  SubmissionVersion,
  AiInteraction,
  AiEvaluation,
  SubmissionFlag,
  SubmissionReview,
  Grade,
  FinalResult,
  Notification,
  EmailLog,
  ChatRoom,
  ChatMember,
  ChatMessage,
  RefreshToken,
  PasswordResetToken
}
```

---

# 23. News Schema

Stores system-wide announcements and news articles broadcasted by Admin or Subject Head.

```js
const NewsSchema = new Schema(
  {
    uuid: {
      type: String,
      required: true,
      unique: true
    },

    title: {
      type: String,
      required: true
    },

    content: {
      type: String, // HTML or Markdown
      required: true
    },

    coverImageUrl: {
      type: String,
      default: null
    },

    authorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    targetRole: {
      type: String,
      enum: ['LECTURER_ONLY', 'ALL'],
      default: 'LECTURER_ONLY'
    },

    isPublished: {
      type: Boolean,
      default: true
    },

    publishedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
)

NewsSchema.index({ publishedAt: -1 })
NewsSchema.index({ targetRole: 1 })

const News = mongoose.model('News', NewsSchema)
```

---

# 24. Test Schema

Stores Quiz/Test definitions. Like Assignments, Tests can be Global (subject-level) or Local (class-level).

```js
const QuestionSchema = new Schema(
  {
    type: { type: String, enum: ['MULTIPLE_CHOICE', 'CHECKBOX', 'TRUE_FALSE'], required: true },
    content: { type: String, required: true },
    options: [{ type: String }],
    correctAnswers: [{ type: String }],
    points: { type: Number, default: 1 }
  },
  { _id: true }
)

const TestSchema = new Schema(
  {
    uuid: { type: String, required: true, unique: true },
    parentTestId: { type: Schema.Types.ObjectId, ref: 'Test', default: null },
    classId: { type: Schema.Types.ObjectId, ref: 'Class', default: null },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    durationMinutes: { type: Number, required: true },
    questions: { type: [QuestionSchema], default: [] },
    showResultsToStudents: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
)

TestSchema.index({ subjectId: 1 })
TestSchema.index({ classId: 1 })
const Test = mongoose.model('Test', TestSchema)
```

---

# 25. TestAttempt Schema

Stores student attempts for a Test.

```js
const TestAttemptSchema = new Schema(
  {
    testId: { type: Schema.Types.ObjectId, ref: 'Test', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
    isCompleted: { type: Boolean, default: false },
    answers: [
      {
        questionId: { type: Schema.Types.ObjectId, required: true },
        selectedOptions: [{ type: String }],
        isCorrect: { type: Boolean, default: false }
      }
    ],
    score: { type: Number, default: 0 },
    maxScore: { type: Number, default: 0 }
  },
  { timestamps: true }
)

TestAttemptSchema.index({ testId: 1, studentId: 1 })
const TestAttempt = mongoose.model('TestAttempt', TestAttemptSchema)
```
