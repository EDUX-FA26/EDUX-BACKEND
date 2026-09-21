# Semesters, Subjects and Search APIs

These modules use Route → Controller → Service → Repository → `pg` Pool. No ORM or code entities are required.

## Database setup

Apply [`sql/20260921_semesters_lock.sql`](../sql/20260921_semesters_lock.sql) to the target PostgreSQL/Neon database before using the semester routes. It adds `is_locked` and a partial unique index so only one semester can be current. Review existing `is_current = true` rows first if the table has data.

The semester lifecycle is active → current (via `activate`) → closed (via `close`) → locked (via `lock`). A locked semester cannot be edited or reactivated. `activate` clears the previous current semester in one transaction. Subjects use soft delete (`is_active = false`) to preserve references from classes.

## Endpoints

All routes require a Bearer token. Semesters and Subjects require the `admin` role.

| Module | Routes |
| --- | --- |
| Semesters | `GET /api/semesters`, `GET /api/semesters/:id`, `POST /api/semesters`, `PATCH /api/semesters/:id`, `POST /api/semesters/:id/activate`, `POST /api/semesters/:id/close`, `POST /api/semesters/:id/lock` |
| Subjects | `GET /api/subjects`, `GET /api/subjects/:id`, `POST /api/subjects`, `PATCH /api/subjects/:id`, `DELETE /api/subjects/:id` |
| Search | `GET /api/search?q=term&type=assignment&page=1&limit=20` |

Search `type` may be `assignment`, `material`, `class`, or `flashcard`. Omit `type` to search all four. Flashcard search returns decks. Results are restricted to classes, assignments, materials, and decks the caller may access. Student assignment results include only published assignments.

Semester create requires `code`, `name`, `academic_year`, `start_date`, and `end_date` (ISO timestamps). Subject create requires `code` and `name`; optional fields are `description`, `department_id`, and `credits`.
