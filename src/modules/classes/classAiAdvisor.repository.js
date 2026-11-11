const { pool } = require('../../config/db.config');

const ClassAiAdvisorRepository = {
  /**
   * Lấy toàn bộ danh sách snapshot đã lưu trong bảng class_ai_advisories của classId,
   * nối với bảng assignments để lấy thông tin hạn nộp (deadline),
   * sắp xếp theo hạn nộp bài tập mới nhất trước.
   */
  async getAdvisoriesByClassId(classId) {
    const query = `
      SELECT
        caa.id,
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
      WHERE caa.class_id = $1
      ORDER BY COALESCE(a.deadline, caa.generated_at) DESC;
    `;
    const { rows } = await pool.query(query, [classId]);
    return rows;
  },

  /**
   * Lấy toàn bộ danh sách bài tập/lab quá hạn nộp (deadline < NOW()) của một lớp học từ bảng assignments,
   * sắp xếp theo hạn nộp gần nhất trước (deadline DESC).
   */
  async getExpiredAssignmentsByClassId(classId) {
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
      WHERE a.class_id = $1
        AND a.deadline IS NOT NULL
        AND a.deadline < NOW()
      ORDER BY a.deadline DESC;
    `;
    const { rows } = await pool.query(query, [classId]);
    return rows;
  },

  /**
   * Kiểm tra bài tập quá hạn nộp gần nhất (deadline < NOW()) của một lớp học.
   */
  async getLatestExpiredAssignment(classId) {
    const query = `
      SELECT
        a.id,
        a.title,
        a.description,
        a.instructions,
        a.deadline,
        a.class_id
      FROM assignments a
      WHERE a.class_id = $1
        AND a.deadline IS NOT NULL
        AND a.deadline < NOW()
      ORDER BY a.deadline DESC
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, [classId]);
    return rows[0] || null;
  },

  /**
   * Lấy snapshot advisory theo class_id và assignment_id
   */
  async getAdvisoryByClassAndAssignment(classId, assignmentId) {
    const query = `
      SELECT *
      FROM class_ai_advisories
      WHERE class_id = $1 AND assignment_id = $2
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, [classId, assignmentId]);
    return rows[0] || null;
  },

  /**
   * Lấy thông tin lớp học, môn học và tổng số sinh viên đăng ký
   */
  async getClassAndMemberStats(classId) {
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
      WHERE c.id = $1;
    `;
    const { rows } = await pool.query(query, [classId]);
    return rows[0] || null;
  },

  /**
   * Lấy danh sách bài nộp và báo cáo audit AI của sinh viên trong lớp cho một bài tập
   */
  async getSubmissionsAndAuditForAssignment(classId, assignmentId) {
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
      JOIN assignments a ON s.assignment_id = a.id AND a.class_id = $1
      LEFT JOIN class_members cm ON s.student_id = cm.student_id AND cm.class_id = $1
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
      WHERE s.assignment_id = $2
        AND s.status != 'draft';
    `;
    const { rows } = await pool.query(query, [classId, assignmentId]);
    return rows;
  },

  /**
   * Lưu hoặc cập nhật (upsert) bản ghi snapshot khuyến nghị AI cho bài tập
   */
  async upsertAdvisory({
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (class_id, assignment_id) DO UPDATE SET
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

