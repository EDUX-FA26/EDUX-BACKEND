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
        s.id,
        s.school_id,
        s.student_id,
        s.assignment_id,
        s.status              AS submission_status,
        a.title               AS assignment_title,
        a.class_id,
        a.max_score           AS assignment_max_score,
        a.ai_declaration_required AS assignment_ai_declaration_required,
        c.lecturer_id,
        c.subject_id
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
    // Chuẩn hóa an toàn risk_level theo check constraint DB: CHECK (risk_level IN ('low', 'medium', 'high'))
    const cleanRisk = String(risk_level || 'low').trim().toLowerCase();
    const safeRisk = (cleanRisk === 'high' || cleanRisk === 'high_risk' || cleanRisk === 'danger' || cleanRisk === 'critical')
      ? 'high'
      : ((cleanRisk === 'medium' || cleanRisk === 'medium_risk' || cleanRisk === 'med' || cleanRisk === 'moderate') ? 'medium' : 'low');

    // Chuẩn hóa pattern theo check constraint DB: CHECK (pattern IN ('critical_engagement', 'collaborative_usage', 'passive_usage', 'high_dependency'))
    const allowedPatterns = ['critical_engagement', 'collaborative_usage', 'passive_usage', 'high_dependency'];
    const safePattern = allowedPatterns.includes(String(pattern).toLowerCase()) ? String(pattern).toLowerCase() : 'collaborative_usage';

    const safeScore = Math.max(0, Math.min(100, Number(transparency_score) || 0));

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
      safePattern,
      safeRisk,
      safeScore,
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
        s.no_ai_used,
        s.no_ai_note,
        a.title               AS assignment_title,
        a.description         AS assignment_description,
        a.instructions        AS assignment_instructions,
        a.max_score           AS assignment_max_score,
        a.ai_declaration_required AS assignment_ai_declaration_required,
        a.class_id,
        c.lecturer_id,
        c.subject_id,
        s_subj.name           AS subject_name,
        s_subj.code           AS subject_code,
        up.full_name          AS student_name,
        up.student_code,
        u.email               AS student_email
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id AND a.school_id = s.school_id
      JOIN classes     c ON a.class_id      = c.id AND c.school_id = s.school_id
      LEFT JOIN subjects s_subj ON c.subject_id = s_subj.id
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

    let courseTopics = [];
    if (submissionData.subject_id) {
      try {
        const topicQuery = `
          SELECT id, subject_id, name, code, description, parent_id, is_active
          FROM topics
          WHERE subject_id = $1 
            AND is_active = TRUE 
            AND (school_id = $2 OR school_id IS NULL)
            AND (status = 'approved' OR status IS NULL)
            AND (review_required = FALSE OR review_required IS NULL)
          ORDER BY name ASC
        `;
        const { rows: tRows } = await pool.query(topicQuery, [submissionData.subject_id, schoolId]);
        courseTopics = tRows || [];
      } catch (e) {
        courseTopics = [];
      }
    }

    return {
      submission: submissionData,
      latestVersion,
      aiInteractions,
      aiEvaluation,
      courseTopics,
      hasCourseTopics: courseTopics.length > 0,
    };
  },

  /**
   * Lưu các topic được đề xuất củng cố từ AI hoặc Giảng viên vào submission_review_topics
   */
  async saveSubmissionReviewTopics({
    school_id,
    submission_id,
    submission_version_id = null,
    ai_evaluation_id = null,
    student_id,
    class_id,
    subject_id,
    topics = [],
    source = 'ai',
    status = 'pending_review',
    reviewerId = null,
  }) {
    if (!Array.isArray(topics) || topics.length === 0) return [];

    // Tự động giải quyết metadata nếu caller chưa truyền đầy đủ
    if ((!class_id || !subject_id || !student_id || !school_id) && submission_id) {
      try {
        const sRes = await pool.query(
          `SELECT s.student_id, a.class_id, c.subject_id, s.school_id
           FROM submissions s
           JOIN assignments a ON s.assignment_id = a.id
           JOIN classes c ON a.class_id = c.id
           WHERE s.id = $1 LIMIT 1`,
          [submission_id]
        );
        if (sRes.rows[0]) {
          student_id = student_id || sRes.rows[0].student_id;
          class_id = class_id || sRes.rows[0].class_id;
          subject_id = subject_id || sRes.rows[0].subject_id;
          school_id = school_id || sRes.rows[0].school_id;
        }
      } catch (_) {}
    }

    if (!submission_version_id && submission_id) {
      try {
        const vRes = await pool.query(
          `SELECT id FROM submission_versions WHERE submission_id = $1 AND is_latest = TRUE LIMIT 1`,
          [submission_id]
        );
        submission_version_id = vRes.rows[0]?.id || null;
      } catch (_) {}
    }

    const results = [];
    for (const item of topics) {
      const topicId = item.topic_id || item.id || item.topicId;
      if (!topicId) continue;

      const priority = ['high', 'medium', 'low'].includes(String(item.priority).toLowerCase())
        ? String(item.priority).toLowerCase()
        : 'medium';
      const reason = String(item.reason || item.comment || '').trim();
      const currentStatus = item.status || status || 'pending_review';

      try {
        const existRes = await pool.query(
          `SELECT id, status, reviewed_at FROM submission_review_topics 
           WHERE submission_id = $1 AND topic_id = $2 LIMIT 1`,
          [submission_id, topicId]
        );

        if (existRes.rows[0]) {
          const existingRow = existRes.rows[0];
          const finalStatus = ['approved', 'consumed'].includes(existingRow.status) ? existingRow.status : currentStatus;
          const finalReviewedAt = (finalStatus === 'approved' && !existingRow.reviewed_at) ? new Date() : existingRow.reviewed_at;

          const updateQuery = `
            UPDATE submission_review_topics
            SET 
              submission_version_id = COALESCE($1, submission_version_id),
              ai_evaluation_id = COALESCE($2, ai_evaluation_id),
              priority = $3,
              reason = $4,
              source = $5,
              status = $6,
              reviewed_by = COALESCE($7, reviewed_by),
              reviewed_at = $8,
              updated_at = NOW()
            WHERE id = $9
            RETURNING *
          `;
          const { rows } = await pool.query(updateQuery, [
            submission_version_id,
            ai_evaluation_id,
            priority,
            reason,
            source,
            finalStatus,
            reviewerId,
            finalReviewedAt,
            existingRow.id,
          ]);
          if (rows[0]) results.push(rows[0]);
        } else {
          const insertReviewedAt = currentStatus === 'approved' ? new Date() : null;
          const insertQuery = `
            INSERT INTO submission_review_topics
              (school_id, submission_id, submission_version_id, ai_evaluation_id,
               student_id, class_id, subject_id, topic_id,
               priority, reason, source, status, reviewed_by, reviewed_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
            RETURNING *
          `;
          const { rows } = await pool.query(insertQuery, [
            school_id,
            submission_id,
            submission_version_id,
            ai_evaluation_id,
            student_id,
            class_id,
            subject_id,
            topicId,
            priority,
            reason,
            source,
            currentStatus,
            reviewerId,
            insertReviewedAt,
          ]);
          if (rows[0]) results.push(rows[0]);
        }
      } catch (err) {
        console.error(`[saveSubmissionReviewTopics] Failed to insert/update topic ${topicId}:`, err.message);
      }
    }
    return results;
  },

  /**
   * Lấy danh sách topic review của một bài nộp (kèm thông tin tên topic)
   */
  async getReviewTopicsBySubmission(submissionId, schoolId) {
    const query = `
      SELECT 
        srt.id,
        srt.submission_id AS "submissionId",
        srt.topic_id AS "topicId",
        srt.topic_id,
        t.name AS "topicName",
        t.name AS "topic_name",
        t.code AS "topicCode",
        t.code AS "topic_code",
        t.description AS "topicDescription",
        srt.priority,
        srt.reason,
        srt.source,
        srt.status,
        srt.reviewed_by AS "reviewedBy",
        srt.reviewed_at AS "reviewedAt",
        srt.created_at AS "createdAt",
        srt.updated_at AS "updatedAt"
      FROM submission_review_topics srt
      JOIN topics t ON t.id = srt.topic_id AND (t.school_id = srt.school_id OR t.school_id IS NULL)
      WHERE srt.submission_id = $1 AND srt.school_id = $2
      ORDER BY 
        CASE srt.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        srt.created_at ASC
    `;
    const { rows } = await pool.query(query, [submissionId, schoolId]);
    return rows;
  },

  /**
   * Giảng viên duyệt / cập nhật danh sách topic cần ôn cho bài nộp
   */
  async updateSubmissionReviewTopics({
    submissionId,
    schoolId,
    reviewerId,
    topics = [],
  }) {
    const results = [];
    for (const item of topics) {
      const topicId = item.topic_id || item.id || item.topicId;
      if (!topicId) continue;

      const priority = ['high', 'medium', 'low'].includes(String(item.priority).toLowerCase())
        ? String(item.priority).toLowerCase()
        : 'medium';
      const reason = String(item.reason || '').trim();
      const status = item.status === 'rejected' ? 'rejected' : 'approved';

      const query = `
        UPDATE submission_review_topics
        SET 
          priority = $1,
          reason = $2,
          status = $3,
          source = 'lecturer',
          reviewed_by = $4,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE submission_id = $5 
          AND topic_id = $6 
          AND school_id = $7
        RETURNING *
      `;
      const { rows } = await pool.query(query, [
        priority,
        reason,
        status,
        reviewerId,
        submissionId,
        topicId,
        schoolId,
      ]);
      if (rows[0]) results.push(rows[0]);
    }
    return results;
  },
};

module.exports = GradingRepository;