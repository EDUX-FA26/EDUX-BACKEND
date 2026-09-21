const { pool } = require('../../config/db.config');

const SubmissionRepository = {
  /**
   * Tạo submission mới cùng với version đầu tiên
   */
  async createSubmissionWithVersion(submissionData, versionData, client = pool) {
    const submissionQuery = `
      INSERT INTO submissions (
        id, uuid, assignment_id, student_id, latest_version_no, status, submitted_at, last_submitted_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, NOW(), NOW()
      ) RETURNING *;
    `;
    const submissionValues = [
      submissionData.id,
      submissionData.uuid,
      submissionData.assignment_id,
      submissionData.student_id,
      1, // latest_version_no
      submissionData.status || 'submitted'
    ];
    
    const { rows: submissionRows } = await client.query(submissionQuery, submissionValues);
    const submission = submissionRows[0];

    const versionQuery = `
      INSERT INTO submission_versions (
        submission_id, assignment_id, student_id, version_no, files, note, is_latest, submitted_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, TRUE, NOW()
      ) RETURNING *;
    `;
    const versionValues = [
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
   * Nộp lại bài: Tạo version mới và update submission
   */
  async addSubmissionVersion(submissionId, versionData, client = pool) {
    // 1. Lấy thông tin submission hiện tại để biết latest_version_no
    const { rows: subRows } = await client.query(
      `SELECT * FROM submissions WHERE id = $1 FOR UPDATE`, 
      [submissionId]
    );
    if (subRows.length === 0) throw new Error("Submission not found");
    const submission = subRows[0];
    const newVersionNo = submission.latest_version_no + 1;

    // 2. Set is_latest = false cho các version cũ
    await client.query(
      `UPDATE submission_versions SET is_latest = FALSE WHERE submission_id = $1`,
      [submissionId]
    );

    // 3. Insert version mới
    const versionQuery = `
      INSERT INTO submission_versions (
        submission_id, assignment_id, student_id, version_no, files, note, is_latest, submitted_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, TRUE, NOW()
      ) RETURNING *;
    `;
    const versionValues = [
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
      WHERE id = $3
      RETURNING *;
    `;
    const { rows: updatedSubRows } = await client.query(updateSubQuery, [newVersionNo, status, submissionId]);

    return { submission: updatedSubRows[0], version };
  },

  /**
   * Tìm submission theo assignment_id và student_id
   */
  async findByAssignmentAndStudent(assignmentId, studentId, client = pool) {
    const query = `
      SELECT * FROM submissions 
      WHERE assignment_id = $1 AND student_id = $2
    `;
    const { rows } = await client.query(query, [assignmentId, studentId]);
    return rows[0];
  },

  /**
   * Cập nhật JSONB files của version hiện tại (dùng khi xóa file)
   */
  async updateVersionFiles(versionId, files, client = pool) {
    const query = `
      UPDATE submission_versions
      SET files = $1::jsonb, updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    const { rows } = await client.query(query, [JSON.stringify(files), versionId]);
    return rows[0];
  },

  /**
   * Lấy chi tiết bài nộp kèm thông tin version
   */
  async findById(id, includeHistory = false) {
    const subQuery = `
      SELECT 
        s.*, 
        up.full_name as student_name,
        u.email as student_email,
        a.title as assignment_title
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      LEFT JOIN user_profiles up ON u.id = up.user_id
      JOIN assignments a ON s.assignment_id = a.id
      WHERE s.id = $1
    `;
    const { rows: subRows } = await pool.query(subQuery, [id]);
    if (subRows.length === 0) return null;
    const submission = subRows[0];

    let versionQuery = `SELECT * FROM submission_versions WHERE submission_id = $1`;
    if (!includeHistory) {
      versionQuery += ` AND is_latest = TRUE`;
    }
    versionQuery += ` ORDER BY version_no DESC`;
    
    const { rows: versionRows } = await pool.query(versionQuery, [id]);
    
    return {
      ...submission,
      versions: versionRows
    };
  },

  /**
   * Lấy version cụ thể hoặc mới nhất để check file
   */
  async findLatestVersion(submissionId) {
    const query = `SELECT * FROM submission_versions WHERE submission_id = $1 AND is_latest = TRUE`;
    const { rows } = await pool.query(query, [submissionId]);
    return rows[0];
  },

  /**
   * Cập nhật trạng thái bài nộp (và feedback nếu có cột, hiện tại lưu vào note của DB nếu cần, 
   * nhưng tạm thời update status)
   */
  async updateStatus(id, status, feedback) {
    // Do table submissions chưa rõ có column feedback hay không, tạm thời chỉ update status. 
    // Nếu db có schema feedback, có thể thêm vào query.
    // Kiểm tra xem có cột feedback không, nếu có sẽ chạy, tạm thời bỏ qua feedback DB, hoặc update vào bảng tương ứng.
    const query = `
      UPDATE submissions
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    const { rows } = await pool.query(query, [status, id]);
    return rows[0];
  },

  /**
   * Giảng viên xem toàn bộ bài nộp của 1 assignment
   */
  async findManyByAssignmentId(assignmentId, { page = 1, limit = 10, status }) {
    const offset = (page - 1) * limit;
    let whereClauses = [`s.assignment_id = $1`];
    let values = [assignmentId];
    let idx = 2;

    if (status) {
      whereClauses.push(`s.status = $${idx++}`);
      values.push(status);
    }

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*) FROM submissions s ${whereString}`;
    const { rows: countRows } = await pool.query(countQuery, values);
    const total = parseInt(countRows[0].count, 10);

    const query = `
      SELECT 
        s.*,
        up.full_name as student_name,
        u.email as student_email,
        sv.files as latest_files,
        sv.note as latest_note
      FROM submissions s
      JOIN users u ON s.student_id = u.id
      LEFT JOIN user_profiles up ON u.id = up.user_id
      LEFT JOIN submission_versions sv ON s.id = sv.submission_id AND sv.is_latest = TRUE
      ${whereString}
      ORDER BY s.submitted_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    values.push(limit, offset);

    const { rows } = await pool.query(query, values);
    return { data: rows, total };
  },

  /**
   * Sinh viên xem danh sách bài nộp của mình
   */
  async findMySubmissions(studentId, { page = 1, limit = 10 }) {
    const offset = (page - 1) * limit;
    
    const countQuery = `SELECT COUNT(*) FROM submissions WHERE student_id = $1`;
    const { rows: countRows } = await pool.query(countQuery, [studentId]);
    const total = parseInt(countRows[0].count, 10);

    const query = `
      SELECT 
        s.*,
        a.title as assignment_title
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      WHERE s.student_id = $1
      ORDER BY s.updated_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const { rows } = await pool.query(query, [studentId, limit, offset]);
    return { data: rows, total };
  }
};

module.exports = SubmissionRepository;