const { pool } = require('../../config/db.config');

/**
 * Helper: chạy query an toàn — nếu bảng chưa tồn tại hoặc lỗi thì trả fallback
 */
async function safeQuery(query, params = [], fallback = null) {
  try {
    const { rows } = await pool.query(query, params);
    return rows;
  } catch {
    return fallback !== null ? fallback : [];
  }
}

const DashboardRepository = {

  // ─────────────────────────────────────────────
  // STUDENT
  // ─────────────────────────────────────────────

  async getStudentStatistics(userId) {
    const [classesRes, pendingRes, submittedRes, avgRes] = await Promise.all([
      // Tổng số lớp đang tham gia
      safeQuery(
        `SELECT COUNT(*) as count
         FROM class_members
         WHERE student_id = $1 AND status = 'active'`,
        [userId], [{ count: '0' }]
      ),

      // Số bài tập chưa nộp (deadline chưa qua)
      safeQuery(
        `SELECT COUNT(*) as count
         FROM assignments a
         JOIN class_members cm ON a.class_id = cm.class_id
         WHERE cm.student_id = $1
           AND cm.status = 'active'
           AND a.is_active = true
           AND a.deadline > NOW()
           AND NOT EXISTS (
             SELECT 1 FROM submissions s
             WHERE s.assignment_id = a.id AND s.student_id = $1
           )`,
        [userId], [{ count: '0' }]
      ),

      // Số bài tập đã nộp
      safeQuery(
        `SELECT COUNT(*) as count
         FROM submissions
         WHERE student_id = $1`,
        [userId], [{ count: '0' }]
      ),

      // Điểm trung bình
      safeQuery(
        `SELECT ROUND(AVG(g.score)::numeric, 2) as avg_score
         FROM grades g
         JOIN submissions s ON g.submission_id = s.id
         WHERE s.student_id = $1`,
        [userId], [{ avg_score: null }]
      ),
    ]);

    return {
      totalClasses:         parseInt(classesRes[0]?.count || 0),
      pendingAssignments:   parseInt(pendingRes[0]?.count || 0),
      submittedAssignments: parseInt(submittedRes[0]?.count || 0),
      averageScore:         parseFloat(avgRes[0]?.avg_score) || null,
    };
  },

  async getStudentRecentAssignments(userId) {
    return safeQuery(
      `SELECT a.id, a.title, a.deadline, a.type,
              c.class_code,
              s.name as subject_name,
              CASE WHEN sub.id IS NOT NULL THEN true ELSE false END as is_submitted
       FROM assignments a
       JOIN classes c ON a.class_id = c.id
       JOIN subjects s ON c.subject_id = s.id
       JOIN class_members cm ON a.class_id = cm.class_id
       LEFT JOIN submissions sub ON sub.assignment_id = a.id AND sub.student_id = $1
       WHERE cm.student_id = $1
         AND cm.status = 'active'
         AND a.is_active = true
       ORDER BY a.deadline ASC
       LIMIT 5`,
      [userId]
    );
  },

  // ─────────────────────────────────────────────
  // LECTURER
  // ─────────────────────────────────────────────

  async getLecturerStatistics(userId) {
    const [classesRes, studentsRes, pendingRes, assignmentsRes] = await Promise.all([
      // Số lớp đang dạy
      safeQuery(
        `SELECT COUNT(*) as count
         FROM classes
         WHERE lecturer_id = $1 AND is_active = true`,
        [userId], [{ count: '0' }]
      ),

      // Tổng số sinh viên trong các lớp
      safeQuery(
        `SELECT COUNT(DISTINCT cm.student_id) as count
         FROM class_members cm
         JOIN classes c ON cm.class_id = c.id
         WHERE c.lecturer_id = $1
           AND c.is_active = true
           AND cm.status = 'active'`,
        [userId], [{ count: '0' }]
      ),

      // Số bài nộp chờ chấm điểm
      safeQuery(
        `SELECT COUNT(*) as count
         FROM submissions s
         JOIN assignments a ON s.assignment_id = a.id
         JOIN classes c ON a.class_id = c.id
         WHERE c.lecturer_id = $1
           AND s.status = 'submitted'
           AND NOT EXISTS (
             SELECT 1 FROM grades g WHERE g.submission_id = s.id
           )`,
        [userId], [{ count: '0' }]
      ),

      // Tổng số bài tập đã tạo
      safeQuery(
        `SELECT COUNT(*) as count
         FROM assignments a
         JOIN classes c ON a.class_id = c.id
         WHERE c.lecturer_id = $1 AND a.is_active = true`,
        [userId], [{ count: '0' }]
      ),
    ]);

    return {
      totalClasses:       parseInt(classesRes[0]?.count   || 0),
      totalStudents:      parseInt(studentsRes[0]?.count  || 0),
      pendingSubmissions: parseInt(pendingRes[0]?.count   || 0),
      totalAssignments:   parseInt(assignmentsRes[0]?.count || 0),
    };
  },

  async getLecturerRecentSubmissions(userId) {
    return safeQuery(
      `SELECT s.id, s.submitted_at, s.status,
              up.full_name as student_name,
              up.student_code,
              a.title as assignment_title,
              c.class_code
       FROM submissions s
       JOIN assignments a ON s.assignment_id = a.id
       JOIN classes c ON a.class_id = c.id
       JOIN user_profiles up ON s.student_id = up.user_id
       WHERE c.lecturer_id = $1
         AND s.status = 'submitted'
       ORDER BY s.submitted_at DESC
       LIMIT 5`,
      [userId]
    );
  },

  // ─────────────────────────────────────────────
  // ADMIN
  // ─────────────────────────────────────────────

  async getAdminStatistics() {
    const [totalUsersRes, studentsRes, lecturersRes, classesRes] = await Promise.all([
      safeQuery(`SELECT COUNT(*) as count FROM users WHERE is_active = true`, [], [{ count: '0' }]),
      safeQuery(`SELECT COUNT(*) as count FROM users WHERE role = 'student' AND is_active = true`, [], [{ count: '0' }]),
      safeQuery(`SELECT COUNT(*) as count FROM users WHERE role = 'lecturer' AND is_active = true`, [], [{ count: '0' }]),
      safeQuery(`SELECT COUNT(*) as count FROM classes WHERE is_active = true`, [], [{ count: '0' }]),
    ]);

    return {
      totalUsers:     parseInt(totalUsersRes[0]?.count || 0),
      totalStudents:  parseInt(studentsRes[0]?.count   || 0),
      totalLecturers: parseInt(lecturersRes[0]?.count  || 0),
      totalClasses:   parseInt(classesRes[0]?.count    || 0),
    };
  },

  async getAdminRecentUsers() {
    return safeQuery(
      `SELECT u.id, u.email, u.role, u.created_at, up.full_name
       FROM users u
       JOIN user_profiles up ON u.id = up.user_id
       ORDER BY u.created_at DESC
       LIMIT 5`
    );
  },

  // ─────────────────────────────────────────────
  // SHARED: Notifications (dùng chung cho mọi role)
  // ─────────────────────────────────────────────

  async getRecentNotifications(userId) {
    return safeQuery(
      `SELECT id, title, message, type, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [userId]
    );
  },

  async getUnreadCount(userId) {
    const rows = await safeQuery(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false`,
      [userId], [{ count: '0' }]
    );
    return parseInt(rows[0]?.count || 0);
  },
};

module.exports = DashboardRepository;