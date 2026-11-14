const { pool, withTransaction } = require('../../config/db.config');

const columns = ['code', 'name', 'academic_year', 'start_date', 'end_date'];

const SemestersRepository = {
  async list({ schoolId, page, limit, search, is_active, is_current, is_locked }) {
    const values = [schoolId];
    const where = ['semesters.school_id = $1'];
    if (search) {
      values.push(`%${search}%`);
      where.push(`(semesters.code ILIKE $${values.length} OR semesters.name ILIKE $${values.length} OR semesters.academic_year ILIKE $${values.length})`);
    }
    if (is_active !== undefined) {
      values.push(is_active === 'true');
      where.push(`semesters.is_active = $${values.length}`);
    }
    if (is_current !== undefined) {
      values.push(is_current === 'true');
      where.push(`semesters.is_current = $${values.length}`);
    }
    if (is_locked !== undefined) {
      values.push(is_locked === 'true');
      where.push(`semesters.is_locked = $${values.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM semesters ${clause}`, values);
    values.push(limit, (page - 1) * limit);
    const rows = await pool.query(
      `SELECT semesters.*,
              (SELECT COUNT(*)::int FROM classes c WHERE c.semester_id = semesters.id AND c.school_id = semesters.school_id AND c.is_active = true) AS class_count,
              (SELECT COUNT(DISTINCT cm.student_id)::int FROM classes c JOIN class_members cm ON cm.class_id = c.id AND cm.school_id = c.school_id WHERE c.semester_id = semesters.id AND c.school_id = semesters.school_id AND c.is_active = true AND (cm.status IS NULL OR cm.status = 'active')) AS student_count
       FROM semesters ${clause} ORDER BY start_date DESC, id LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return { data: rows.rows, total: count.rows[0].total };
  },

  async findById(id, schoolId, client = pool) {
    const { rows } = await client.query(
      `SELECT semesters.*,
              (SELECT COUNT(*)::int FROM classes c WHERE c.semester_id = semesters.id AND c.school_id = semesters.school_id AND c.is_active = true) AS class_count,
              (SELECT COUNT(DISTINCT cm.student_id)::int FROM classes c JOIN class_members cm ON cm.class_id = c.id AND cm.school_id = c.school_id WHERE c.semester_id = semesters.id AND c.school_id = semesters.school_id AND c.is_active = true AND (cm.status IS NULL OR cm.status = 'active')) AS student_count
       FROM semesters WHERE id = $1 AND school_id = $2`,
      [id, schoolId]
    );
    return rows[0];
  },

  async create(data, schoolId) {
    const { rows } = await pool.query(
      `INSERT INTO semesters (school_id, ${columns.join(', ')}) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [schoolId, ...columns.map(key => data[key])]
    );
    return rows[0];
  },

  async update(id, data, schoolId) {
    const keys = columns.filter(key => data[key] !== undefined);
    const values = keys.map(key => data[key]);
    values.push(id, schoolId);
    const { rows } = await pool.query(
      `UPDATE semesters SET ${keys.map((key, index) => `${key} = $${index + 1}`).join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND school_id = $${values.length} AND is_locked = false RETURNING *`,
      values
    );
    return rows[0];
  },

  async transition(id, action, schoolId) {
    return withTransaction(async client => {
      // Serialize all status changes, including activation of different semesters.
      await client.query('SELECT pg_advisory_xact_lock(824771)');
      const { rows } = await client.query(
        'SELECT * FROM semesters WHERE id = $1 AND school_id = $2 FOR UPDATE',
        [id, schoolId]
      );
      const semester = rows[0];
      if (!semester) return { error: 'SEMESTER_NOT_FOUND' };
      if (semester.is_locked) return { error: 'SEMESTER_LOCKED' };
      if (action === 'activate') {
        if (!semester.is_active) return { error: 'SEMESTER_CLOSED' };
        await client.query(
          'UPDATE semesters SET is_current = false, updated_at = NOW() WHERE school_id = $2 AND is_current = true AND id <> $1',
          [id, schoolId]
        );
        const result = await client.query(
          'UPDATE semesters SET is_current = true, updated_at = NOW() WHERE id = $1 AND school_id = $2 RETURNING *',
          [id, schoolId]
        );
        return { data: result.rows[0] };
      }
      if (action === 'close') {
        if (!semester.is_active) return { error: 'SEMESTER_CLOSED' };
        const result = await client.query(
          'UPDATE semesters SET is_active = false, is_current = false, updated_at = NOW() WHERE id = $1 AND school_id = $2 RETURNING *',
          [id, schoolId]
        );
        return { data: result.rows[0] };
      }
      if (action === 'reopen') {
        const result = await client.query(
          'UPDATE semesters SET is_active = true, updated_at = NOW() WHERE id = $1 AND school_id = $2 RETURNING *',
          [id, schoolId]
        );
        return { data: result.rows[0] };
      }
      if (semester.is_active) return { error: 'SEMESTER_MUST_BE_CLOSED' };
      const result = await client.query(
        'UPDATE semesters SET is_locked = true, updated_at = NOW() WHERE id = $1 AND school_id = $2 RETURNING *',
        [id, schoolId]
      );
      return { data: result.rows[0] };
    });
  },
};

module.exports = SemestersRepository;
