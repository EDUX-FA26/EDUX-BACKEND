const { pool } = require('../../config/db.config');

const ClassAiAdvisorRepository = {
  /**
   * Lấy toàn bộ danh sách snapshot đã lưu trong bảng class_ai_advisories của classId,
   * nối với bảng assignments để lấy thông tin hạn nộp (deadline),
   * sắp xếp theo thời điểm tạo snapshot mới nhất (generated_at DESC).
   */
  async getAdvisoriesByClassId(classId, schoolId) {
    let whereCondition = 'WHERE caa.class_id = $1::uuid';
    const params = [classId];
    if (schoolId) {
      whereCondition += ' AND (caa.school_id = $2::uuid OR caa.school_id IS NULL)';
      params.push(schoolId);
    }

    const query = `
      SELECT
        caa.id,
        caa.school_id,
        caa.class_id,
        caa.assignment_id,
        caa.assignment_title,
        caa.mode,
        caa.submission_rate_text,
        caa.avg_ai_transparency,
        caa.common_error_clusters,
        caa.next_slot_recommendation,
        caa.raw_payload,
        caa.generated_at,
        a.deadline,
        a.publish_status
      FROM class_ai_advisories caa
      LEFT JOIN assignments a ON caa.assignment_id = a.id
      ${whereCondition}
      ORDER BY caa.generated_at DESC;
    `;
    const { rows } = await pool.query(query, params);
    return rows;
  },

  /**
   * Lấy bài tập phù hợp nhất cho tư vấn AI:
   * Ưu tiên 1: Đã qua deadline (deadline < NOW())
   * Ưu tiên 2: Nếu chưa qua deadline nhưng đã có sinh viên nộp bài (status != 'draft')
   * Ưu tiên 3: Bài tập gần nhất của lớp
   */
  async getLatestAssignmentForAdvisory(classId, schoolId) {
    let whereCondition = 'WHERE a.class_id = $1::uuid';
    let subSchoolCheck = '';
    const params = [classId];
    if (schoolId) {
      whereCondition += ' AND a.school_id = $2::uuid';
      subSchoolCheck = 'AND s.school_id = a.school_id';
      params.push(schoolId);
    }

    const query = `
      SELECT
        a.id,
        a.title,
        a.description,
        a.instructions,
        a.deadline,
        a.class_id,
        a.publish_status,
        a.created_at,
        COUNT(s.id)::int AS submission_count
      FROM assignments a
      LEFT JOIN submissions s ON a.id = s.assignment_id AND s.status != 'draft' ${subSchoolCheck}
      ${whereCondition}
      GROUP BY a.id
      ORDER BY 
        -- Ưu tiên 1: Đã qua deadline VÀ có bài nộp
        (a.deadline IS NOT NULL AND a.deadline < NOW() AND COUNT(s.id) > 0) DESC,
        -- Ưu tiên 1b: Đã qua deadline
        (a.deadline IS NOT NULL AND a.deadline < NOW()) DESC,
        -- Ưu tiên 2: Chưa qua deadline nhưng đã có sinh viên nộp bài
        (COUNT(s.id) > 0) DESC,
        -- Ưu tiên 3: Theo deadline gần nhất hoặc mới tạo nhất
        a.deadline DESC NULLS LAST,
        a.created_at DESC
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, params);
    return rows[0] || null;
  },

  /**
   * Lấy danh sách bài tập của lớp phục vụ tư vấn AI
   */
  async getAssignmentsForAdvisory(classId, schoolId) {
    let whereCondition = 'WHERE a.class_id = $1::uuid';
    let subSchoolCheck = '';
    const params = [classId];
    if (schoolId) {
      whereCondition += ' AND a.school_id = $2::uuid';
      subSchoolCheck = 'AND s.school_id = a.school_id';
      params.push(schoolId);
    }

    const query = `
      SELECT
        a.id,
        a.title,
        a.description,
        a.instructions,
        a.deadline,
        a.class_id,
        a.publish_status,
        a.created_at,
        COUNT(s.id)::int AS submission_count
      FROM assignments a
      LEFT JOIN submissions s ON a.id = s.assignment_id AND s.status != 'draft' ${subSchoolCheck}
      ${whereCondition}
      GROUP BY a.id
      ORDER BY 
        (a.deadline IS NOT NULL AND a.deadline < NOW() AND COUNT(s.id) > 0) DESC,
        (a.deadline IS NOT NULL AND a.deadline < NOW()) DESC,
        (COUNT(s.id) > 0) DESC,
        a.deadline DESC NULLS LAST,
        a.created_at DESC;
    `;
    const { rows } = await pool.query(query, params);
    return rows;
  },

  /**
   * Lấy toàn bộ danh sách bài tập/lab quá hạn nộp (deadline < NOW()) của một lớp học từ bảng assignments,
   * sắp xếp theo hạn nộp gần nhất trước (deadline DESC).
   */
  async getExpiredAssignmentsByClassId(classId, schoolId) {
    let whereCondition = 'WHERE a.class_id = $1::uuid AND a.deadline IS NOT NULL AND a.deadline < NOW()';
    const params = [classId];
    if (schoolId) {
      whereCondition += ' AND a.school_id = $2::uuid';
      params.push(schoolId);
    }
    const query = `
      SELECT
        a.id,
        a.title,
        a.description,
        a.instructions,
        a.deadline,
        a.class_id,
        a.publish_status,
        a.created_at
      FROM assignments a
      ${whereCondition}
      ORDER BY a.deadline DESC;
    `;
    const { rows } = await pool.query(query, params);
    return rows;
  },

  /**
   * Kiểm tra bài tập quá hạn nộp gần nhất (deadline < NOW()) của một lớp học.
   */
  async getLatestExpiredAssignment(classId, schoolId) {
    let whereCondition = 'WHERE a.class_id = $1::uuid AND a.deadline IS NOT NULL AND a.deadline < NOW()';
    const params = [classId];
    if (schoolId) {
      whereCondition += ' AND a.school_id = $2::uuid';
      params.push(schoolId);
    }
    const query = `
      SELECT
        a.id,
        a.title,
        a.description,
        a.instructions,
        a.deadline,
        a.class_id
      FROM assignments a
      ${whereCondition}
      ORDER BY a.deadline DESC
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, params);
    return rows[0] || null;
  },

  /**
   * Lấy snapshot advisory theo class_id và assignment_id
   */
  async getAdvisoryByClassAndAssignment(classId, assignmentId, schoolId) {
    let whereCondition = 'WHERE class_id = $1::uuid AND assignment_id = $2::uuid';
    const params = [classId, assignmentId];
    if (schoolId) {
      whereCondition += ' AND (school_id = $3::uuid OR school_id IS NULL)';
      params.push(schoolId);
    }
    const query = `
      SELECT *
      FROM class_ai_advisories
      ${whereCondition}
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, params);
    return rows[0] || null;
  },

  /**
   * Lấy thông tin lớp học, môn học và tổng số sinh viên đăng ký
   */
  async getClassAndMemberStats(classId, schoolId) {
    let whereCondition = 'WHERE c.id = $1::uuid';
    const params = [classId];
    if (schoolId) {
      whereCondition += ' AND c.school_id = $2::uuid';
      params.push(schoolId);
    }
    const query = `
      SELECT
        c.id,
        c.class_code,
        s.name AS subject_name,
        s.code AS subject_code,
        COALESCE(
          (SELECT COUNT(*)::int FROM class_members cm WHERE cm.class_id = c.id AND cm.status = 'active'),
          0
        ) AS total_students
      FROM classes c
      LEFT JOIN subjects s ON c.subject_id = s.id
      ${whereCondition};
    `;
    const { rows } = await pool.query(query, params);
    return rows[0] || null;
  },

  /**
   * Lấy danh sách bài nộp và báo cáo audit AI của sinh viên trong lớp cho một bài tập
   */
  async getSubmissionsAndAuditForAssignment(classId, assignmentId, schoolId) {
    let schoolFilter = '';
    const params = [classId, assignmentId];
    if (schoolId) {
      schoolFilter = 'AND a.school_id = $3::uuid AND (s.school_id = a.school_id OR s.school_id IS NULL)';
      params.push(schoolId);
    }
    const query = `
      SELECT
        s.id AS submission_id,
        s.student_id,
        s.status,
        s.submitted_at,
        u.full_name AS student_name,
        sv.files,
        sv.note AS ai_declarations_note,
        ae.transparency_score,
        ae.risk_level,
        ae.pattern,
        ae.summary AS audit_summary,
        ae.rubric_scores,
        ae.evaluation_data,
        ae.overall_verdict
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id AND a.class_id = $1::uuid
      LEFT JOIN class_members cm ON s.student_id = cm.student_id AND cm.class_id = $1::uuid
      LEFT JOIN user_profiles u ON s.student_id = u.user_id
      LEFT JOIN LATERAL (
        SELECT files, note
        FROM submission_versions
        WHERE submission_id = s.id AND is_latest = TRUE
        ORDER BY version_no DESC
        LIMIT 1
      ) sv ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          transparency_score,
          risk_level,
          pattern,
          summary,
          rubric_scores,
          evaluation_data,
          overall_verdict
        FROM ai_evaluations
        WHERE submission_id = s.id
        ORDER BY evaluated_at DESC NULLS LAST, created_at DESC
        LIMIT 1
      ) ae ON TRUE
      WHERE s.assignment_id = $2::uuid
        AND s.status != 'draft'
        ${schoolFilter};
    `;
    const { rows } = await pool.query(query, params);
    return rows;
  },

  /**
   * Lưu hoặc cập nhật (upsert) bản ghi snapshot khuyến nghị AI cho bài tập
   */
  async upsertAdvisory({
    school_id,
    class_id,
    assignment_id,
    assignment_title,
    mode = 'DEEP_TECHNICAL',
    submission_rate_text,
    avg_ai_transparency,
    common_error_clusters,
    next_slot_recommendation,
    raw_payload
  }) {
    const query = `
      INSERT INTO class_ai_advisories (
        school_id,
        class_id,
        assignment_id,
        assignment_title,
        mode,
        submission_rate_text,
        avg_ai_transparency,
        common_error_clusters,
        next_slot_recommendation,
        raw_payload,
        generated_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (class_id, assignment_id) DO UPDATE SET
        school_id = COALESCE(EXCLUDED.school_id, class_ai_advisories.school_id),
        assignment_title = EXCLUDED.assignment_title,
        mode = EXCLUDED.mode,
        submission_rate_text = EXCLUDED.submission_rate_text,
        avg_ai_transparency = EXCLUDED.avg_ai_transparency,
        common_error_clusters = EXCLUDED.common_error_clusters,
        next_slot_recommendation = EXCLUDED.next_slot_recommendation,
        raw_payload = EXCLUDED.raw_payload,
        generated_at = NOW()
      RETURNING *;
    `;
    const values = [
      school_id || null,
      class_id,
      assignment_id,
      assignment_title,
      mode,
      submission_rate_text,
      avg_ai_transparency,
      JSON.stringify(common_error_clusters || []),
      next_slot_recommendation,
      JSON.stringify(raw_payload || {})
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }
};

module.exports = ClassAiAdvisorRepository;

