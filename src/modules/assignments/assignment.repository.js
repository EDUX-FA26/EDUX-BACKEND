const { pool } = require('../../config/db.config');

const AssignmentRepository = {
  /**
   * Tạo mới assignment
   * Cho phép truyền client (để dùng trong transaction) hoặc dùng default pool
   */
  async create(data, client = pool) {
    const query = `
      INSERT INTO assignments (
        id, uuid, school_id, class_id, session_id, title, description, instructions, deadline,
        max_score, weight, ai_declaration_required, min_ai_interactions,
        max_ai_interactions, allow_late_submission, publish_status, published_at, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      ) RETURNING *;
    `;
    const values = [
      data.id,
      data.uuid,
      data.school_id,
      data.class_id,
      data.session_id,
      data.title,
      data.description || '',
      data.instructions || '',
      data.deadline,
      data.max_score,
      data.weight,
      data.ai_declaration_required,
      data.min_ai_interactions,
      data.max_ai_interactions,
      data.allow_late_submission,
      data.publish_status,
      data.publish_status === 'published' ? new Date() : null,
      data.created_by
    ];

    const { rows } = await client.query(query, values);
    return rows[0];
  },

  /**
   * Cập nhật thông tin assignment
   */
  async update(id, schoolId, data) {
    const allowedFields = [
      'title', 'description', 'instructions', 'deadline', 'max_score', 'weight',
      'ai_declaration_required', 'min_ai_interactions', 'max_ai_interactions',
      'allow_late_submission', 'publish_status', 'session_id'
    ];
    
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
    values.push(id, schoolId);

    const query = `
      UPDATE assignments
      SET ${fields.join(', ')}
      WHERE id = $${idx} AND school_id = $${idx + 1}
      RETURNING *;
    `;

    const { rows } = await pool.query(query, values);
    return rows[0];
  },

  /**
   * Thay đổi trạng thái xuất bản
   */
  async updatePublishStatus(id, schoolId, publishStatus) {
    let query;
    const values = [publishStatus, id, schoolId];

    if (publishStatus === 'published') {
      query = `
        UPDATE assignments
        SET publish_status = $1, published_at = COALESCE(published_at, NOW()), updated_at = NOW()
        WHERE id = $2 AND school_id = $3
        RETURNING *;
      `;
    } else {
      query = `
        UPDATE assignments
        SET publish_status = $1, updated_at = NOW()
        WHERE id = $2 AND school_id = $3
        RETURNING *;
      `;
    }

    const { rows } = await pool.query(query, values);
    return rows[0];
  },

  /**
   * Lấy chi tiết assignment
   */
  async findById(id, schoolId) {
    const query = `
      SELECT 
        a.*, 
        c.class_code, 
        c.lecturer_id,
        c.semester_id,
        s.id as subject_id,
        s.name as subject_name,
        s.code as subject_code,
        sem.name as semester_name,
        u.full_name as creator_name
      FROM assignments a
      JOIN classes c ON a.class_id = c.id AND c.school_id = a.school_id
      JOIN subjects s ON c.subject_id = s.id AND s.school_id = a.school_id
      LEFT JOIN semesters sem ON c.semester_id = sem.id AND sem.school_id = a.school_id
      LEFT JOIN user_profiles u ON a.created_by = u.user_id
      WHERE a.id = $1 AND a.school_id = $2
    `;
    const { rows } = await pool.query(query, [id, schoolId]);
    return rows[0];
  },

  /**
   * Lấy danh sách phân trang (có filter theo school, class, role, trạng thái)
   */
  async findMany({ page = 1, limit = 10, search, class_id, publish_status }, tenant) {
    const offset = (page - 1) * limit;
    let whereClauses = [`a.school_id = $1`];
    let values = [tenant.schoolId];
    let idx = 2;

    // Filter by class_id if provided
    if (class_id) {
      whereClauses.push(`a.class_id = $${idx++}`);
      values.push(class_id);
    }

    // Filter by publish_status if provided
    if (publish_status) {
      whereClauses.push(`a.publish_status = $${idx++}`);
      values.push(publish_status);
    }

    // Text search
    if (search) {
      whereClauses.push(`a.title ILIKE $${idx++}`);
      values.push(`%${search}%`);
    }

    // Row-Level Isolation (School Role-based filtering)
    if (tenant.role === 'student') {
      // Student chỉ thấy bài đã publish hoặc closed của lớp đang học (active) trong cùng trường
      whereClauses.push(`a.publish_status IN ('published', 'closed')`);
      whereClauses.push(`
        EXISTS (
          SELECT 1 FROM class_members cm 
          WHERE cm.class_id = a.class_id 
          AND cm.student_id = $${idx++}
          AND cm.school_id = a.school_id
          AND cm.status = 'active'
        )
      `);
      values.push(tenant.userId);
    } else if (tenant.role === 'lecturer') {
      // Lecturer thấy tất cả bài trong lớp họ giảng dạy tại trường hiện tại
      whereClauses.push(`c.lecturer_id = $${idx++}`);
      values.push(tenant.userId);
    }

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*) 
      FROM assignments a
      JOIN classes c ON a.class_id = c.id AND c.school_id = a.school_id
      JOIN subjects s ON c.subject_id = s.id AND s.school_id = a.school_id
      ${whereString}
    `;
    const { rows: countRows } = await pool.query(countQuery, values);
    const total = parseInt(countRows[0].count, 10);

    const query = `
      SELECT 
        a.*,
        c.class_code,
        c.semester_id,
        s.id as subject_id,
        s.name as subject_name,
        s.code as subject_code
      FROM assignments a
      JOIN classes c ON a.class_id = c.id AND c.school_id = a.school_id
      JOIN subjects s ON c.subject_id = s.id AND s.school_id = a.school_id
      ${whereString}
      ORDER BY a.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    values.push(limit, offset);

    const { rows } = await pool.query(query, values);
    return { data: rows, total };
  },

  /**
   * Xóa assignment
   */
  async delete(id, schoolId) {
    const query = `DELETE FROM assignments WHERE id = $1 AND school_id = $2 RETURNING *`;
    const { rows } = await pool.query(query, [id, schoolId]);
    return rows[0];
  }
};

module.exports = AssignmentRepository;