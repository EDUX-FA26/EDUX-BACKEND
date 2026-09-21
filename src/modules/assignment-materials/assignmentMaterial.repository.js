const { pool } = require('../../config/db.config');

const AssignmentMaterialRepository = {
  /**
   * Lấy danh sách tài liệu của assignment (có phân trang)
   */
  async findByAssignmentId(assignmentId, { page = 1, limit = 20 } = {}) {
    page = Number(page);
    limit = Number(limit);
    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(*) FROM assignment_materials
      WHERE assignment_id = $1
    `;
    const { rows: countRows } = await pool.query(countQuery, [assignmentId]);
    const total = parseInt(countRows[0].count, 10);

    const query = `
      SELECT am.*, up.full_name AS uploaded_by_name
      FROM assignment_materials am
      JOIN user_profiles up ON am.uploaded_by = up.user_id
      WHERE am.assignment_id = $1
      ORDER BY am.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const { rows } = await pool.query(query, [assignmentId, limit, offset]);
    return { data: rows, total };
  },

  /**
   * Lấy chi tiết 1 tài liệu assignment theo id
   */
  async findById(id) {
    const query = `
      SELECT am.*, up.full_name AS uploaded_by_name
      FROM assignment_materials am
      JOIN user_profiles up ON am.uploaded_by = up.user_id
      WHERE am.id = $1
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  },

  /**
   * Tìm 1 tài liệu theo id và assignmentId (để verify ownership)
   */
  async findByIdAndAssignment(id, assignmentId) {
    const query = `
      SELECT am.*, up.full_name AS uploaded_by_name
      FROM assignment_materials am
      JOIN user_profiles up ON am.uploaded_by = up.user_id
      WHERE am.id = $1 AND am.assignment_id = $2
    `;
    const { rows } = await pool.query(query, [id, assignmentId]);
    return rows[0];
  },

  /**
   * Tạo mới tài liệu assignment
   */
  async create({ assignment_id, description, file_name, file_key, file_type, file_size, uploaded_by }) {
    const query = `
      INSERT INTO assignment_materials
        (assignment_id, description, file_name, file_key, file_type, file_size, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const { rows } = await pool.query(query, [
      assignment_id, description, file_name, file_key, file_type, file_size, uploaded_by
    ]);
    return rows[0];
  },

  /**
   * Cập nhật tài liệu assignment
   */
  async update(id, data) {
    const allowedFields = ['description'];
    const fields = [];
    const values = [];
    let idx = 1;

    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        fields.push(`${key} = $${idx}`);
        values.push(data[key]);
        idx++;
      }
    }

    if (fields.length === 0) return null;

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE assignment_materials
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `;
    const { rows } = await pool.query(query, values);
    return rows[0];
  },

  /**
   * Xóa tài liệu assignment
   */
  async delete(id) {
    const query = `DELETE FROM assignment_materials WHERE id = $1 RETURNING *`;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  },
};

module.exports = AssignmentMaterialRepository;

