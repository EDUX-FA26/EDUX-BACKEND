const { pool } = require('../../config/db.config');

const GradingRepository = {
  // ─── Submissions ──────────────────────────────────────────────────────────

  /**
   * Lấy submission kèm thông tin assignment + class theo school_id
   * để backend tự xác định assignment_id, student_id, class_id
   */
  async findSubmissionById(submissionId, schoolId) {
    const query = `
      SELECT
        s.id                  AS submission_id,
        s.school_id,
        s.student_id,
        s.assignment_id,
        s.status              AS submission_status,
        a.class_id,
        a.max_score           AS assignment_max_score,
        c.lecturer_id
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id AND a.school_id = s.school_id
      JOIN classes     c ON a.class_id      = c.id AND c.school_id = s.school_id
      WHERE s.id = $1 AND s.school_id = $2
    `;
    const { rows } = await pool.query(query, [submissionId, schoolId]);
    return rows[0] || null;
  },

  // ─── Grades CRUD ──────────────────────────────────────────────────────────

  /**
   * Tạo grade mới
   */
  async create({ school_id, submission_id, assignment_id, student_id, class_id, score, max_score, feedback, graded_by, rubrics }) {
    const query = `
      INSERT INTO grades
        (school_id, submission_id, assignment_id, student_id, class_id,
         score, max_score, feedback, graded_by, graded_at, rubrics)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
      RETURNING *
    `;
    const { rows } = await pool.query(query, [
      school_id, submission_id, assignment_id, student_id, class_id,
      score, max_score, feedback, graded_by,
      rubrics ? JSON.stringify(rubrics) : null,
    ]);
    return rows[0];
  },

  /**
   * Tìm grade theo id và school_id
   */
  async findById(id, schoolId) {
    const query = `
      SELECT
        g.*,
        up_student.full_name  AS student_name,
        up_grader.full_name   AS graded_by_name,
        a.title               AS assignment_title,
        c.class_code,
        c.lecturer_id
      FROM grades g
      LEFT JOIN user_profiles up_student ON g.student_id    = up_student.user_id
      LEFT JOIN user_profiles up_grader  ON g.graded_by     = up_grader.user_id
      LEFT JOIN assignments   a          ON g.assignment_id = a.id AND a.school_id = g.school_id
      JOIN classes            c          ON g.class_id      = c.id AND c.school_id = g.school_id
      WHERE g.id = $1 AND g.school_id = $2
    `;
    const { rows } = await pool.query(query, [id, schoolId]);
    return rows[0] || null;
  },

  /**
   * Tìm grade theo submission_id và school_id
   */
  async findBySubmissionId(submissionId, schoolId) {
    const query = `SELECT * FROM grades WHERE submission_id = $1 AND school_id = $2 ORDER BY created_at DESC LIMIT 1`;
    const { rows } = await pool.query(query, [submissionId, schoolId]);
    return rows[0] || null;
  },

  /**
   * Cập nhật grade (partial update) theo school_id
   */
  async update(id, schoolId, { score, max_score, feedback, rubrics }) {
    const fields = [];
    const values = [];
    let idx = 1;

    if (score !== undefined) { fields.push(`score     = $${idx++}`); values.push(score); }
    if (max_score !== undefined) { fields.push(`max_score = $${idx++}`); values.push(max_score); }
    if (feedback !== undefined) { fields.push(`feedback  = $${idx++}`); values.push(feedback); }
    if (rubrics !== undefined) { fields.push(`rubrics   = $${idx++}`); values.push(rubrics ? JSON.stringify(rubrics) : null); }

    if (fields.length === 0) return null;

    fields.push(`updated_at = NOW()`);
    values.push(id, schoolId);

    const query = `
      UPDATE grades
      SET    ${fields.join(', ')}
      WHERE  id = $${idx} AND school_id = $${idx + 1}
      RETURNING *
    `;
    const { rows } = await pool.query(query, values);
    return rows[0];
  },

  /**
   * Tìm AI evaluation snapshot theo submission_id và school_id
   */
  async findAiEvaluationBySubmissionId(submissionId, schoolId) {
    const query = `
      SELECT *
      FROM ai_evaluations
      WHERE submission_id = $1 AND school_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(query, [submissionId, schoolId]);
    return rows[0] || null;
  },

  /**
   * Lưu AI evaluation snapshot vào DB
   */
  async saveAiEvaluation({
    school_id,
    submission_id,
    submission_version_id,
    assignment_id,
    student_id,
    class_id,
    pattern = 'collaborative_usage',
    risk_level = 'low',
    transparency_score = 95.0,
    summary = '',
    evaluation_data = null,
    rubric_scores = null,
    viva_questions = null,
    total_score = null,
    overall_verdict = ''
  }) {
    const query = `
      INSERT INTO ai_evaluations
        (school_id, submission_id, submission_version_id, assignment_id, student_id, class_id,
         pattern, risk_level, transparency_score, summary,
         evaluation_data, rubric_scores, viva_questions, total_score, overall_verdict, evaluated_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
      ON CONFLICT (submission_version_id) DO UPDATE SET
        pattern = EXCLUDED.pattern,
        risk_level = EXCLUDED.risk_level,
        transparency_score = EXCLUDED.transparency_score,
        summary = EXCLUDED.summary,
        evaluation_data = EXCLUDED.evaluation_data,
        rubric_scores = EXCLUDED.rubric_scores,
        viva_questions = EXCLUDED.viva_questions,
        total_score = EXCLUDED.total_score,
        overall_verdict = EXCLUDED.overall_verdict,
        evaluated_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `;
    const { rows } = await pool.query(query, [
      school_id,
      submission_id,
      submission_version_id,
      assignment_id,
      student_id,
      class_id,
      pattern,
      risk_level,
      transparency_score,
      summary,
      evaluation_data ? JSON.stringify(evaluation_data) : null,
      rubric_scores ? JSON.stringify(rubric_scores) : null,
      viva_questions ? JSON.stringify(viva_questions) : null,
      total_score,
      overall_verdict
    ]);
    return rows[0];
  },

  // ─── Gradebook queries ────────────────────────────────────────────────────

  /**
   * Lấy tất cả assignments thuộc class (chỉ published) theo school_id
   */
  async findAssignmentsByClass(classId, schoolId) {
    const query = `
      SELECT id, title, max_score, weight
      FROM   assignments
      WHERE  class_id = $1
        AND  school_id = $2
        AND  publish_status = 'published'
      ORDER BY created_at ASC
    `;
    const { rows } = await pool.query(query, [classId, schoolId]);
    return rows;
  },

  /**
   * Lấy tất cả students trong class (active) theo school_id
   */
  async findStudentsByClass(classId, schoolId) {
    const query = `
      SELECT
        cm.student_id,
        u.email,
        up.full_name,
        up.student_code
      FROM class_members cm
      JOIN users              u  ON cm.student_id = u.id
      LEFT JOIN user_profiles up ON u.id          = up.user_id
      WHERE cm.class_id  = $1
        AND cm.school_id = $2
        AND cm.status    = 'active'
      ORDER BY up.student_code ASC
    `;
    const { rows } = await pool.query(query, [classId, schoolId]);
    return rows;
  },

  /**
   * Lấy tất cả grades thuộc class theo school_id
   */
  async findGradesByClass(classId, schoolId) {
    const query = `
      SELECT
        g.student_id,
        g.assignment_id,
        g.score,
        g.max_score,
        g.feedback,
        g.graded_at
      FROM grades g
      WHERE g.class_id = $1 AND g.school_id = $2
    `;
    const { rows } = await pool.query(query, [classId, schoolId]);
    return rows;
  },

  /**
   * Kiểm tra class tồn tại trong trường hiện tại + lấy lecturer_id
   */
  async findClassById(classId, schoolId) {
    const { rows } = await pool.query(
      `SELECT id, class_code, lecturer_id, school_id FROM classes WHERE id = $1 AND school_id = $2`,
      [classId, schoolId]
    );
    return rows[0] || null;
  },

  /**
   * Cập nhật submission status → 'graded'
   */
  async markSubmissionGraded(submissionId, schoolId) {
    await pool.query(
      `UPDATE submissions SET status = 'graded', updated_at = NOW() WHERE id = $1 AND school_id = $2`,
      [submissionId, schoolId]
    );
  },

  /**
   * Lấy toàn bộ dữ liệu cần thiết cho việc thẩm định điểm AI Rubric theo school_id
   */
  async getSubmissionAuditData(submissionId, schoolId) {
    const subQuery = `
      SELECT
        s.id                  AS submission_id,
        s.school_id,
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
      JOIN assignments a ON s.assignment_id = a.id AND a.school_id = s.school_id
      JOIN classes     c ON a.class_id      = c.id AND c.school_id = s.school_id
      JOIN users       u ON s.student_id    = u.id
      LEFT JOIN user_profiles up ON u.id    = up.user_id
      WHERE s.id = $1 AND s.school_id = $2
    `;
    const { rows: subRows } = await pool.query(subQuery, [submissionId, schoolId]);
    if (subRows.length === 0) return null;
    const submissionData = subRows[0];

    const versionQuery = `
      SELECT *
      FROM submission_versions
      WHERE submission_id = $1 AND school_id = $2 AND is_latest = TRUE
      LIMIT 1
    `;
    const { rows: versionRows } = await pool.query(versionQuery, [submissionId, schoolId]);
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
        WHERE submission_id = $1 AND school_id = $2
        ORDER BY created_at ASC
      `;
      const { rows: aiRows } = await pool.query(aiQuery, [submissionId, schoolId]);
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
        WHERE submission_id = $1 AND school_id = $2
        LIMIT 1
      `;
      const { rows: evalRows } = await pool.query(evalQuery, [submissionId, schoolId]);
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