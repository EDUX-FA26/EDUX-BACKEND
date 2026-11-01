const { pool } = require('../../config/db.config');

const GradingRepository = {
  // ─── Submissions ──────────────────────────────────────────────────────────

  /**
   * Lấy submission kèm thông tin assignment + class
   * để backend tự xác định assignment_id, student_id, class_id
   */
  async findSubmissionById(submissionId) {
    const query = `
      SELECT
        s.id                  AS submission_id,
        s.student_id,
        s.assignment_id,
        s.status              AS submission_status,
        a.class_id,
        a.max_score           AS assignment_max_score,
        c.lecturer_id
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      JOIN classes     c ON a.class_id      = c.id
      WHERE s.id = $1
    `;
    const { rows } = await pool.query(query, [submissionId]);
    return rows[0] || null;
  },

  // ─── Grades CRUD ──────────────────────────────────────────────────────────

  /**
   * Tạo grade mới
   */
  async create({ submission_id, assignment_id, student_id, class_id, score, max_score, feedback, graded_by }) {
    const query = `
      INSERT INTO grades
        (submission_id, assignment_id, student_id, class_id,
         score, max_score, feedback, graded_by, graded_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `;
    const { rows } = await pool.query(query, [
      submission_id, assignment_id, student_id, class_id,
      score, max_score, feedback, graded_by,
    ]);
    return rows[0];
  },

  /**
   * Tìm grade theo id
   */
  async findById(id) {
    const query = `
      SELECT
        g.*,
        up_student.full_name  AS student_name,
        up_grader.full_name   AS graded_by_name,
        a.title               AS assignment_title,
        c.class_code
      FROM grades g
      JOIN user_profiles  up_student ON g.student_id  = up_student.user_id
      JOIN user_profiles  up_grader  ON g.graded_by   = up_grader.user_id
      JOIN assignments    a          ON g.assignment_id = a.id
      JOIN classes        c          ON g.class_id     = c.id
      WHERE g.id = $1
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;
  },

  /**
   * Tìm grade theo submission_id
   */
  async findBySubmissionId(submissionId) {
    const query = `SELECT * FROM grades WHERE submission_id = $1 ORDER BY created_at DESC LIMIT 1`;
    const { rows } = await pool.query(query, [submissionId]);
    return rows[0] || null;
  },

  /**
   * Cập nhật grade (partial update)
   */
  async update(id, { score, max_score, feedback }) {
    const fields = [];
    const values = [];
    let idx = 1;

    if (score !== undefined) { fields.push(`score     = $${idx++}`); values.push(score); }
    if (max_score !== undefined) { fields.push(`max_score = $${idx++}`); values.push(max_score); }
    if (feedback !== undefined) { fields.push(`feedback  = $${idx++}`); values.push(feedback); }

    if (fields.length === 0) return null;

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE grades
      SET    ${fields.join(', ')}
      WHERE  id = $${idx}
      RETURNING *
    `;
    const { rows } = await pool.query(query, values);
    return rows[0];
  },

  // ─── Gradebook queries ────────────────────────────────────────────────────

  /**
   * Lấy tất cả assignments thuộc class (chỉ published)
   */
  async findAssignmentsByClass(classId) {
    const query = `
      SELECT id, title, max_score, weight
      FROM   assignments
      WHERE  class_id = $1
        AND  publish_status = 'published'
      ORDER BY created_at ASC
    `;
    const { rows } = await pool.query(query, [classId]);
    return rows;
  },

  /**
   * Lấy tất cả students trong class (active)
   */
  async findStudentsByClass(classId) {
    const query = `
      SELECT
        cm.student_id,
        u.email,
        up.full_name,
        up.student_code
      FROM class_members cm
      JOIN users         u  ON cm.student_id = u.id
      JOIN user_profiles up ON u.id          = up.user_id
      WHERE cm.class_id = $1
        AND cm.status   = 'active'
      ORDER BY up.student_code ASC
    `;
    const { rows } = await pool.query(query, [classId]);
    return rows;
  },

  /**
   * Lấy tất cả grades thuộc class
   */
  async findGradesByClass(classId) {
    const query = `
      SELECT
        g.student_id,
        g.assignment_id,
        g.score,
        g.max_score,
        g.feedback,
        g.graded_at
      FROM grades g
      WHERE g.class_id = $1
    `;
    const { rows } = await pool.query(query, [classId]);
    return rows;
  },

  /**
   * Kiểm tra class tồn tại + lấy lecturer_id
   */
  async findClassById(classId) {
    const { rows } = await pool.query(
      `SELECT id, class_code, lecturer_id FROM classes WHERE id = $1`,
      [classId]
    );
    return rows[0] || null;
  },

  /**
   * Cập nhật submission status → 'graded'
   */
  async markSubmissionGraded(submissionId) {
    await pool.query(
      `UPDATE submissions SET status = 'graded', updated_at = NOW() WHERE id = $1`,
      [submissionId]
    );
  },

  /**
   * Lấy toàn bộ dữ liệu cần thiết cho việc thẩm định điểm AI Rubric
   */
  async getSubmissionAuditData(submissionId) {
    const subQuery = `
      SELECT
        s.id                  AS submission_id,
        s.student_id,
        s.assignment_id,
        s.status              AS submission_status,
        s.latest_version_no,
        a.title               AS assignment_title,
        a.description         AS assignment_description,
        a.instructions        AS assignment_instructions,
        a.max_score           AS assignment_max_score,
        a.class_id,
        c.lecturer_id,
        up.full_name          AS student_name,
        up.student_code,
        u.email               AS student_email
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      JOIN classes     c ON a.class_id      = c.id
      JOIN users       u ON s.student_id    = u.id
      LEFT JOIN user_profiles up ON u.id    = up.user_id
      WHERE s.id = $1
    `;
    const { rows: subRows } = await pool.query(subQuery, [submissionId]);
    if (subRows.length === 0) return null;
    const submissionData = subRows[0];

    const versionQuery = `
      SELECT *
      FROM submission_versions
      WHERE submission_id = $1 AND is_latest = TRUE
      LIMIT 1
    `;
    const { rows: versionRows } = await pool.query(versionQuery, [submissionId]);
    const latestVersion = versionRows[0] || null;

    let aiInteractions = [];
    try {
      const aiQuery = `
        SELECT
          ai_tool,
          usage_purpose,
          prompt_content,
          ai_response_summary,
          student_decision,
          reflection_text,
          created_at
        FROM ai_interactions
        WHERE submission_id = $1
        ORDER BY created_at ASC
      `;
      const { rows: aiRows } = await pool.query(aiQuery, [submissionId]);
      aiInteractions = aiRows || [];
    } catch (e) {
      // Safe fallback - no crash if table query fails
      aiInteractions = [];
    }

    let aiEvaluation = null;
    try {
      const evalQuery = `
        SELECT
          pattern,
          risk_level,
          transparency_score,
          summary
        FROM ai_evaluations
        WHERE submission_id = $1
        LIMIT 1
      `;
      const { rows: evalRows } = await pool.query(evalQuery, [submissionId]);
      aiEvaluation = evalRows[0] || null;
    } catch (e) {
      // Safe fallback - no crash if table query fails
      aiEvaluation = null;
    }

    return {
      submission: submissionData,
      latestVersion,
      aiInteractions,
      aiEvaluation,
    };
  },
};

module.exports = GradingRepository;