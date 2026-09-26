const { pool, withTransaction } = require("../../config/db.config");

const AdminRepository = {
  /**
   * Tạo user mới (với role tùy chọn) sử dụng transaction
   * Đảm bảo insert đồng thời vào users và user_profiles (giống auth.repository.js)
   */
  async createUser(userData) {
    return await withTransaction(async (client) => {
      // 1. Insert vào bảng users
      const userQuery = `
        INSERT INTO users (email, username, password_hash, role)
        VALUES ($1, $2, $3, $4)
        RETURNING id, email, username, role, is_active, created_at, updated_at
      `;
      const userValues = [
        userData.email,
        userData.username || null,
        userData.password_hash,
        userData.role || "student",
      ];
      const userResult = await client.query(userQuery, userValues);
      const newUser = userResult.rows[0];

      // 2. Insert vào bảng user_profiles
      const profileQuery = `
        INSERT INTO user_profiles (user_id, full_name, student_code, department_id)
        VALUES ($1, $2, $3, $4)
        RETURNING avatar_url, full_name, student_code, department_id
      `;
      const profileValues = [
        newUser.id,
        userData.full_name,
        userData.student_code || null,
        userData.department_id || null,
      ];
      const profileResult = await client.query(profileQuery, profileValues);

      return {
        ...newUser,
        profile: profileResult.rows[0],
      };
    });
  },

  /**
   * Tìm user kèm theo thông tin profile và department
   * (Tương tự auth.repository.findUserByIdWithProfile)
   */
  async findUserByIdWithProfile(userId) {
    const query = `
      SELECT 
        u.id, u.email, u.username, u.role, u.is_active, u.last_login_at, u.created_at, u.updated_at,
        p.avatar_url, p.full_name, p.student_code,
        d.id AS department_id, d.code AS department_code, d.name AS department_name
      FROM users u
      LEFT JOIN user_profiles p ON u.id = p.user_id
      LEFT JOIN departments d ON p.department_id = d.id
      WHERE u.id = $1
    `;
    const result = await pool.query(query, [userId]);
    return result.rows[0] || null;
  },

  /**
   * Cập nhật user và profile sử dụng transaction
   */
  async updateUser(userId, updateData) {
    return await withTransaction(async (client) => {
      const { email, role, full_name, student_code, department_id } = updateData;

      // Update bảng users nếu có email hoặc role thay đổi
      if (email !== undefined || role !== undefined) {
        const userFields = [];
        const userValues = [];
        let userIndex = 1;

        if (email !== undefined) {
          userFields.push(`email = $${userIndex++}`);
          userValues.push(email);
        }
        if (role !== undefined) {
          userFields.push(`role = $${userIndex++}`);
          userValues.push(role);
        }

        if (userFields.length > 0) {
          userFields.push(`updated_at = NOW()`);
          userValues.push(userId);
          const userQuery = `
            UPDATE users
            SET ${userFields.join(", ")}
            WHERE id = $${userIndex}
          `;
          await client.query(userQuery, userValues);
        }
      }

      // Update bảng user_profiles nếu có thông tin profile thay đổi
      if (full_name !== undefined || student_code !== undefined || department_id !== undefined) {
        const profileFields = [];
        const profileValues = [];
        let profileIndex = 1;

        if (full_name !== undefined) {
          profileFields.push(`full_name = $${profileIndex++}`);
          profileValues.push(full_name);
        }
        if (student_code !== undefined) {
          profileFields.push(`student_code = $${profileIndex++}`);
          profileValues.push(student_code);
        }
        if (department_id !== undefined) {
          profileFields.push(`department_id = $${profileIndex++}`);
          profileValues.push(department_id);
        }

        if (profileFields.length > 0) {
          profileFields.push(`updated_at = NOW()`);
          profileValues.push(userId);
          const profileQuery = `
            UPDATE user_profiles
            SET ${profileFields.join(", ")}
            WHERE user_id = $${profileIndex}
          `;
          await client.query(profileQuery, profileValues);
        }
      }
    });
  },

  /**
   * Cập nhật trạng thái active (UC 88 Suspend / UC 89 Activate)
   */
  async updateUserStatus(userId, isActive) {
    const query = `
      UPDATE users
      SET is_active = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, is_active
    `;
    const result = await pool.query(query, [isActive, userId]);
    return result.rows[0];
  },

  /**
   * Lấy danh sách tất cả users kèm thông tin profile và department
   */
  async getAllUsers() {
    const query = `
      SELECT 
        u.id, u.email, u.username, u.role, u.is_active, u.last_login_at, u.created_at,
        p.avatar_url, p.full_name, p.student_code,
        d.id AS department_id, d.name AS department_name
      FROM users u
      LEFT JOIN user_profiles p ON u.id = p.user_id
      LEFT JOIN departments d ON p.department_id = d.id
      ORDER BY u.created_at DESC
    `;
    const result = await pool.query(query);
    return result.rows;
  },

  /**
   * Lấy danh sách ID user theo target (phục vụ broadcast notification)
   */
  async findUserIdsByTarget(target) {
    let query = `SELECT id FROM users WHERE is_active = true`;
    const params = [];

    if (target === "student" || target === "lecturer") {
      query += ` AND role = $1`;
      params.push(target);
    }

    const result = await pool.query(query, params);
    return result.rows.map(row => row.id);
  },
};

module.exports = AdminRepository;
