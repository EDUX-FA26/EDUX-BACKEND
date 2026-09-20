const { pool } = require("../../config/db.config");

class UsersRepository {
  /**
   * Tìm user kèm theo thông tin profile và department (phục vụ /me endpoint)
   * Tương tự hàm cũ trong auth.repository.js
   */
  async findUserByIdWithProfile(userId) {
    const query = `
      SELECT 
        u.id, u.email, u.username, u.role, u.is_active, u.last_login_at, u.created_at,
        p.avatar_url, p.full_name, p.student_code,
        d.id AS department_id, d.code AS department_code, d.name AS department_name
      FROM users u
      JOIN user_profiles p ON u.id = p.user_id
      LEFT JOIN departments d ON p.department_id = d.id
      WHERE u.id = $1
    `;
    const result = await pool.query(query, [userId]);
    return result.rows[0] || null;
  }

  /**
   * Cập nhật thông tin profile
   */
  async updateUserProfile(userId, updateData) {
    const { full_name, avatar_url, department_id } = updateData;
    const fields = [];
    const values = [];
    let queryIndex = 1;

    if (full_name !== undefined) {
      fields.push(`full_name = $${queryIndex++}`);
      values.push(full_name);
    }
    if (avatar_url !== undefined) {
      fields.push(`avatar_url = $${queryIndex++}`);
      values.push(avatar_url);
    }
    if (department_id !== undefined) {
      fields.push(`department_id = $${queryIndex++}`);
      values.push(department_id);
    }

    if (fields.length === 0) return null;

    fields.push(`updated_at = NOW()`);
    
    values.push(userId);
    const query = `
      UPDATE user_profiles
      SET ${fields.join(", ")}
      WHERE user_id = $${queryIndex}
    `;

    await pool.query(query, values);
  }
}

module.exports = new UsersRepository();
