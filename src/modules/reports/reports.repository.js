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
      SELECT u.email, up.full_name, up.student_code, 
             c.class_code, sub.name as subject_name,
             fr.final_score, fr.classification, fr.calculated_at
      FROM final_results fr
      JOIN users u ON fr.student_id = u.id
      LEFT JOIN user_profiles up ON u.id = up.user_id
      JOIN classes c ON fr.class_id = c.id
      JOIN subjects sub ON fr.subject_id = sub.id
      ORDER BY fr.calculated_at DESC
    `;
    const result = await pool.query(query);
    return result.rows;
  },

  /**
   * UC 95: Data for AI Transparency Export
   */
  async getAiTransparencyExportData() {
    const query = `
      SELECT u.email, up.full_name, up.student_code,
             a.title as assignment_title,
             e.pattern, e.risk_level, e.transparency_score, 
             e.prompt_quality_score, e.reflection_quality_score, e.ai_dependency_score,
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
