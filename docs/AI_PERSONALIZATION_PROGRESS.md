# AI Personalization Progress

## Phase 1 â€” Student Learning Profile

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
