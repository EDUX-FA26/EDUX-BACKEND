const { pool } = require('../../config/db.config');

const sources = {
  class: `
    SELECT c.id, 'class'::text AS type, c.class_code::text AS title,
           s.name::text AS description, sem.name::text AS subtitle, c.created_at
    FROM classes c
    JOIN subjects s ON s.id = c.subject_id
    JOIN semesters sem ON sem.id = c.semester_id
    WHERE c.is_active = true AND s.is_active = true
      AND (c.class_code ILIKE $1 OR s.name ILIKE $1 OR s.code ILIKE $1)
      AND ($3 = 'admin' OR ($3 = 'lecturer' AND c.lecturer_id = $2)
        OR ($3 = 'student' AND EXISTS (
          SELECT 1 FROM class_members cm WHERE cm.class_id = c.id
            AND cm.student_id = $2 AND cm.status = 'active'
        )))`,
  assignment: `
    SELECT a.id, 'assignment'::text AS type, a.title::text AS title,
           a.description::text AS description, c.class_code::text AS subtitle, a.created_at
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE c.is_active = true
      AND (a.title ILIKE $1 OR a.description ILIKE $1 OR c.class_code ILIKE $1)
      AND ($3 = 'admin' OR ($3 = 'lecturer' AND c.lecturer_id = $2)
        OR ($3 = 'student' AND a.publish_status = 'published' AND EXISTS (
          SELECT 1 FROM class_members cm WHERE cm.class_id = c.id
            AND cm.student_id = $2 AND cm.status = 'active'
        )))`,
  material: `
    SELECT m.id, 'material'::text AS type, m.title::text AS title,
           m.description::text AS description, c.class_code::text AS subtitle, m.created_at
    FROM class_materials m
    JOIN classes c ON c.id = m.class_id
    WHERE c.is_active = true
      AND (m.title ILIKE $1 OR m.description ILIKE $1 OR m.file_name ILIKE $1)
      AND ($3 = 'admin' OR ($3 = 'lecturer' AND c.lecturer_id = $2)
        OR ($3 = 'student' AND EXISTS (
          SELECT 1 FROM class_members cm WHERE cm.class_id = c.id
            AND cm.student_id = $2 AND cm.status = 'active'
        )))`,
  flashcard: `
    SELECT fd.id, 'flashcard'::text AS type, fd.title::text AS title,
           fd.description::text AS description, s.name::text AS subtitle, fd.created_at
    FROM flashcard_decks fd
    JOIN subjects s ON s.id = fd.subject_id
    WHERE fd.is_active = true AND s.is_active = true
      AND (fd.title ILIKE $1 OR fd.description ILIKE $1 OR s.name ILIKE $1)
      AND ($3 = 'admin' OR ($3 = 'lecturer' AND (fd.is_public = true OR fd.created_by = $2))
        OR ($3 = 'student' AND (fd.is_public = true OR EXISTS (
          SELECT 1 FROM class_members cm WHERE cm.class_id = fd.class_id
            AND cm.student_id = $2 AND cm.status = 'active'
        ))))`,
};

module.exports = {
  async search({ q, type, page, limit }, user) {
    const selected = type ? [sources[type]] : Object.values(sources);
    const union = selected.join('\nUNION ALL\n');
    const values = [`%${q}%`, user.id, user.role];
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM (${union}) results`, values);
    const result = await pool.query(
      `SELECT * FROM (${union}) results ORDER BY created_at DESC, type, id LIMIT $4 OFFSET $5`,
      [...values, limit, (page - 1) * limit]
    );
    return { data: result.rows, total: count.rows[0].total };
  },
};
