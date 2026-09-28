const { pool } = require('../../config/db.config');

/**
 * Helper: chạy query an toàn — nếu có lỗi thì log chi tiết và trả fallback
 */
async function safeQuery(query, params = [], fallback = null) {
  try {
    const { rows } = await pool.query(query, params);
    return rows;
  } catch (err) {
    console.error('❌ safeQuery error:', err.message);
    return fallback !== null ? fallback : [];
  }
}

const DashboardRepository = {

  // ─────────────────────────────────────────────
  // STUDENT
  // ─────────────────────────────────────────────

  async getStudentStatistics(userId) {
    const rows = await safeQuery(
      `SELECT 
        (
          SELECT COUNT(*) 
          FROM class_members 
          WHERE student_id = $1
        ) as total_classes,
        (
          SELECT COUNT(*) 
          FROM class_members cm
          JOIN assignments a ON cm.class_id = a.class_id
          WHERE cm.student_id = $1
            AND (a.deadline IS NULL OR a.deadline > NOW())
            AND NOT EXISTS (
              SELECT 1 FROM submissions s
              WHERE s.assignment_id = a.id AND s.student_id = $1
            )
        ) as pending_assignments,
        (
          SELECT COUNT(*) 
          FROM submissions 
          WHERE student_id = $1
        ) as submitted_assignments,
        (
          SELECT ROUND(AVG((score / NULLIF(max_score, 0)) * 10)::numeric, 2)
          FROM grades 
          WHERE student_id = $1
             OR submission_id IN (SELECT id FROM submissions WHERE student_id = $1)
        ) as average_score`,
      [userId],
      [{ total_classes: '0', pending_assignments: '0', submitted_assignments: '0', average_score: null }]
    );

    const row = rows[0] || {};
    return {
      totalClasses:         parseInt(row.total_classes || 0),
      pendingAssignments:   parseInt(row.pending_assignments || 0),
      submittedAssignments: parseInt(row.submitted_assignments || 0),
      averageScore:         row.average_score !== null && row.average_score !== undefined ? parseFloat(row.average_score) : null,
    };
  },

  async getStudentRecentAssignments(userId) {
    return safeQuery(
      `SELECT a.id, a.title, a.deadline,
              c.class_code,
              s.name as subject_name,
              EXISTS (
                SELECT 1 FROM submissions sub
                WHERE sub.assignment_id = a.id AND sub.student_id = $1
              ) as is_submitted
       FROM class_members cm
       JOIN classes c ON cm.class_id = c.id
       JOIN subjects s ON c.subject_id = s.id
       JOIN assignments a ON a.class_id = c.id
       WHERE cm.student_id = $1
         AND (cm.status IS NULL OR cm.status = 'active')
         AND (a.publish_status IS NULL OR a.publish_status = 'published')
       ORDER BY a.deadline ASC
       LIMIT 5`,
      [userId]
    );
  },

  // ─────────────────────────────────────────────
  // LECTURER
  // ─────────────────────────────────────────────

  async getLecturerStatistics(userId) {
    const rows = await safeQuery(
      `SELECT 
        (
          SELECT COUNT(*) 
          FROM classes 
          WHERE lecturer_id = $1 AND (is_active IS NULL OR is_active = true)
        ) as total_classes,
        (
          SELECT COUNT(DISTINCT cm.student_id) 
          FROM class_members cm
          JOIN classes c ON cm.class_id = c.id
          WHERE c.lecturer_id = $1
            AND (c.is_active IS NULL OR c.is_active = true)
        ) as total_students,
        (
          SELECT COUNT(*) 
          FROM submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN classes c ON a.class_id = c.id
          WHERE c.lecturer_id = $1
            AND s.status = 'submitted'
            AND NOT EXISTS (
              SELECT 1 FROM grades g WHERE g.submission_id = s.id
            )
        ) as pending_submissions,
        (
          SELECT COUNT(*) 
          FROM assignments a
          JOIN classes c ON a.class_id = c.id
          WHERE c.lecturer_id = $1 AND (a.publish_status IS NULL OR a.publish_status = 'published')
        ) as total_assignments`,
      [userId],
      [{ total_classes: '0', total_students: '0', pending_submissions: '0', total_assignments: '0' }]
    );

    const row = rows[0] || {};
    return {
      totalClasses:       parseInt(row.total_classes || 0),
      totalStudents:      parseInt(row.total_students || 0),
      pendingSubmissions: parseInt(row.pending_submissions || 0),
      totalAssignments:   parseInt(row.total_assignments || 0),
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
    const rows = await safeQuery(
      `SELECT 
        (SELECT COUNT(*) FROM users WHERE is_active = true) as total_users,
        (SELECT COUNT(*) FROM users WHERE role = 'student' AND is_active = true) as total_students,
        (SELECT COUNT(*) FROM users WHERE role = 'lecturer' AND is_active = true) as total_lecturers,
        (SELECT COUNT(*) FROM classes WHERE is_active = true) as total_classes`,
      [],
      [{ total_users: '0', total_students: '0', total_lecturers: '0', total_classes: '0' }]
    );

    const row = rows[0] || {};
    return {
      totalUsers:     parseInt(row.total_users || 0),
      totalStudents:  parseInt(row.total_students || 0),
      totalLecturers: parseInt(row.total_lecturers || 0),
      totalClasses:   parseInt(row.total_classes || 0),
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
  // SHARED: Notifications
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