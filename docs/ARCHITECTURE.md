# ART-AI System Architecture

## Version

1.1

---

# 1. Purpose

This document defines the high-level architecture, project structure, coding conventions, module boundaries, and development workflow of ART-AI.

This document should be read together with:

* ART_AI_API_SPEC.md
* ART_AI_DB_SCHEMA_SPEC.md
* ART_AI_BUSINESS_SPEC.md

This file intentionally does not duplicate API definitions, database schemas, or business rules.

---

# 2. System Overview

## System Name

ART-AI

Academic Research Transparency & AI Audit System

---

## System Objective

ART-AI is a Comprehensive Academic Management & AI Transparency Portal. 
By providing essential daily services (like FPT Academic Portal), it naturally funnels students into a structured environment where it evaluates how they use Generative AI during academic work.

The system promotes:

* Transparency
* Accountability
* Responsible AI-assisted learning
* Critical thinking

---

# 3. Core Philosophy

ART-AI evaluates:

* How students use AI
* Whether students critically engage with AI responses
* Whether students reflect on AI suggestions
* Whether students depend excessively on AI

ART-AI does NOT evaluate:

* AI-generated percentage
* AI-generated text detection
* Plagiarism detection
* Turnitin-style similarity checking

The uploaded file is only the final academic artifact.

Core features:

```text
AI Interaction Declaration
AI Usage Evaluation
```

---

# 4. Technology Stack

| Layer            | Technology                      |
| ---------------- | ------------------------------- |
| Frontend         | ReactJS + TypeScript            |
| State Management | Redux Toolkit                   |
| Backend          | NodeJS + ExpressJS + TypeScript |
| Database         | MongoDB + Mongoose              |
| Object Storage   | MinIO / S3 Compatible Storage   |
| Authentication   | JWT + Refresh Token             |

---

# 5. Backend Project Structure

```text
src/
├── constants/
│   ├── enums.ts
│   ├── httpStatus.ts
│   └── messages.ts
│
├── models/
│   ├── requests/
│   └── schemas/
│
├── middlewares/
│   ├── auth.middlewares.ts
│   ├── validation.middlewares.ts
│   └── upload.middlewares.ts
│
├── controllers/
│   ├── auth.controllers.ts
│   ├── user.controllers.ts
│   ├── class.controllers.ts
│   ├── gradeItem.controllers.ts
│   ├── submission.controllers.ts
│   ├── aiInteraction.controllers.ts
│   ├── aiEvaluation.controllers.ts
│   ├── flag.controllers.ts
│   ├── review.controllers.ts
│   ├── grade.controllers.ts
│   ├── finalResult.controllers.ts
│   ├── report.controllers.ts
│   ├── attendance.controllers.ts
│   ├── curriculum.controllers.ts
│   └── transaction.controllers.ts
│
├── services/
│   ├── database.service.ts
│   ├── auth.services.ts
│   ├── user.services.ts
│   ├── class.services.ts
│   ├── gradeItem.services.ts
│   ├── submission.services.ts
│   ├── aiInteraction.services.ts
│   ├── aiEvaluation.services.ts
│   ├── flag.services.ts
│   ├── review.services.ts
│   ├── grade.services.ts
│   ├── finalResult.services.ts
│   ├── report.services.ts
│   ├── attendance.services.ts
│   ├── curriculum.services.ts
│   ├── transaction.services.ts
│   └── storage.services.ts
│
├── routes/
│   ├── auth.routes.ts
│   ├── user.routes.ts
│   ├── class.routes.ts
│   ├── gradeItem.routes.ts
│   ├── submission.routes.ts
│   ├── aiInteraction.routes.ts
│   ├── aiEvaluation.routes.ts
│   ├── flag.routes.ts
│   ├── review.routes.ts
│   ├── grade.routes.ts
│   ├── finalResult.routes.ts
│   ├── report.routes.ts
│   ├── attendance.routes.ts
│   ├── curriculum.routes.ts
│   └── transaction.routes.ts
│
├── utils/
│   ├── handlers.ts
│   ├── validation.ts
│   ├── jwt.ts
│   ├── crypto.ts
│   └── pagination.ts
│
└── index.ts
```

---

# 6. Request Flow

All requests must follow this flow:

```text
Client Request
 ↓
Route
 ↓
Authentication Middleware
 ↓
Authorization Middleware
 ↓
Validation Middleware
 ↓
Controller
 ↓
Service
 ↓
Database Service / Storage Service
 ↓
MongoDB / Object Storage
 ↓
Response
```

---

# 7. Layer Responsibilities

## Routes

Responsible for:

* Endpoint definitions
* Middleware registration
* Controller mapping

Must not contain:

* Business logic
* Database queries

---

## Middlewares

Responsible for:

* Authentication
* Authorization
* Validation
* File validation

Validation library:

```text
express-validator
```

---

## Controllers

Responsible for:

* Reading request data
* Calling services
* Returning responses

Must not contain:

* Business logic
* Database access
* Complex calculations

Use:

```text
wrapRequestHandler()
```

for async error handling.

---

## Services

Responsible for:

* Business logic
* Database operations
* AI evaluation
* Flag generation
* Grading
* Report generation
* Final score calculation

---

## Database Service

Database initialization and collection access should be centralized in:

```text
src/services/database.service.ts
```

---

# 8. Snapshot Strategy

ART-AI uses embedded snapshots inside the Class collection.

## Lecturer Snapshot

```ts
lecturer: {
  lecturerId: ObjectId,
  fullName: string,
  email: string
}
```

## Student Snapshot

```ts
students: [
  {
    studentId: ObjectId,
    studentCode: string,
    fullName: string,
    email: string
  }
]
```

### Benefits

* Faster class detail loading
* Easier report generation
* Fewer populate operations

### Tradeoff

Snapshot data does not automatically update when user profile changes.

Synchronization must be handled in the service layer.

---

# 9. File Storage Strategy

Submission files are stored in Object Storage.

Supported providers:

* MinIO
* AWS S3 Compatible Storage

MongoDB stores only metadata:

```text
fileName
fileStorageKey
fileSize
mimeType
contentHash
```

Files are NOT used for:

* AI detection
* Plagiarism detection
* AI-generated percentage calculation

---

# 10. Main Modules

* Authentication
* User Management
* Class Management
* Grade Item Management
* Submission Management
* AI Interaction Management
* AI Evaluation
* Lecturer Review
* Flag Management
* Grading
* Final Results
* Reporting
* Dashboard
* Academic Portal Services (Attendance, Curriculum, Transcript, Transactions)

---

# 11. External Documents

AI Agent must read these documents before generating code.

## Database Schema

```text
ART_AI_DB_SCHEMA_SPEC.md
```

Contains:

* Collections
* Mongoose schemas
* Indexes
* Relationships
* Snapshot structures

---

## API Specification

```text
ART_AI_API_SPEC.md
```

Contains:

* Endpoints
* Request contracts
* Response contracts
* Permissions

---

## Business Rules

```text
ART_AI_BUSINESS_SPEC.md
```

Contains:

* AI interaction rules
* Evaluation rules
* Flag rules
* Grading rules
* Classification rules

---

# 12. Development Priority

## Priority 1

Core academic workflow:

* Authentication
* User Management
* Class Management
* Grade Item Management
* Submission Management

---

## Priority 2

Core ART-AI functionality:

* AI Interaction Declaration
* AI Usage Evaluation

---

## Priority 3

Lecturer workflow:

* Lecturer Review
* Flag Management
* Grading

---

## Priority 4

Analytics and reporting:

* Final Results
* Academic Classification
* Reports
* Dashboard

---

# 13. AI Agent Rules

When generating code:

* Follow the project structure defined in this document.
* Read DB Schema before generating models.
* Read API Spec before generating routes/controllers.
* Read Business Spec before generating services.
* Keep controllers thin.
* Put all business logic in services.
* Use express-validator for validation.
* Use wrapRequestHandler() for async controllers.
* Do not implement AI detector logic.
* Do not implement plagiarism detection logic.
* Do not calculate AI-generated percentage from uploaded files.
* Treat uploaded files as final artifacts only.

---

# 14. Architecture Boundaries

ART-AI evaluates:

* AI interaction transparency
* Critical thinking
* Reflection quality
* AI dependency

ART-AI does not evaluate:

* AI-generated percentage
* AI-written text detection
* Plagiarism detection

The uploaded file is only the final academic artifact.

Core modules:

```text
AI Interaction Declaration
AI Usage Evaluation
Flag Management
Lecturer Review
```
