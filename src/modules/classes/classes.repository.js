const { pool, withTransaction } = require('../../config/db.config');

const ClassesRepository = {

  /**
   * Lấy danh sách lớp học có phân trang và bộ lọc.
   * - Admin: xem tất cả lớp
   * - Lecturer: chỉ xem lớp mình phụ trách
   * - Student: chỉ xem lớp đang tham gia
   * - Hỗ trợ lọc theo semester code hoặc semester UUID
   */
  async findClasses({
    page,
    limit,
    search,
    include_inactive,
    semester,
    semester_id,
    role,
    userId,
    schoolId,
  }) {
    page = Math.max(1, Number(page) || 1);
    limit = Math.max(1, Number(limit) || 10);

    const allowedRoles = [
      "school_admin",
      "lecturer",
      "student",
    ];

    if (!allowedRoles.includes(role)) {
      const error = new Error("FORBIDDEN");
      error.status = 403;
      throw error;
    }

    if (!schoolId || !userId) {
      const error = new Error("SCHOOL_CONTEXT_REQUIRED");
      error.status = 400;
      throw error;
    }

    const offset = (page - 1) * limit;
    const params = [];
    params.push(schoolId);
    const whereConditions = [`c.school_id = $${params.length}`];

    let query = `
    SELECT
      c.*,
      s.name AS subject_name,
      s.code AS subject_code,
      sem.name AS semester_name,
      sem.code AS semester_code,
      u.full_name AS lecturer_name
    FROM classes c
    JOIN subjects s
      ON c.subject_id = s.id
     AND s.school_id = c.school_id
    JOIN semesters sem
      ON c.semester_id = sem.id
     AND sem.school_id = c.school_id
    JOIN user_profiles u
      ON c.lecturer_id = u.user_id
  `;

    // 1. Filter active status
    // Supports both validated booleans and raw query strings.
    const includeInactive =
      include_inactive === true || include_inactive === 'true';

    if (!includeInactive) {
      whereConditions.push(`c.is_active = true`);
    }

    // 2. Filter by role
    if (role === 'lecturer') {
      params.push(userId);

      whereConditions.push(
        `c.lecturer_id = $${params.length}`
      );
    } else if (role === 'student') {
      query += `
      JOIN class_members cm
        ON c.id = cm.class_id
       AND c.school_id = cm.school_id
    `;

      params.push(userId);

      whereConditions.push(
        `cm.student_id = $${params.length}`
      );

      whereConditions.push(
        `cm.status = 'active'`
      );
    }

    // 3. Filter by semester code
    if (semester) {
      params.push(semester);

      whereConditions.push(
        `sem.code = $${params.length}`
      );
    }

    // 4. Filter by semester UUID
    if (semester_id) {
      params.push(semester_id);

      whereConditions.push(
        `c.semester_id = $${params.length}`
      );
    }

    // 5. Filter by search
    if (search) {
      params.push(`%${search}%`);

      whereConditions.push(`
      (
        c.class_code ILIKE $${params.length}
        OR s.name ILIKE $${params.length}
        OR s.code ILIKE $${params.length}
      )
    `);
    }

    // 6. Combine WHERE conditions
    if (whereConditions.length > 0) {
      query += `
      WHERE ${whereConditions.join(' AND ')}
    `;
    }

    // 7. Count before pagination
    const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM (${query}) AS filtered_classes
  `;

    const countResult = await pool.query(
      countQuery,
      params
    );

    const total = countResult.rows[0].total;

    // 8. Pagination
    params.push(limit);
    const limitPosition = params.length;

    params.push(offset);
    const offsetPosition = params.length;

    query += `
    ORDER BY c.created_at DESC, c.id
    LIMIT $${limitPosition}
    OFFSET $${offsetPosition}
  `;

    const { rows } = await pool.query(
      query,
      params
    );

    return {
      data: rows,
      total
    };
  },


  /**
   * Lấy chi tiết lớp học
   */
  async findById(id, schoolId) {
    const query = `
      SELECT c.*, s.name as subject_name, s.code as subject_code, sem.name as semester_name, u.full_name as lecturer_name 
      FROM classes c
      JOIN subjects s
        ON c.subject_id = s.id
       AND s.school_id = c.school_id
      JOIN semesters sem
        ON c.semester_id = sem.id
       AND sem.school_id = c.school_id
      JOIN user_profiles u ON c.lecturer_id = u.user_id
      WHERE c.id = $1
        AND c.school_id = $2
    `;
    const { rows } = await pool.query(query, [id, schoolId]);
    return rows[0];
  },
  async getSlots(classId, schoolId) {
    const query = `
    SELECT
      s.id,
      s.session_no AS slot_number,
      s.learning_date AS date,
      COALESCE(
        s.slot_time,
        '09:30-11:45'
      ) AS time,
      s.title,
      s.note AS content,

      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', a.id,
              'title', a.title,
              'description', a.description,
              'deadline', a.deadline,
              'max_score', a.max_score,
              'weight', a.weight,
              'publish_status', a.publish_status,
              'slot_id', COALESCE(a.slot_id, a.session_id)
            )
            ORDER BY a.created_at ASC
          )

          FROM assignments a

          WHERE (
            a.slot_id = s.id
            OR a.session_id = s.id
          )

          -- Assignment phải thuộc đúng lớp
          AND a.class_id = s.class_id

          -- Assignment phải thuộc đúng trường
          AND a.school_id = s.school_id
        ),
        '[]'::json
      ) AS assignments

    FROM sessions s

    WHERE s.class_id = $1
      AND s.school_id = $2

    ORDER BY s.session_no ASC
  `;

    const { rows } = await pool.query(
      query,
      [classId, schoolId]
    );

    return rows;
  },

  async getSlotById(slotId, schoolId) {
    let whereCondition = 'WHERE s.id = $1';
    let assignmentSchoolCheck = '';
    const params = [slotId];

    if (schoolId) {
      whereCondition += ' AND s.school_id = $2';
      assignmentSchoolCheck = 'AND a.school_id = s.school_id';
      params.push(schoolId);
    }

    const query = `
      SELECT 
        s.id, 
        s.class_id,
        s.session_no as slot_number, 
        s.learning_date as date, 
        COALESCE(s.slot_time, '09:30-11:45') as time, 
        s.title, 
        s.note as content,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', a.id,
                'title', a.title,
                'description', a.description,
                'deadline', a.deadline,
                'max_score', a.max_score,
                'weight', a.weight,
                'publish_status', a.publish_status,
                'slot_id', COALESCE(a.slot_id, a.session_id)
              ) ORDER BY a.created_at ASC
            )
            FROM assignments a
            WHERE (a.slot_id = s.id OR a.session_id = s.id)
              ${assignmentSchoolCheck}
          ),
          '[]'::json
        ) as assignments
      FROM sessions s
      ${whereCondition}
    `;
    const { rows } = await pool.query(query, params);
    return rows[0] || null;
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
  async findMembers(classId, schoolId) {
    const query = `
    SELECT 
      cm.student_id, 
      cm.status, 
      u.email, 
      up.full_name, 
      mp.student_code,
      d.name AS department_name,
      -- Thông tin streak từ bảng subject_streaks
      ss.current_streak,
      ss.longest_streak,
      ss.last_activity_date,
      ss.recovery_used,
      ss.recovery_month,
      ss.is_active
    FROM class_members cm
    JOIN classes c
      ON cm.class_id = c.id
     AND cm.school_id = c.school_id
    JOIN school_memberships sm
      ON sm.school_id = cm.school_id
     AND sm.user_id = cm.student_id
     AND sm.role = 'student'
     AND sm.status = 'active'
    JOIN users u
      ON cm.student_id = u.id
     AND u.is_active = TRUE
    JOIN user_profiles up ON u.id = up.user_id
    LEFT JOIN school_member_profiles mp
      ON mp.school_id = cm.school_id
     AND mp.user_id = cm.student_id
    LEFT JOIN departments d
      ON d.id = mp.department_id
     AND d.school_id = cm.school_id
LEFT JOIN subject_streaks ss
  ON ss.user_id = cm.student_id
 AND ss.subject_id = c.subject_id
 AND ss.school_id = cm.school_id
    WHERE cm.class_id = $1
      AND cm.school_id = $2
    ORDER BY mp.student_code ASC
  `;
    const { rows } = await pool.query(query, [classId, schoolId]);
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
