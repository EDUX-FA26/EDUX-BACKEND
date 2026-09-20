const { pool, withTransaction } = require('../../config/db.config');

const ClassesRepository = {
  /**
   * Lấy danh sách lớp học có phân trang và filter
   */
  async findClasses({ page, limit, search, include_inactive, role, userId }) {
    page = Number(page) || 1;
    limit = Number(limit) || 10;
    const offset = (page - 1) * limit;
    const params = [];
    let query = `
      SELECT c.*, s.name as subject_name, sem.name as semester_name, u.full_name as lecturer_name 
      FROM classes c 
      JOIN subjects s ON c.subject_id = s.id 
      JOIN semesters sem ON c.semester_id = sem.id 
      JOIN user_profiles u ON c.lecturer_id = u.user_id
    `;

    const whereConditions = [];

    // Filter by active status
    if (!include_inactive) {
      whereConditions.push(`c.is_active = true`);
    }

    // Filter by role
    if (role === 'lecturer') {
      whereConditions.push(`c.lecturer_id = $${params.length + 1}`);
      params.push(userId);
    } else if (role === 'student') {
      query += ` JOIN class_members cm ON c.id = cm.class_id`;
      whereConditions.push(`cm.student_id = $${params.length + 1}`);
      params.push(userId);
      whereConditions.push(`cm.status = 'active'`);
    }

    // Filter by search
    if (search) {
      whereConditions.push(`(c.class_code ILIKE $${params.length + 1} OR s.name ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }

    if (whereConditions.length > 0) {
      query += ` WHERE ` + whereConditions.join(' AND ');
    }

    // Count total
    const countQuery = `SELECT COUNT(*) FROM (${query}) as total`;
    const totalResult = await pool.query(countQuery, params);
    const total = parseInt(totalResult.rows[0].count, 10);

    // Add pagination
    query += ` ORDER BY c.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);
    return { data: rows, total };
  },

  /**
   * Lấy chi tiết lớp học
   */
  async findById(id) {
    const query = `
      SELECT c.*, s.name as subject_name, sem.name as semester_name, u.full_name as lecturer_name 
      FROM classes c 
      JOIN subjects s ON c.subject_id = s.id 
      JOIN semesters sem ON c.semester_id = sem.id 
      JOIN user_profiles u ON c.lecturer_id = u.user_id
      WHERE c.id = $1
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  },

  /**
   * Tạo lớp học mới
   */
  async create(data) {
    const query = `
      INSERT INTO classes (class_code, semester_id, subject_id, lecturer_id, max_students, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [
      data.class_code,
      data.semester_id,
      data.subject_id,
      data.lecturer_id,
      data.max_students,
      data.is_active
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
  },

  /**
   * Cập nhật thông tin lớp học
   */
  async update(id, data) {
    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        fields.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }

    if (fields.length === 0) return null;

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE classes 
      SET ${fields.join(', ')} 
      WHERE id = $${idx}
      RETURNING *
    `;
    
    const { rows } = await pool.query(query, values);
    return rows[0];
  },

  /**
   * Vô hiệu hóa lớp học (Soft delete)
   */
  async delete(id) {
    const query = `
      UPDATE classes 
      SET is_active = false, updated_at = NOW() 
      WHERE id = $1 
      RETURNING *
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  },

  /**
   * Lấy danh sách thành viên lớp
   */
  async findMembers(classId) {
    const query = `
      SELECT cm.student_id, cm.status, u.email, up.full_name, up.student_code, d.name as department_name 
      FROM class_members cm 
      JOIN users u ON cm.student_id = u.id 
      JOIN user_profiles up ON u.id = up.user_id 
      LEFT JOIN departments d ON up.department_id = d.id 
      WHERE cm.class_id = $1
      ORDER BY up.student_code ASC
    `;
    const { rows } = await pool.query(query, [classId]);
    return rows;
  },

  /**
   * Bulk insert/upsert thành viên
   */
  async bulkUpsertMembers(classId, studentIds) {
    if (!studentIds || studentIds.length === 0) return 0;

    return withTransaction(async (client) => {
      // Build values string like "($1, $2, 'active'), ($1, $3, 'active')"
      const values = [];
      const params = [classId];
      let paramIdx = 2;

      studentIds.forEach(studentId => {
        values.push(`($1, $${paramIdx}, 'active')`);
        params.push(studentId);
        paramIdx++;
      });

      const query = `
        INSERT INTO class_members (class_id, student_id, status)
        VALUES ${values.join(', ')}
        ON CONFLICT (class_id, student_id) 
        DO UPDATE SET status = 'active', updated_at = NOW()
        RETURNING *
      `;
      
      const { rowCount } = await client.query(query, params);
      return rowCount;
    });
  },

  /**
   * Lấy danh sách user_id từ student_code
   */
  async getStudentIdsByCodes(studentCodes) {
    if (!studentCodes || studentCodes.length === 0) return [];

    const query = `
      SELECT user_id, student_code 
      FROM user_profiles 
      WHERE student_code = ANY($1)
    `;
    const { rows } = await pool.query(query, [studentCodes]);
    return rows;
  },

  /**
   * Xóa thành viên (Cập nhật status = 'dropped')
   */
  async removeMember(classId, studentId) {
    const query = `
      UPDATE class_members 
      SET status = 'dropped', updated_at = NOW()
      WHERE class_id = $1 AND student_id = $2
      RETURNING *
    `;
    const { rows } = await pool.query(query, [classId, studentId]);
    return rows[0];
  }
};

module.exports = ClassesRepository;
