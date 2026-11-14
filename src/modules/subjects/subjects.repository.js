const { pool } = require('../../config/db.config');

const columns = ['code', 'name', 'description', 'department_id', 'credits'];

async function requireDepartmentInSchool(schoolId, departmentId) {
  if (!departmentId) return;
  const { rowCount } = await pool.query(
    `SELECT 1 FROM departments WHERE id = $1 AND school_id = $2`,
    [departmentId, schoolId]
  );
  if (!rowCount) {
    throw Object.assign(new Error('Department not found'), {
      code: '23503',
    });
  }
}

const SubjectsRepository = {
  async list({ schoolId, page, limit, search, department_id, include_inactive }) {
    const values = [schoolId];
    const where = ['s.school_id = $1'];
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
      `SELECT s.*, d.name AS department_name,
              (SELECT COUNT(*)::int FROM classes c WHERE c.subject_id = s.id AND c.school_id = s.school_id AND c.is_active = true) AS class_count
       FROM subjects s
       LEFT JOIN departments d ON d.id = s.department_id AND d.school_id = s.school_id
       ${clause} ORDER BY s.name, s.id LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return { data: rows.rows, total: count.rows[0].total };
  },

  async findById(id, schoolId) {
    const { rows } = await pool.query(
      `SELECT s.*, d.name AS department_name,
              (SELECT COUNT(*)::int FROM classes c WHERE c.subject_id = s.id AND c.school_id = s.school_id AND c.is_active = true) AS class_count
       FROM subjects s
       LEFT JOIN departments d ON d.id = s.department_id AND d.school_id = s.school_id
       WHERE s.id = $1 AND s.school_id = $2`, [id, schoolId]
    );
    return rows[0];
  },

  async create(data, schoolId) {
    await requireDepartmentInSchool(schoolId, data.department_id);
    const { rows } = await pool.query(
      `INSERT INTO subjects (school_id, ${columns.join(', ')}) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [schoolId, data.code, data.name, data.description ?? '', data.department_id ?? null, data.credits ?? 0]
    );
    return rows[0];
  },

  async update(id, data, schoolId) {
    if (data.department_id !== undefined) {
      await requireDepartmentInSchool(schoolId, data.department_id);
    }
    const keys = columns.filter(key => data[key] !== undefined);
    const values = keys.map(key => data[key]);
    values.push(id, schoolId);
    const { rows } = await pool.query(
      `UPDATE subjects SET ${keys.map((key, index) => `${key} = $${index + 1}`).join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND school_id = $${values.length} AND is_active = true RETURNING *`, values
    );
    return rows[0];
  },

  async remove(id, schoolId) {
    const { rows } = await pool.query(
      'UPDATE subjects SET is_active = false, updated_at = NOW() WHERE id = $1 AND school_id = $2 AND is_active = true RETURNING *', [id, schoolId]
    );
    return rows[0];
  },

  async restore(id, schoolId) {
    const { rows } = await pool.query(
      'UPDATE subjects SET is_active = true, updated_at = NOW() WHERE id = $1 AND school_id = $2 RETURNING *', [id, schoolId]
    );
    return rows[0];
  },
};

module.exports = SubjectsRepository;
