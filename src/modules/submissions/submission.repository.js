const { pool } = require('../../config/db.config');

const SubmissionRepository = {
  /**
   * Tạo submission mới cùng với version đầu tiên (theo school_id)
   */
  async createSubmissionWithVersion(submissionData, versionData, client = pool) {
    const isDraft = submissionData.status === 'draft';
    const submissionQuery = `
      INSERT INTO submissions (
        id, uuid, school_id, assignment_id, student_id, latest_version_no, status, submitted_at, last_submitted_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, ${isDraft ? 'NULL' : 'NOW()'}, ${isDraft ? 'NULL' : 'NOW()'}
      ) RETURNING *;
    `;
    const submissionValues = [
      submissionData.id,
      submissionData.uuid,
      submissionData.school_id,
      submissionData.assignment_id,
      submissionData.student_id,
      1, // latest_version_no
      submissionData.status || 'submitted'
    ];

    const { rows: submissionRows } = await client.query(submissionQuery, submissionValues);
    const submission = submissionRows[0];

    const versionQuery = `
      INSERT INTO submission_versions (
        school_id, submission_id, assignment_id, student_id, version_no, files, note, is_latest, submitted_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, TRUE, ${isDraft ? 'NOW()' : 'NOW()'}
      ) RETURNING *;
    `;
    const versionValues = [
      submissionData.school_id,
      submission.id,
      submissionData.assignment_id,
      submissionData.student_id,
      1,
      JSON.stringify(versionData.files || []),
      versionData.note || ''
    ];

    const { rows: versionRows } = await client.query(versionQuery, versionValues);
    const version = versionRows[0];

    return { submission, version };
  },

  /**
   * Cập nhật bản nháp submission hiện tại (không tăng major version)
   */
  async updateDraftSubmission(submissionId, versionId, schoolId, files, note, client = pool) {
    const versionQuery = `
      UPDATE submission_versions
      SET files = $1::jsonb, note = $2, updated_at = NOW()
      WHERE id = $3 AND school_id = $4
      RETURNING *;
    `;
    const { rows: versionRows } = await client.query(versionQuery, [
      JSON.stringify(files || []),
      note || '',
      versionId,
      schoolId
    ]);

    const subQuery = `
      UPDATE submissions
      SET updated_at = NOW()
      WHERE id = $1 AND school_id = $2
      RETURNING *;
    `;
    const { rows: subRows } = await client.query(subQuery, [submissionId, schoolId]);

    return { submission: subRows[0], version: versionRows[0] };
  },

  /**
   * Chuyển trạng thái draft sang nộp chính thức (chốt submitted_at = NOW())
   */
  async finalizeDraftSubmission(submissionId, versionId, schoolId, status, files, note, client = pool) {
    const versionQuery = `
      UPDATE submission_versions
      SET files = $1::jsonb, note = $2, submitted_at = NOW(), updated_at = NOW()
      WHERE id = $3 AND school_id = $4
      RETURNING *;
    `;
    const { rows: versionRows } = await client.query(versionQuery, [
      JSON.stringify(files || []),
      note || '',
      versionId,
      schoolId
    ]);

    const subQuery = `
      UPDATE submissions
      SET status = $1, submitted_at = NOW(), last_submitted_at = NOW(), updated_at = NOW()
      WHERE id = $2 AND school_id = $3
      RETURNING *;
    `;
    const { rows: subRows } = await client.query(subQuery, [status, submissionId, schoolId]);

    return { submission: subRows[0], version: versionRows[0] };
  },

  /**
   * Nộp lại bài: Tạo version mới và update submission
   */
  async addSubmissionVersion(submissionId, schoolId, versionData, client = pool) {
    // 1. Lấy thông tin submission hiện tại để biết latest_version_no
    const { rows: subRows } = await client.query(
      `SELECT * FROM submissions WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [submissionId, schoolId]
    );
    if (subRows.length === 0) throw new Error("Submission not found");
    const submission = subRows[0];
    const newVersionNo = submission.latest_version_no + 1;

    // 2. Set is_latest = false cho các version cũ
    await client.query(
      `UPDATE submission_versions SET is_latest = FALSE WHERE submission_id = $1 AND school_id = $2`,
      [submissionId, schoolId]
    );

    // 3. Insert version mới
    const versionQuery = `
      INSERT INTO submission_versions (
        school_id, submission_id, assignment_id, student_id, version_no, files, note, is_latest, submitted_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, TRUE, NOW()
      ) RETURNING *;
    `;
    const versionValues = [
      schoolId,
      submissionId,
      submission.assignment_id,
      submission.student_id,
      newVersionNo,
      JSON.stringify(versionData.files || []),
      versionData.note || ''
    ];
    const { rows: versionRows } = await client.query(versionQuery, versionValues);
    const version = versionRows[0];

    // 4. Update submission
    const status = versionData.status || 'resubmitted';
    const updateSubQuery = `
      UPDATE submissions
      SET latest_version_no = $1, status = $2, last_submitted_at = NOW(), updated_at = NOW()
      WHERE id = $3 AND school_id = $4
      RETURNING *;
    `;
    const { rows: updatedSubRows } = await client.query(updateSubQuery, [newVersionNo, status, submissionId, schoolId]);

    return { submission: updatedSubRows[0], version };
  },

  /**
   * Tìm submission theo assignment_id, student_id và school_id
   */
  async findByAssignmentAndStudent(assignmentId, studentId, schoolId, client = pool) {
    const query = `
      SELECT * FROM submissions 
      WHERE assignment_id = $1 AND student_id = $2 AND school_id = $3
    `;
    const { rows } = await client.query(query, [assignmentId, studentId, schoolId]);
    return rows[0];
  },

  /**
   * Cập nhật JSONB files của version hiện tại (dùng khi xóa file)
   */
  async updateVersionFiles(versionId, schoolId, files, client = pool) {
    const query = `
      UPDATE submission_versions
      SET files = $1::jsonb, updated_at = NOW()
      WHERE id = $2 AND school_id = $3
      RETURNING *;
    `;
    const { rows } = await client.query(query, [JSON.stringify(files), versionId, schoolId]);
    return rows[0];
  },

  /**
   * Lấy chi tiết bài nộp kèm thông tin version theo school_id
   */
  async findById(id, includeHistory = false, schoolId) {
    const subQuery = `
      SELECT 
        s.*, 
        up.full_name as student_name,
        up.student_code as student_code,
        u.email as student_email,
        a.title as assignment_title,
        g.id as grade_id,
        g.score,
        g.max_score,
        g.feedback,
        g.rubrics,
        ae.evaluation_data as ai_evaluation_data,
        ae.rubric_scores as ai_rubric_scores,
        ae.viva_questions as ai_viva_questions,
        ae.total_score as ai_total_score,
        ae.overall_verdict as ai_overall_verdict,
        ae.evaluated_at as ai_evaluated_at
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      LEFT JOIN user_profiles up ON u.id = up.user_id
      LEFT JOIN assignments a ON s.assignment_id = a.id AND a.school_id = s.school_id
      LEFT JOIN LATERAL (
        SELECT id, score, max_score, feedback, rubrics
        FROM grades
        WHERE submission_id = s.id AND school_id = s.school_id
        ORDER BY created_at DESC
        LIMIT 1
      ) g ON TRUE
      LEFT JOIN LATERAL (
        SELECT id, evaluation_data, rubric_scores, viva_questions, total_score, overall_verdict, evaluated_at
        FROM ai_evaluations
        WHERE submission_id = s.id AND school_id = s.school_id
        ORDER BY created_at DESC
        LIMIT 1
      ) ae ON TRUE
      WHERE s.id = $1 AND s.school_id = $2
    `;
    const { rows: subRows } = await pool.query(subQuery, [id, schoolId]);
    if (subRows.length === 0) return null;
    const submission = subRows[0];

    // Parse JSON fields if returned as string
    if (submission.rubrics && typeof submission.rubrics === 'string') {
      try { submission.rubrics = JSON.parse(submission.rubrics); } catch (e) {}
    }
    if (submission.ai_evaluation_data && typeof submission.ai_evaluation_data === 'string') {
      try { submission.ai_evaluation_data = JSON.parse(submission.ai_evaluation_data); } catch (e) {}
    }
    if (submission.ai_rubric_scores && typeof submission.ai_rubric_scores === 'string') {
      try { submission.ai_rubric_scores = JSON.parse(submission.ai_rubric_scores); } catch (e) {}
    }
    if (submission.ai_viva_questions && typeof submission.ai_viva_questions === 'string') {
      try { submission.ai_viva_questions = JSON.parse(submission.ai_viva_questions); } catch (e) {}
    }

    let versionQuery = `SELECT * FROM submission_versions WHERE submission_id = $1 AND school_id = $2`;
    if (!includeHistory) {
      versionQuery += ` AND is_latest = TRUE`;
    }
    versionQuery += ` ORDER BY version_no DESC`;

    const { rows: versionRows } = await pool.query(versionQuery, [id, schoolId]);

    return {
      ...submission,
      versions: versionRows
    };
  },

  /**
   * Lấy version cụ thể hoặc mới nhất để check file
   */
  async findLatestVersion(submissionId, schoolId, client = pool) {
    const query = `SELECT * FROM submission_versions WHERE submission_id = $1 AND school_id = $2 AND is_latest = TRUE`;
    const { rows } = await client.query(query, [submissionId, schoolId]);
    return rows[0];
  },

  /**
   * Cập nhật chỉ phần ghi chú / khai báo AI cho draft
   */
  async updateDraftNote(submissionId, versionId, schoolId, note, client = pool) {
    const versionQuery = `
      UPDATE submission_versions
      SET note = $1, updated_at = NOW()
      WHERE id = $2 AND school_id = $3
      RETURNING *;
    `;
    const { rows: versionRows } = await client.query(versionQuery, [note || '', versionId, schoolId]);

    const subQuery = `
      UPDATE submissions
      SET updated_at = NOW()
      WHERE id = $1 AND school_id = $2
      RETURNING *;
    `;
    const { rows: subRows } = await client.query(subQuery, [submissionId, schoolId]);

    return { submission: subRows[0], version: versionRows[0] };
  },

  /**
   * Cập nhật trạng thái bài nộp
   */
  async updateStatus(id, schoolId, status, feedback) {
    const query = `
      UPDATE submissions
      SET status = $1, updated_at = NOW()
      WHERE id = $2 AND school_id = $3
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [status, id, schoolId]);
    return rows[0];
  },

  /**
   * Giảng viên xem toàn bộ bài nộp của 1 assignment (BẮT BUỘC loại trừ bài nháp status = 'draft')
   */
  async findManyByAssignmentId(assignmentId, schoolId, { page = 1, limit = 10, status } = {}) {
    // Nếu filter chỉ định rõ ràng status === 'draft', trả về rỗng vì giảng viên không được xem draft
    if (status === 'draft') {
      return { data: [], total: 0 };
    }

    const offset = (page - 1) * limit;
    let whereClauses = [`s.assignment_id = $1`, `s.school_id = $2`, `s.status != 'draft'`];
    let values = [assignmentId, schoolId];
    let idx = 3;

    if (status) {
      whereClauses.push(`s.status = $${idx++}`);
      values.push(status);
    }

    const whereString = `WHERE ${whereClauses.join(' AND ')}`;

    const countQuery = `SELECT COUNT(DISTINCT s.student_id) FROM submissions s ${whereString}`;
    const { rows: countRows } = await pool.query(countQuery, values);
    const total = parseInt(countRows[0].count, 10);

    const query = `
      SELECT * FROM (
        SELECT DISTINCT ON (s.student_id)
          s.*,
          up.full_name as student_name,
          up.student_code as student_code,
          u.email as student_email,
          sv.files as latest_files,
          sv.note as latest_note,
          g.id as grade_id,     
          g.score,                
          g.feedback             
        FROM submissions s
        JOIN users u ON s.student_id = u.id
        LEFT JOIN user_profiles up ON u.id = up.user_id
        LEFT JOIN LATERAL (
          SELECT files, note 
          FROM submission_versions 
          WHERE submission_id = s.id AND school_id = s.school_id
          ORDER BY is_latest DESC, version_no DESC, submitted_at DESC 
          LIMIT 1
        ) sv ON TRUE
        LEFT JOIN LATERAL (
          SELECT id, score, feedback
          FROM grades
          WHERE submission_id = s.id AND school_id = s.school_id
          ORDER BY created_at DESC
          LIMIT 1
        ) g ON TRUE
        ${whereString}
        ORDER BY s.student_id, s.submitted_at DESC NULLS LAST, s.created_at DESC
      ) t
      ORDER BY t.submitted_at DESC NULLS LAST
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    values.push(limit, offset);

    const { rows } = await pool.query(query, values);
    return { data: rows, total };
  },

  /**
   * Sinh viên xem danh sách bài nộp của mình (bao gồm cả bản nháp) theo school_id
   */
  async findMySubmissions(
    studentId,
    schoolId,
    { page = 1, limit = 10, assignment_id } = {}
  ) {
    const offset = (page - 1) * limit;

    const conditions = ['s.student_id = $1', 's.school_id = $2'];
    const values = [studentId, schoolId];
    let paramIndex = 3;

    if (assignment_id) {
      conditions.push(`s.assignment_id = $${paramIndex}`);
      values.push(assignment_id);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Count
    const countQuery = `
    SELECT COUNT(*)
    FROM submissions s
    WHERE ${whereClause}
  `;

    const { rows: countRows } = await pool.query(
      countQuery,
      values
    );

    const total = parseInt(countRows[0].count, 10);

    // Data kèm latest version files & note (LEFT JOIN assignments để không vỡ với dữ liệu lịch sử nếu có)
    const query = `
    SELECT 
      s.*,
      a.title AS assignment_title,
      sv.files AS latest_files,
      sv.note AS latest_note,
      g.score AS score,
      g.feedback AS feedback

    FROM submissions s

    LEFT JOIN assignments a 
      ON s.assignment_id = a.id AND a.school_id = s.school_id

    LEFT JOIN LATERAL (
      SELECT files, note 
      FROM submission_versions 
      WHERE submission_id = s.id AND school_id = s.school_id
      ORDER BY is_latest DESC, version_no DESC, submitted_at DESC 
      LIMIT 1
    ) sv ON TRUE

    LEFT JOIN grades g
      ON g.submission_id = s.id AND g.school_id = s.school_id

    WHERE ${whereClause}

    ORDER BY s.updated_at DESC

    LIMIT $${paramIndex}
    OFFSET $${paramIndex + 1}
  `;

    const { rows } = await pool.query(
      query,
      [...values, limit, offset]
    );

    return {
      data: rows,
      total
    };
  }
};

module.exports = SubmissionRepository;