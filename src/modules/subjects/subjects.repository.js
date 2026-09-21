const { pool } = require('../../config/db.config');

const columns = ['code', 'name', 'description', 'department_id', 'credits'];

const SubjectsRepository = {
  async list({ page, limit, search, department_id, include_inactive }) {
    const values = [];
    const where = [];
    if (include_inactive !== 'true') where.push('s.is_active = true');
    if (search) {
      values.push(`%${search}%`);
      where.push(`(s.code ILIKE $${values.length} OR s.name ILIKE $${values.length})`);
    }
    if (department_id) {
      values.push(department_id);
      where.push(`s.department_id = $${values.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM subjects s ${clause}`, values);
    values.push(limit, (page - 1) * limit);
    const rows = await pool.query(
      `SELECT s.*, d.name AS department_name FROM subjects s
       LEFT JOIN departments d ON d.id = s.department_id
       ${clause} ORDER BY s.name, s.id LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return { data: rows.rows, total: count.rows[0].total };
  },

  async findById(id) {
    const { rows } = await pool.query(
      `SELECT s.*, d.name AS department_name FROM subjects s
       LEFT JOIN departments d ON d.id = s.department_id WHERE s.id = $1`, [id]
    );
    return rows[0];
  },

  async create(data) {
    const { rows } = await pool.query(
      `INSERT INTO subjects (${columns.join(', ')}) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.code, data.name, data.description ?? '', data.department_id ?? null, data.credits ?? 0]
    );
    return rows[0];
  },

  async update(id, data) {
    const keys = columns.filter(key => data[key] !== undefined);
    const values = keys.map(key => data[key]);
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE subjects SET ${keys.map((key, index) => `${key} = $${index + 1}`).join(', ')}, updated_at = NOW()
       WHERE id = $${values.length} AND is_active = true RETURNING *`, values
    );
    return rows[0];
  },

  async remove(id) {
    const { rows } = await pool.query(
      'UPDATE subjects SET is_active = false, updated_at = NOW() WHERE id = $1 AND is_active = true RETURNING *', [id]
    );
    return rows[0];
  },
};

module.exports = SubjectsRepository;
