# AI Personalization Progress

## Phase 1 — Student Learning Profile

Status: implemented; pending review and integration verification.

- Endpoint: `GET /api/learning/profile?subjectId=<uuid>`.
- Authentication: uses `req.user.id`; endpoint is restricted to `student` users.
- Authorization: student must be an active member of an active class for the requested subject.
- Data: final lecturer-managed grades, submitted Flashcard Test attempts and answers, Flashcard Review ratings/history, authorized due SRS cards, and existing subject streak.
- No Gemini call, schema change, migration, Topic Mapping, or Dashboard work was added.

## Data semantics

- Assignment `scoreRate` is the unweighted percentage `sum(grades.score) / sum(grades.max_score) * 100`; it intentionally ignores `assignments.weight`.
- Only `grades` joined to a `submissions.status = 'graded'` record are included. Existing grading routes only allow lecturer/admin to write `grades`.
- Test aggregates include only `flashcard_tests.status = 'submitted'`. `totalAnswers` counts attempts/answers; `distinctFlashcardsAnswered` is separate.
- Review ratings remain `again`, `hard`, `good`, and `easy`; they are not labelled correct/incorrect.
- Due-date comparison uses `Asia/Ho_Chi_Minh`; output never exposes a due card's correct answer.

## Before Phase 2

- There is still no Topic Mapping table or `topic_id` column in the live schema.
- The current schema has no explicit `teacher_confirmed` grade state. Phase 1 treats a grade written by the lecturer/admin-only grading flow as final.
- Add integration fixtures for a real active student/class/subject before automated end-to-end profile tests.

## Phase 2 — Topic Mapping & Learning Analytics (planning checkpoint)

Status: audited and proposed; awaiting approval. No migration or runtime implementation has been applied.

- Live PostgreSQL has no Topic-related table or column. Flashcards belong to a subject only through `flashcards.deck_id -> flashcard_decks.subject_id`.
- Submitted Flashcard Test answers (`flashcard_test_answers.is_correct`) are the authoritative objective evidence for the MVP. Flashcard Review ratings must remain separate self-assessment signals and must not be treated as correct/incorrect.
- Proposed minimum schema: `topics` plus `flashcard_topics`; calculate analytics from submitted answers at read time. Do not introduce `student_topic_mastery` in the initial MVP because it is a cache/projection, not a source of truth.
- A migration must enforce that a topic belongs to the same subject as its flashcard's deck with a PostgreSQL trigger; ordinary foreign keys cannot enforce this cross-table invariant.
- Gemini classification should only select from supplied existing topic IDs, store mapping confidence/source/review status, never receive student identifiers, and fall back to `needs_review` on invalid structured output or 429/503.

## Phase 2A — Topic Mapping Database and Learning Analytics

Status: implemented; Gemini classification remains explicitly out of scope.

- Migration: `sql/20261014_topic_mapping.sql`. It creates `topics`, `flashcard_topics`, and `flashcard_topic_classifications`; it has not been run on NeonDB.
- The migration was applied successfully to a disposable local PostgreSQL Docker database with the required base tables, then that database was removed. It includes triggers that reject cross-subject mappings and cross-subject deck/card/topic changes, and marks non-rejected mappings pending review when Flashcard content changes.
- Manual management endpoints: `GET/POST /api/topics`, `PATCH /api/topics/:topicId`, and `PUT /api/topics/:topicId/flashcards/:flashcardId`. Lecturer access is restricted to an active class they teach for the subject; manual mapping can be approved, pending review, or rejected.
- Student analytics endpoint: `GET /api/learning/topics/performance?subjectId=<uuid>`. It accepts only active, approved mappings and active multiple-choice Flashcards/Decks from submitted tests.
- Accuracy uses every qualifying submitted answer. Mastery uses the newest submitted answer per distinct Flashcard and is smoothed with neutral prior 50 and weight 5. Under 3 distinct Flashcards returns insufficient evidence rather than a mastery score.
- Existing `is_public` versus class-access behavior was deliberately not changed. The new student analytics endpoint still requires active membership in the requested subject and additionally applies existing deck-access predicates when reading evidence.
