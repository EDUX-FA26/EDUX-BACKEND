const { pool, withTransaction } = require('../../config/db.config');

const columns = ['code', 'name', 'academic_year', 'start_date', 'end_date'];

const SemestersRepository = {
  async list({ page, limit, search, is_active, is_current }) {
    const values = [];
    const where = [];
    if (search) {
      values.push(`%${search}%`);
      where.push(`(code ILIKE $${values.length} OR name ILIKE $${values.length} OR academic_year ILIKE $${values.length})`);
    }
    if (is_active !== undefined) {
      values.push(is_active === 'true');
      where.push(`is_active = $${values.length}`);
    }
    if (is_current !== undefined) {
      values.push(is_current === 'true');
      where.push(`is_current = $${values.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM semesters ${clause}`, values);
    values.push(limit, (page - 1) * limit);
    const rows = await pool.query(
      `SELECT * FROM semesters ${clause} ORDER BY start_date DESC, id LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return { data: rows.rows, total: count.rows[0].total };
  },

  async findById(id, client = pool) {
    const { rows } = await client.query('SELECT * FROM semesters WHERE id = $1', [id]);
    return rows[0];
  },

  async create(data) {
    const { rows } = await pool.query(
      `INSERT INTO semesters (${columns.join(', ')}) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      columns.map(key => data[key])
    );
    return rows[0];
  },

  async update(id, data) {
    const keys = columns.filter(key => data[key] !== undefined);
    const values = keys.map(key => data[key]);
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE semesters SET ${keys.map((key, index) => `${key} = $${index + 1}`).join(', ')}, updated_at = NOW()
       WHERE id = $${values.length} AND is_locked = false RETURNING *`,
      values
    );
    return rows[0];
  },

  async transition(id, action) {
    return withTransaction(async client => {
      // Serialize all status changes, including activation of different semesters.
      await client.query('SELECT pg_advisory_xact_lock(824771)');
      const { rows } = await client.query('SELECT * FROM semesters WHERE id = $1 FOR UPDATE', [id]);
      const semester = rows[0];
      if (!semester) return { error: 'SEMESTER_NOT_FOUND' };
      if (semester.is_locked) return { error: 'SEMESTER_LOCKED' };
      if (action === 'activate') {
        if (!semester.is_active) return { error: 'SEMESTER_CLOSED' };
        await client.query('UPDATE semesters SET is_current = false, updated_at = NOW() WHERE is_current = true AND id <> $1', [id]);
        const result = await client.query(
          'UPDATE semesters SET is_current = true, updated_at = NOW() WHERE id = $1 RETURNING *', [id]
        );
        return { data: result.rows[0] };
      }
      if (action === 'close') {
        if (!semester.is_active) return { error: 'SEMESTER_CLOSED' };
        const result = await client.query(
          'UPDATE semesters SET is_active = false, is_current = false, updated_at = NOW() WHERE id = $1 RETURNING *', [id]
        );
        return { data: result.rows[0] };
      }
      if (semester.is_active) return { error: 'SEMESTER_MUST_BE_CLOSED' };
      const result = await client.query(
        'UPDATE semesters SET is_locked = true, updated_at = NOW() WHERE id = $1 RETURNING *', [id]
      );
      return { data: result.rows[0] };
    });
  },
};

module.exports = SemestersRepository;
