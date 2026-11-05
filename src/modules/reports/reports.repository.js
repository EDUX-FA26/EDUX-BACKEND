const { pool } = require("../../config/db.config");

const ReportsRepository = {
  /**
   * UC 91: View System Reports
   */
  async getSystemStats() {
    const usersCount = await pool.query("SELECT COUNT(*) FROM users");
    const activeUsersCount = await pool.query("SELECT COUNT(*) FROM users WHERE is_active = true");
    const classesCount = await pool.query("SELECT COUNT(*) FROM classes");
    const submissionsCount = await pool.query("SELECT COUNT(*) FROM submissions");

    return {
      totalUsers: parseInt(usersCount.rows[0].count, 10),
      activeUsers: parseInt(activeUsersCount.rows[0].count, 10),
      totalClasses: parseInt(classesCount.rows[0].count, 10),
      totalSubmissions: parseInt(submissionsCount.rows[0].count, 10),
    };
  },

  /**
   * UC 92: View AI Usage Statistics
   */
  async getAiUsageStats() {
    // Tổng số lượt tương tác AI
    const totalInteractions = await pool.query("SELECT COUNT(*) FROM ai_interactions");

    // Group by tool
    const toolsData = await pool.query(`
      SELECT ai_tool, COUNT(*) as count 
      FROM ai_interactions 
      GROUP BY ai_tool
    `);

    // Group by student_decision
    const decisionsData = await pool.query(`
      SELECT student_decision, COUNT(*) as count 
      FROM ai_interactions 
      GROUP BY student_decision
    `);

    return {
      totalInteractions: parseInt(totalInteractions.rows[0].count, 10),
      tools: toolsData.rows,
      decisions: decisionsData.rows,
    };
  },

  /**
   * UC 93: View Audit Logs (Sử dụng tạm bảng notifications hoặc login logs nếu không có bảng audit)
   */
  async getAuditLogs() {
    // Do hệ thống không có bảng audit_logs cụ thể, mình trả về các cờ (flags) và notifications hệ thống
    const flags = await pool.query(`
      SELECT id, flag_type, flagged_by, created_at, status 
      FROM submission_flags 
      ORDER BY created_at DESC LIMIT 50
    `);
    return flags.rows;
  },

  /**
   * UC 94: Data for Learning Activity Export
   */
  
async getLearningActivityExportData() {
  const query = `
    SELECT
      -- Student
      u.id AS student_id,
      up.student_code,
      up.full_name AS student_name,
      u.email,

      -- Class and subject
      c.id AS class_id,
      c.class_code,
      sub.code AS subject_code,
      sub.name AS subject_name,

      -- Assignment
      a.id AS assignment_id,
      a.title AS assignment_title,
      a.deadline AS assignment_deadline,
      a.max_score AS assignment_max_score,
      a.weight AS assignment_weight,

      -- Submission
      s.id AS submission_id,
      s.status AS submission_status,
      s.latest_version_no,
      s.last_submitted_at,
      COALESCE(version_info.version_count, 0) AS version_count,

      -- Grade
      g.id AS grade_id,
      g.score,
      COALESCE(g.max_score, a.max_score) AS max_score,
      g.feedback,
      g.rubrics,
      grader_profile.full_name AS grader_name,
      g.graded_at,

      CASE
        WHEN g.id IS NOT NULL THEN 'Đã chấm'
        ELSE 'Chưa chấm'
      END AS grading_status

    FROM submissions s

    INNER JOIN assignments a
      ON s.assignment_id = a.id

    INNER JOIN classes c
      ON a.class_id = c.id

    INNER JOIN subjects sub
      ON c.subject_id = sub.id

    INNER JOIN users u
      ON s.student_id = u.id

    LEFT JOIN user_profiles up
      ON up.user_id = u.id

    LEFT JOIN grades g
      ON g.submission_id = s.id

    LEFT JOIN user_profiles grader_profile
      ON grader_profile.user_id = g.graded_by

    LEFT JOIN LATERAL (
      SELECT COUNT(*)::INTEGER AS version_count
      FROM submission_versions sv
      WHERE sv.submission_id = s.id
    ) version_info ON TRUE

    ORDER BY
      COALESCE(s.last_submitted_at, s.submitted_at) DESC NULLS LAST
  `;

  const result = await pool.query(query);
  return result.rows;
},

  /**
   * UC 95: Data for AI Transparency Export
   */
  async getAiTransparencyExportData() {
    const query = `
  SELECT
    u.email,
    up.full_name,
    up.student_code,
    a.title AS assignment_title,

    e.pattern,
    e.risk_level,
    e.transparency_score,
    e.prompt_quality_score,
    e.reflection_quality_score,
    e.ai_dependency_score,

    e.total_score,
    e.overall_verdict,
    e.evaluation_data,
    e.rubric_scores,
    e.viva_questions,

    e.evaluated_at

  FROM ai_evaluations e
  JOIN users u ON e.student_id = u.id
  LEFT JOIN user_profiles up ON u.id = up.user_id
  JOIN assignments a ON e.assignment_id = a.id

  ORDER BY e.evaluated_at DESC
`;

    const result = await pool.query(query);
    return result.rows;
  }
};

module.exports = ReportsRepository;
