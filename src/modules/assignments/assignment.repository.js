const { pool } = require('../../config/db.config');

const AssignmentRepository = {
  /**
   * Tạo mới assignment
   * Cho phép truyền client (để dùng trong transaction) hoặc dùng default pool
   */
  async create(data, client = pool) {
    const rawSlotId = data.slot_id !== undefined ? data.slot_id : data.session_id;
    const resolvedSlotId = (rawSlotId && typeof rawSlotId === 'string' && rawSlotId.trim() !== '') ? rawSlotId.trim() : (rawSlotId || null);

    const query = `
      INSERT INTO assignments (
        id, uuid, class_id, slot_id, session_id, title, description, instructions, deadline,
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
      resolvedSlotId,
      resolvedSlotId,
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
      'allow_late_submission', 'publish_status', 'session_id', 'slot_id'
    ];
    
    // Đồng bộ slot_id và session_id nếu 1 trong 2 được truyền vào
    const normalizedData = { ...data };
    if (normalizedData.slot_id !== undefined || normalizedData.session_id !== undefined) {
      const rawSlot = normalizedData.slot_id !== undefined ? normalizedData.slot_id : normalizedData.session_id;
      const resolved = (rawSlot && typeof rawSlot === 'string' && rawSlot.trim() !== '') ? rawSlot.trim() : (rawSlot || null);
      normalizedData.slot_id = resolved;
      normalizedData.session_id = resolved;
    }

    const fields = [];
    const values = [];
    let idx = 1;

    for (const key of allowedFields) {
      if (normalizedData[key] !== undefined) {
        fields.push(`${key} = $${idx}`);
        values.push(normalizedData[key]);
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
        COALESCE(a.slot_id, a.session_id) as slot_id,
        COALESCE(a.slot_id, a.session_id) as session_id,
        ses.session_no as slot_number,
        ses.session_no,
        ses.title as slot_title,
        ses.learning_date as slot_date,
        ses.slot_time,
        c.class_code, 
        c.lecturer_id,
        c.semester_id,
        s.id as subject_id,
        s.name as subject_name,
        s.code as subject_code,
        sem.name as semester_name,
        u.full_name as creator_name
      FROM assignments a
      JOIN classes c ON a.class_id = c.id
      JOIN subjects s ON c.subject_id = s.id
      LEFT JOIN sessions ses ON ses.id = COALESCE(a.slot_id, a.session_id)
      LEFT JOIN semesters sem ON c.semester_id = sem.id
      LEFT JOIN user_profiles u ON a.created_by = u.user_id
      WHERE a.id = $1 AND a.school_id = $2
    `;
    const { rows } = await pool.query(query, [id, schoolId]);
    return rows[0];
  },

  /**
   * Lấy danh sách phân trang (có filter theo class, role, trạng thái, slot_id)
   */
  async findMany({ page = 1, limit = 10, search, class_id, slot_id, session_id, publish_status }, user) {
    const offset = (page - 1) * limit;
    let whereClauses = [`a.school_id = $1`];
    let values = [tenant.schoolId];
    let idx = 2;

    // Filter by class_id if provided
    if (class_id) {
      whereClauses.push(`a.class_id = $${idx++}`);
      values.push(class_id);
    }

    // Filter by slot_id or session_id if provided
    const targetSlotId = slot_id || session_id;
    if (targetSlotId) {
      whereClauses.push(`(a.slot_id = $${idx} OR a.session_id = $${idx})`);
      values.push(targetSlotId);
      idx++;
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
        COALESCE(a.slot_id, a.session_id) as slot_id,
        COALESCE(a.slot_id, a.session_id) as session_id,
        ses.session_no as slot_number,
        ses.session_no,
        ses.title as slot_title,
        ses.learning_date as slot_date,
        ses.slot_time,
        c.class_code,
        c.semester_id,
        s.id as subject_id,
        s.name as subject_name,
        s.code as subject_code
      FROM assignments a
      JOIN classes c ON a.class_id = c.id
      JOIN subjects s ON c.subject_id = s.id
      LEFT JOIN sessions ses ON ses.id = COALESCE(a.slot_id, a.session_id)
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
  },

  /**
   * Xóa assignment và các quan hệ phụ thuộc an toàn trong Transaction
   */
  async deleteAssignmentWithRelations(id, { force = false } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Kiểm tra / lấy danh sách bài nộp
      const { rows: subs } = await client.query('SELECT id FROM submissions WHERE assignment_id = $1', [id]);
      const subIds = subs.map(s => s.id);

      if (subIds.length > 0) {
        if (!force) {
          const err = new Error(`Bài tập đã có ${subIds.length} bài nộp của sinh viên.`);
          err.code = 'SUBMISSIONS_EXIST';
          err.submissionCount = subIds.length;
          throw err;
        }

        // Xóa các bảng liên quan đến submissions
        await client.query('DELETE FROM grades WHERE submission_id = ANY($1)', [subIds]);
        await client.query('DELETE FROM submission_materials WHERE submission_id = ANY($1)', [subIds]);
        await client.query('DELETE FROM submission_versions WHERE submission_id = ANY($1)', [subIds]);
        await client.query('DELETE FROM ai_evaluations WHERE submission_id = ANY($1)', [subIds]);
        await client.query('DELETE FROM ai_interactions WHERE submission_id = ANY($1)', [subIds]);
        await client.query('DELETE FROM submissions WHERE assignment_id = $1', [id]);
      }

      // 2. Xóa các quan hệ trực tiếp của assignment
      await client.query('DELETE FROM ai_evaluations WHERE assignment_id = $1', [id]);
      await client.query('DELETE FROM ai_interactions WHERE assignment_id = $1', [id]);
      await client.query('DELETE FROM class_ai_advisories WHERE assignment_id = $1', [id]);
      await client.query('DELETE FROM assignment_rubric_configs WHERE assignment_id = $1', [id]);
      await client.query('DELETE FROM assignment_materials WHERE assignment_id = $1', [id]);

      // 3. Xóa chính assignment
      const { rows } = await client.query('DELETE FROM assignments WHERE id = $1 RETURNING *', [id]);

      await client.query('COMMIT');
      return rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Lấy danh sách cấu hình Rubric theo assignment_id
   */
  async getRubricConfigs(assignmentId, client = pool) {
    const query = `
      SELECT 
        id, assignment_id, criterion_key, criterion_name, is_enabled, weight_percent, display_order
      FROM assignment_rubric_configs
      WHERE assignment_id = $1
      ORDER BY display_order ASC;
    `;
    const { rows } = await client.query(query, [assignmentId]);
    return rows;
  },

  /**
   * Lưu hoặc cập nhật danh sách cấu hình Rubric
   */
  async saveRubricConfigs(assignmentId, configs, client = pool) {
    await client.query('DELETE FROM assignment_rubric_configs WHERE assignment_id = $1', [assignmentId]);
    if (!configs || configs.length === 0) return [];
    
    const saved = [];
    for (let i = 0; i < configs.length; i++) {
      const item = configs[i];
      const query = `
        INSERT INTO assignment_rubric_configs (
          assignment_id, criterion_key, criterion_name, is_enabled, weight_percent, display_order
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *;
      `;
      const values = [
        assignmentId,
        item.criterion_key,
        item.criterion_name,
        item.is_enabled !== false,
        parseInt(item.weight_percent, 10) || 0,
        parseInt(item.display_order, 10) || (i + 1)
      ];
      const { rows } = await client.query(query, values);
      saved.push(rows[0]);
    }
    return saved;
  }
};

module.exports = AssignmentRepository;