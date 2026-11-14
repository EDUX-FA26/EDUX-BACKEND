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

  async getStudentStatistics(userId, schoolId) {
    if (!schoolId) throw new Error('SCHOOL_ID_REQUIRED_FOR_DASHBOARD');

    const rows = await safeQuery(
      `SELECT 
        (
          SELECT COUNT(*) 
          FROM class_members cm
          JOIN classes c ON cm.class_id = c.id
          WHERE cm.student_id = $1 
            AND c.school_id = $2
            AND (cm.status IS NULL OR cm.status = 'active')
        ) as total_classes,
        (
          SELECT COUNT(*) 
          FROM class_members cm
          JOIN classes c ON cm.class_id = c.id
          JOIN assignments a ON cm.class_id = a.class_id
          WHERE cm.student_id = $1
            AND c.school_id = $2
            AND (a.deadline IS NULL OR a.deadline > NOW())
            AND (a.publish_status IS NULL OR a.publish_status = 'published')
            AND NOT EXISTS (
              SELECT 1 FROM submissions s
              WHERE s.assignment_id = a.id AND s.student_id = $1
            )
        ) as pending_assignments,
        (
          SELECT COUNT(*) 
          FROM submissions s
          JOIN assignments a ON a.id = s.assignment_id
          JOIN classes c ON c.id = a.class_id
          WHERE s.student_id = $1
            AND c.school_id = $2
        ) as submitted_assignments,
        (
          SELECT ROUND(AVG((g.score / NULLIF(g.max_score, 0)) * 10)::numeric, 2)
          FROM grades g
          JOIN classes c ON c.id = g.class_id
          WHERE g.student_id = $1
            AND c.school_id = $2
        ) as average_score`,
      [userId, schoolId],
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

  async getStudentRecentAssignments(userId, schoolId) {
    if (!schoolId) throw new Error('SCHOOL_ID_REQUIRED_FOR_DASHBOARD');

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
         AND c.school_id = $2
         AND (cm.status IS NULL OR cm.status = 'active')
         AND (a.publish_status IS NULL OR a.publish_status = 'published')
       ORDER BY a.deadline ASC
       LIMIT 5`,
      [userId, schoolId]
    );
  },

  // ─────────────────────────────────────────────
  // LECTURER
  // ─────────────────────────────────────────────

  async getLecturerStatistics(userId, schoolId) {
    if (!schoolId) throw new Error('SCHOOL_ID_REQUIRED_FOR_DASHBOARD');

    const rows = await safeQuery(
      `SELECT 
        (
          SELECT COUNT(*) 
          FROM classes 
          WHERE lecturer_id = $1 
            AND school_id = $2
            AND (is_active IS NULL OR is_active = true)
        ) as total_classes,
        (
          SELECT COUNT(DISTINCT cm.student_id) 
          FROM class_members cm
          JOIN classes c ON cm.class_id = c.id
          WHERE c.lecturer_id = $1
            AND c.school_id = $2
            AND (c.is_active IS NULL OR c.is_active = true)
        ) as total_students,
        (
          SELECT COUNT(*) 
          FROM submissions s
          JOIN assignments a ON s.assignment_id = a.id
          JOIN classes c ON a.class_id = c.id
          WHERE c.lecturer_id = $1
            AND c.school_id = $2
            AND s.status = 'submitted'
            AND NOT EXISTS (
              SELECT 1 FROM grades g WHERE g.submission_id = s.id
            )
        ) as pending_submissions,
        (
          SELECT COUNT(*) 
          FROM assignments a
          JOIN classes c ON a.class_id = c.id
          WHERE c.lecturer_id = $1 
            AND c.school_id = $2
            AND (a.publish_status IS NULL OR a.publish_status = 'published')
        ) as total_assignments`,
      [userId, schoolId],
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

  async getLecturerRecentSubmissions(userId, schoolId) {
    if (!schoolId) throw new Error('SCHOOL_ID_REQUIRED_FOR_DASHBOARD');

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
         AND c.school_id = $2
         AND s.status = 'submitted'
       ORDER BY s.submitted_at DESC
       LIMIT 5`,
      [userId, schoolId]
    );
  },

  // ─────────────────────────────────────────────
  // SCHOOL ADMIN
  // ─────────────────────────────────────────────

  async getAdminStatistics(schoolId) {
    if (!schoolId) throw new Error('SCHOOL_ID_REQUIRED_FOR_DASHBOARD');

    const rows = await safeQuery(
      `SELECT 
        (SELECT COUNT(*) FROM public.school_memberships WHERE school_id = $1 AND status = 'active') as total_users,
        (SELECT COUNT(*) FROM public.school_memberships WHERE school_id = $1 AND role = 'student' AND status = 'active') as total_students,
        (SELECT COUNT(*) FROM public.school_memberships WHERE school_id = $1 AND role = 'lecturer' AND status = 'active') as total_lecturers,
        (SELECT COUNT(*) FROM classes WHERE school_id = $1 AND (is_active IS NULL OR is_active = true)) as total_classes`,
      [schoolId],
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

  async getAdminRecentUsers(schoolId) {
    if (!schoolId) throw new Error('SCHOOL_ID_REQUIRED_FOR_DASHBOARD');

    return safeQuery(
      `SELECT u.id, u.email, sm.role, sm.created_at, up.full_name
       FROM users u
       JOIN public.school_memberships sm ON sm.user_id = u.id AND sm.school_id = $1 AND sm.status = 'active'
       LEFT JOIN user_profiles up ON u.id = up.user_id
       ORDER BY sm.created_at DESC
       LIMIT 5`,
      [schoolId]
    );
  },

  // ─────────────────────────────────────────────
  // SHARED: Notifications
  // ─────────────────────────────────────────────

  async getRecentNotifications(userId, schoolId) {
    if (!schoolId) throw new Error('SCHOOL_ID_REQUIRED_FOR_DASHBOARD');

    return safeQuery(
      `SELECT id, title, message, type, is_read, created_at
       FROM notifications
       WHERE user_id = $1
         AND ((notification_scope = 'school' AND school_id = $2) OR notification_scope = 'platform')
       ORDER BY created_at DESC
       LIMIT 5`,
      [userId, schoolId]
    );
  },

  async getUnreadCount(userId, schoolId) {
    if (!schoolId) throw new Error('SCHOOL_ID_REQUIRED_FOR_DASHBOARD');

    const rows = await safeQuery(
      `SELECT COUNT(*) as count 
       FROM notifications 
       WHERE user_id = $1 
         AND is_read = false
         AND ((notification_scope = 'school' AND school_id = $2) OR notification_scope = 'platform')`,
      [userId, schoolId],
      [{ count: '0' }]
    );
    return parseInt(rows[0]?.count || 0);
  },
};

module.exports = DashboardRepository;
