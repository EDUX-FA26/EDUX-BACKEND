const { pool } = require('../../config/db.config');

const ClassMaterialRepository = {
  /**
   * Lấy danh sách tài liệu của lớp (có phân trang)
   */
  async findByClassId(classId, { page = 1, limit = 20 } = {}) {
    page = Number(page);
    limit = Number(limit);
    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(*) FROM class_materials
      WHERE class_id = $1
    `;
    const { rows: countRows } = await pool.query(countQuery, [classId]);
    const total = parseInt(countRows[0].count, 10);

    const query = `
      SELECT cm.*, up.full_name AS uploaded_by_name
      FROM class_materials cm
      JOIN user_profiles up ON cm.uploaded_by = up.user_id
      WHERE cm.class_id = $1
      ORDER BY cm.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const { rows } = await pool.query(query, [classId, limit, offset]);
    return { data: rows, total };
  },

  /**
   * Lấy chi tiết 1 tài liệu lớp theo id
   */
  async findById(id) {
    const query = `
      SELECT cm.*, up.full_name AS uploaded_by_name
      FROM class_materials cm
      JOIN user_profiles up ON cm.uploaded_by = up.user_id
      WHERE cm.id = $1
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  },

  /**
   * Tạo mới tài liệu lớp
   */
  async create({ class_id, title, description, file_name, file_key, file_type, file_size, is_private, uploaded_by }) {
    const query = `
      INSERT INTO class_materials
        (class_id, title, description, file_name, file_key, file_type, file_size, is_private, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    const { rows } = await pool.query(query, [
      class_id, title, description, file_name, file_key, file_type, file_size, is_private, uploaded_by
    ]);
    return rows[0];
  },

  /**
   * Cập nhật tài liệu lớp
   */
  async update(id, data) {
    const allowedFields = ['title', 'description', 'is_private'];
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
      UPDATE class_materials
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `;
    const { rows } = await pool.query(query, values);
    return rows[0];
  },

  /**
   * Xóa tài liệu lớp
   */
  async delete(id) {
    const query = `DELETE FROM class_materials WHERE id = $1 RETURNING *`;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  },
};

module.exports = ClassMaterialRepository;

