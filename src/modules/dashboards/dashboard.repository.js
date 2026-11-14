const { pool } = require("../../config/db.config");

async function queryRows(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

const DashboardRepository = {
  // =========================================
  // STUDENT
  // =========================================

  async getStudentStatistics(userId, schoolId) {
    const rows = await queryRows(
      `
      SELECT
        (
          SELECT COUNT(DISTINCT cm.class_id)
          FROM class_members cm
          JOIN classes c
            ON c.id = cm.class_id
           AND c.school_id = cm.school_id
          WHERE cm.student_id = $1
            AND cm.school_id = $2
            AND (cm.status IS NULL OR cm.status = 'active')
            AND (c.is_active IS NULL OR c.is_active = true)
        ) AS total_classes,

        (
          SELECT COUNT(*)
          FROM assignments a
          JOIN classes c
            ON c.id = a.class_id
           AND c.school_id = a.school_id
          JOIN class_members cm
            ON cm.class_id = c.id
           AND cm.school_id = c.school_id
          WHERE cm.student_id = $1
            AND cm.school_id = $2
            AND a.school_id = $2
            AND (cm.status IS NULL OR cm.status = 'active')
            AND (c.is_active IS NULL OR c.is_active = true)
            AND (
              a.publish_status IS NULL
              OR a.publish_status = 'published'
            )
            AND (a.deadline IS NULL OR a.deadline > NOW())
            AND NOT EXISTS (
              SELECT 1
              FROM submissions sub
              WHERE sub.assignment_id = a.id
                AND sub.student_id = $1
                AND sub.school_id = $2
                AND sub.status IN (
                  'submitted',
                  'resubmitted',
                  'late',
                  'evaluated',
                  'reviewed',
                  'graded',
                  'flagged'
                )
            )
        ) AS pending_assignments,

        (
          SELECT COUNT(*)
          FROM submissions sub
          WHERE sub.student_id = $1
            AND sub.school_id = $2
            AND sub.status IN (
              'submitted',
              'resubmitted',
              'late',
              'evaluated',
              'reviewed',
              'graded',
              'flagged'
            )
        ) AS submitted_assignments,

        (
          SELECT ROUND(
            AVG(
              (g.score / NULLIF(g.max_score, 0)) * 10
            )::numeric,
            2
          )
          FROM grades g
          WHERE g.student_id = $1
            AND g.school_id = $2
        ) AS average_score
      `,
      [userId, schoolId]
    );

    const row = rows[0] || {};

    return {
      totalClasses: Number(row.total_classes || 0),
      pendingAssignments: Number(row.pending_assignments || 0),
      submittedAssignments: Number(row.submitted_assignments || 0),
      averageScore:
        row.average_score == null
          ? null
          : Number(row.average_score),
    };
  },

  async getStudentRecentAssignments(userId, schoolId) {
    return queryRows(
      `
      SELECT
        a.id,
        a.title,
        a.deadline,
        c.class_code,
        s.name AS subject_name,

        EXISTS (
          SELECT 1
          FROM submissions sub
          WHERE sub.assignment_id = a.id
            AND sub.student_id = $1
            AND sub.school_id = $2
            AND sub.status IN (
              'submitted',
              'resubmitted',
              'late',
              'evaluated',
              'reviewed',
              'graded',
              'flagged'
            )
        ) AS is_submitted

      FROM class_members cm

      JOIN classes c
        ON c.id = cm.class_id
       AND c.school_id = cm.school_id

      JOIN subjects s
        ON s.id = c.subject_id
       AND s.school_id = c.school_id

      JOIN assignments a
        ON a.class_id = c.id
       AND a.school_id = c.school_id

      WHERE cm.student_id = $1
        AND cm.school_id = $2

        AND (
          cm.status IS NULL
          OR cm.status = 'active'
        )

        AND (
          c.is_active IS NULL
          OR c.is_active = true
        )

        AND (
          a.publish_status IS NULL
          OR a.publish_status = 'published'
        )

      ORDER BY a.deadline ASC NULLS LAST
      LIMIT 5
      `,
      [userId, schoolId]
    );
  },

  // =========================================
  // LECTURER
  // =========================================

  async getLecturerStatistics(userId, schoolId) {
    const rows = await queryRows(
      `
      SELECT
        (
          SELECT COUNT(*)
          FROM classes c
          WHERE c.lecturer_id = $1
            AND c.school_id = $2
            AND (
              c.is_active IS NULL
              OR c.is_active = true
            )
        ) AS total_classes,

        (
          SELECT COUNT(DISTINCT cm.student_id)
          FROM class_members cm

          JOIN classes c
            ON c.id = cm.class_id
           AND c.school_id = cm.school_id

          WHERE c.lecturer_id = $1
            AND c.school_id = $2

            AND (
              cm.status IS NULL
              OR cm.status = 'active'
            )

            AND (
              c.is_active IS NULL
              OR c.is_active = true
            )
        ) AS total_students,

        (
          SELECT COUNT(*)
          FROM submissions sub

          JOIN assignments a
            ON a.id = sub.assignment_id
           AND a.school_id = sub.school_id

          JOIN classes c
            ON c.id = a.class_id
           AND c.school_id = a.school_id

          WHERE c.lecturer_id = $1
            AND c.school_id = $2

            AND sub.status IN (
              'submitted',
              'resubmitted',
              'late'
            )

            AND NOT EXISTS (
              SELECT 1
              FROM grades g
              WHERE g.submission_id = sub.id
                AND g.school_id = $2
            )
        ) AS pending_submissions,

        (
          SELECT COUNT(*)
          FROM assignments a

          JOIN classes c
            ON c.id = a.class_id
           AND c.school_id = a.school_id

          WHERE c.lecturer_id = $1
            AND c.school_id = $2

            AND (
              a.publish_status IS NULL
              OR a.publish_status = 'published'
            )
        ) AS total_assignments
      `,
      [userId, schoolId]
    );

    const row = rows[0] || {};

    return {
      totalClasses: Number(row.total_classes || 0),
      totalStudents: Number(row.total_students || 0),
      pendingSubmissions: Number(row.pending_submissions || 0),
      totalAssignments: Number(row.total_assignments || 0),
    };
  },

  async getLecturerRecentSubmissions(userId, schoolId) {
    return queryRows(
      `
      SELECT
        sub.id,
        sub.submitted_at,
        sub.status,

        up.full_name AS student_name,
        smp.student_code,

        a.title AS assignment_title,
        c.class_code

      FROM submissions sub

      JOIN assignments a
        ON a.id = sub.assignment_id
       AND a.school_id = sub.school_id

      JOIN classes c
        ON c.id = a.class_id
       AND c.school_id = a.school_id

      LEFT JOIN user_profiles up
        ON up.user_id = sub.student_id

      LEFT JOIN school_member_profiles smp
        ON smp.user_id = sub.student_id
       AND smp.school_id = sub.school_id

      WHERE c.lecturer_id = $1
        AND c.school_id = $2

        AND sub.status IN (
          'submitted',
          'resubmitted',
          'late'
        )

      ORDER BY sub.submitted_at DESC NULLS LAST
      LIMIT 5
      `,
      [userId, schoolId]
    );
  },

  // =========================================
  // SCHOOL ADMIN
  // =========================================

  async getAdminStatistics(schoolId) {
    const rows = await queryRows(
      `
      SELECT
        (
          SELECT COUNT(*)
          FROM school_memberships sm
          JOIN users u ON u.id = sm.user_id
          WHERE sm.school_id = $1
            AND sm.status = 'active'
            AND u.is_active = true
        ) AS total_users,

        (
          SELECT COUNT(*)
          FROM school_memberships sm
          JOIN users u ON u.id = sm.user_id
          WHERE sm.school_id = $1
            AND sm.role = 'student'
            AND sm.status = 'active'
            AND u.is_active = true
        ) AS total_students,

        (
          SELECT COUNT(*)
          FROM school_memberships sm
          JOIN users u ON u.id = sm.user_id
          WHERE sm.school_id = $1
            AND sm.role = 'lecturer'
            AND sm.status = 'active'
            AND u.is_active = true
        ) AS total_lecturers,

        (
          SELECT COUNT(*)
          FROM classes c
          WHERE c.school_id = $1
            AND c.is_active = true
        ) AS total_classes
      `,
      [schoolId]
    );

    const row = rows[0] || {};

    return {
      totalUsers: Number(row.total_users || 0),
      totalStudents: Number(row.total_students || 0),
      totalLecturers: Number(row.total_lecturers || 0),
      totalClasses: Number(row.total_classes || 0),
    };
  },

  async getAdminRecentUsers(schoolId) {
    return queryRows(
      `
      SELECT
        u.id,
        u.email,
        sm.role,
        u.created_at,
        sm.joined_at,
        up.full_name,
        smp.student_code

      FROM school_memberships sm

      JOIN users u
        ON u.id = sm.user_id

      LEFT JOIN user_profiles up
        ON up.user_id = u.id

      LEFT JOIN school_member_profiles smp
        ON smp.user_id = u.id
       AND smp.school_id = sm.school_id

      WHERE sm.school_id = $1
        AND sm.status = 'active'
        AND u.is_active = true

      ORDER BY sm.joined_at DESC
      LIMIT 5
      `,
      [schoolId]
    );
  },

  // =========================================
  // NOTIFICATIONS
  // =========================================

  async getRecentNotifications(userId, schoolId) {
    return queryRows(
      `
      SELECT
        id,
        title,
        message,
        type,
        is_read,
        created_at

      FROM notifications

      WHERE user_id = $1

        AND (
          (
            notification_scope = 'school'
            AND school_id = $2
          )

          OR (
            notification_scope = 'platform'
            AND school_id IS NULL
          )
        )

      ORDER BY created_at DESC
      LIMIT 5
      `,
      [userId, schoolId]
    );
  },

  async getUnreadCount(userId, schoolId) {
    const rows = await queryRows(
      `
      SELECT COUNT(*) AS count

      FROM notifications

      WHERE user_id = $1
        AND is_read = false

        AND (
          (
            notification_scope = 'school'
            AND school_id = $2
          )

          OR (
            notification_scope = 'platform'
            AND school_id IS NULL
          )
        )
      `,
      [userId, schoolId]
    );

    return Number(rows[0]?.count || 0);
  },
};

module.exports = DashboardRepository;