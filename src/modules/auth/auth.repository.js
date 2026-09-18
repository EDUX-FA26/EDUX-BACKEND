const { pool, withTransaction } = require("../../config/db.config");

class AuthRepository {
  /**
   * Tạo user mới (mặc định role 'student') sử dụng transaction
   * Đảm bảo insert đồng thời vào users và user_profiles
   */
  async createUser(userData) {
    return await withTransaction(async (client) => {
      // 1. Insert vào bảng users
      const userQuery = `
        INSERT INTO users (email, username, password_hash, role)
        VALUES ($1, $2, $3, 'student')
        RETURNING id, email, username, role, is_active, created_at, updated_at
      `;
      const userValues = [
        userData.email,
        userData.username || null,
        userData.password_hash,
      ];
      const userResult = await client.query(userQuery, userValues);
      const newUser = userResult.rows[0];

      // 2. Insert vào bảng user_profiles
      const profileQuery = `
        INSERT INTO user_profiles (user_id, full_name, student_code)
        VALUES ($1, $2, $3)
        RETURNING avatar_url, full_name, student_code, department_id
      `;
      const profileValues = [
        newUser.id,
        userData.full_name,
        userData.student_code,
      ];
      const profileResult = await client.query(profileQuery, profileValues);
      
      // Trả về thông tin user mới (không chứa password_hash)
      return {
        ...newUser,
        profile: profileResult.rows[0],
      };
    });
  }

  /**
   * Tìm user bằng email hoặc username (phục vụ login, trả về kèm password_hash)
   */
  async findUserByEmailOrUsername(identifier) {
    const query = `
      SELECT id, email, username, password_hash, role, is_active
      FROM users
      WHERE email = $1 OR username = $1
    `;
    const result = await pool.query(query, [identifier]);
    return result.rows[0] || null;
  }

  /**
   * Cập nhật thời gian đăng nhập cuối
   */
  async updateLastLogin(userId) {
    const query = `
      UPDATE users 
      SET last_login_at = NOW() 
      WHERE id = $1
    `;
    await pool.query(query, [userId]);
  }

  /**
   * Tìm user kèm theo thông tin profile và department (phục vụ /me endpoint)
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
   * Kiểm tra trùng lặp email, username, student_code
   */
  async checkDuplication(email, username, studentCode) {
    const query = `
      SELECT 'email' as field FROM users WHERE email = $1
      UNION
      SELECT 'username' as field FROM users WHERE username = $2 AND $2 IS NOT NULL
      UNION
      SELECT 'student_code' as field FROM user_profiles WHERE student_code = $3 AND $3 IS NOT NULL
    `;
    const result = await pool.query(query, [email, username, studentCode]);
    if (result.rowCount > 0) {
      return result.rows.map(r => r.field);
    }
    return null;
  }

  /**
   * Cập nhật mật khẩu
   */
  async updatePassword(userId, passwordHash) {
    const query = `
      UPDATE users
      SET password_hash = $2
      WHERE id = $1
    `;
    await pool.query(query, [userId, passwordHash]);
  }

  /**
   * Tìm user kèm password hash bằng ID (dùng cho đổi mật khẩu)
   */
  async findUserByIdWithPassword(userId) {
    const query = `
      SELECT id, password_hash
      FROM users
      WHERE id = $1
    `;
    const result = await pool.query(query, [userId]);
    return result.rows[0] || null;
  }
}

module.exports = new AuthRepository();