
const { pool } = require('../../config/db.config');

const ProjectsRepository = {
    async create({ classId, ownerId, schoolId, name, description }) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const classResult = await client.query(
                `SELECT id FROM classes
         WHERE id = $1
           AND school_id = $2
           AND is_active = true`,
                [classId, schoolId]
            );

            if (!classResult.rowCount) {
                throw new Error('CLASS_NOT_FOUND');
            }

            const memberResult = await client.query(
                `SELECT 1
         FROM class_members cm
         JOIN classes c
           ON c.id = cm.class_id
          AND c.school_id = cm.school_id
         JOIN school_memberships sm
           ON sm.school_id = c.school_id
          AND sm.user_id = cm.student_id
          AND sm.role = 'student'
          AND sm.status = 'active'
         WHERE cm.class_id = $1
           AND cm.school_id = $2
           AND cm.student_id = $3
           AND cm.status = 'active'`,
                [classId, schoolId, ownerId]
            );

            if (!memberResult.rowCount) {
                throw new Error('NOT_CLASS_MEMBER');
            }

            const created = await client.query(
                `INSERT INTO projects
           (class_id, owner_id, name, description)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
                [classId, ownerId, name, description]
            );

            const project = created.rows[0];

            await client.query(
                `INSERT INTO project_members
           (project_id, class_id, user_id, role,
            status, joined_at)
         VALUES ($1, $2, $3, 'owner', 'active', NOW())`,
                [project.id, classId, ownerId]
            );

            await client.query('COMMIT');
            return project;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    async findById(projectId) {
        const { rows } = await pool.query(
            `SELECT p.*,
              c.class_code,
              s.name AS subject_name,
              up.full_name AS owner_name
       FROM projects p
       JOIN classes c ON c.id = p.class_id
       JOIN subjects s
         ON s.id = c.subject_id
        AND s.school_id = c.school_id
       LEFT JOIN user_profiles up
         ON up.user_id = p.owner_id
       WHERE p.id = $1`,
            [projectId]
        );

        return rows[0];
    },

    async findMyProjects(userId, schoolId) {
        const { rows } = await pool.query(
            `SELECT p.id, p.name, p.description,
              p.class_id, p.status,
              p.created_at,
              c.class_code,
              s.name AS subject_name,
              pm.role AS my_role
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       JOIN classes c ON c.id = p.class_id
       JOIN subjects s
         ON s.id = c.subject_id
        AND s.school_id = c.school_id
       WHERE pm.user_id = $1
         AND pm.status = 'active'
         AND p.status = 'active'
         AND c.school_id = $2
       ORDER BY p.created_at DESC`,
            [userId, schoolId]
        );

        return rows;
    },

    async findByClass(classId, schoolId) {
        const { rows } = await pool.query(
            `SELECT p.*,
              up.full_name AS owner_name,
              COUNT(pm.id) FILTER (
                WHERE pm.status = 'active'
              )::int AS member_count
       FROM projects p
       JOIN classes c
         ON c.id = p.class_id
        AND c.school_id = $2
       LEFT JOIN user_profiles up
         ON up.user_id = p.owner_id
       LEFT JOIN project_members pm
         ON pm.project_id = p.id
       WHERE p.class_id = $1
       GROUP BY p.id, up.full_name
       ORDER BY p.created_at DESC`,
            [classId, schoolId]
        );

        return rows;
    },

    async findMembers(projectId) {
        const { rows } = await pool.query(
            `SELECT pm.id, pm.user_id, pm.role,
              pm.status, pm.joined_at,
              up.full_name, up.student_code
       FROM project_members pm
       LEFT JOIN user_profiles up
         ON up.user_id = pm.user_id
       WHERE pm.project_id = $1
         AND pm.status = 'active'
       ORDER BY pm.joined_at, pm.created_at`,
            [projectId]
        );

        return rows;
    },

    async findActiveMember(projectId, userId) {
        const { rows } = await pool.query(
            `SELECT *
       FROM project_members
       WHERE project_id = $1
         AND user_id = $2
         AND status = 'active'`,
            [projectId, userId]
        );

        return rows[0];
    },

    async isActiveClassMember(classId, userId) {
        const { rows } = await pool.query(
            `SELECT 1
       FROM class_members
       WHERE class_id = $1
         AND student_id = $2
         AND status = 'active'
       LIMIT 1`,
            [classId, userId]
        );

        return rows.length > 0;
    },

    async invite({ projectId, classId, userId, invitedBy }) {
        // Cho phép mời lại người từng reject hoặc leave.
        const { rows } = await pool.query(
            `INSERT INTO project_members
         (project_id, class_id, user_id, role,
          status, invited_by)
       VALUES ($1, $2, $3, 'member', 'pending', $4)
       ON CONFLICT (project_id, user_id)
       DO UPDATE SET
         status = 'pending',
         invited_by = EXCLUDED.invited_by,
         joined_at = NULL,
         updated_at = NOW()
       WHERE project_members.status IN ('rejected', 'left')
         AND project_members.role = 'member'
       RETURNING *`,
            [projectId, classId, userId, invitedBy]
        );

        return rows[0] || null;
    },

    async respondToInvitation(invitationId, userId, accept) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const { rows } = await client.query(
                `SELECT pm.*, p.status AS project_status,
                cm.status AS class_membership_status
         FROM project_members pm
         JOIN projects p ON p.id = pm.project_id
                JOIN classes c ON c.id = pm.class_id
         LEFT JOIN class_members cm
           ON cm.class_id = pm.class_id
          AND cm.student_id = pm.user_id
                 AND cm.school_id = c.school_id
         WHERE pm.id = $1
           AND pm.user_id = $2
         FOR UPDATE OF pm`,
                [invitationId, userId]
            );

            const invitation = rows[0];

            if (!invitation) {
                throw new Error('INVITATION_NOT_FOUND');
            }

            if (invitation.status !== 'pending') {
                throw new Error('INVITATION_ALREADY_PROCESSED');
            }

            if (
                invitation.project_status !== 'active' ||
                invitation.class_membership_status !== 'active'
            ) {
                throw new Error('INVITATION_NOT_AVAILABLE');
            }

            const nextStatus = accept ? 'active' : 'rejected';


            const updated = await client.query(
                `UPDATE project_members
   SET status = $1,
       joined_at = CASE
         WHEN $3 THEN NOW()
         ELSE NULL
       END,
       updated_at = NOW()
   WHERE id = $2
   RETURNING *`,
                [nextStatus, invitationId, accept]
            );


            await client.query('COMMIT');
            return updated.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },


    async findPendingInvitations(userId, schoolId) {
        const { rows } = await pool.query(
            `SELECT
       pm.id AS invitation_id,
       pm.project_id,
       pm.class_id,
       p.name AS project_name,
       c.class_code,
       s.name AS subject_name,
       up.full_name AS inviter_name,
       pm.created_at
     FROM project_members pm
     JOIN projects p ON p.id = pm.project_id
     JOIN classes c ON c.id = pm.class_id
     JOIN subjects s
       ON s.id = c.subject_id
      AND s.school_id = c.school_id
     LEFT JOIN user_profiles up
       ON up.user_id = pm.invited_by
     WHERE pm.user_id = $1
       AND pm.status = 'pending'
       AND p.status = 'active'
       AND c.is_active = true
       AND c.school_id = $2
       AND EXISTS (
         SELECT 1
         FROM class_members cm
         WHERE cm.class_id = pm.class_id
           AND cm.student_id = pm.user_id
           AND cm.school_id = c.school_id
           AND cm.status = 'active'
       )
     ORDER BY pm.created_at DESC`,
            [userId, schoolId]
        );

        return rows;
    },


    async findProjectInvitations(projectId, schoolId) {
        const query = `
    SELECT
      pm.id AS invitation_id,
      pm.project_id,
      pm.user_id,
      pm.role,
      pm.status,
      pm.invited_by,
      pm.created_at,
      pm.updated_at,
      pm.joined_at,
      up.full_name,
      up.student_code,
      u.email
    FROM project_members pm
    JOIN users u
      ON u.id = pm.user_id
    JOIN projects p
      ON p.id = pm.project_id
    JOIN classes c
      ON c.id = p.class_id
     AND c.school_id = $2
    LEFT JOIN user_profiles up
      ON up.user_id = pm.user_id
    WHERE pm.project_id = $1
      AND pm.role = 'member'
    ORDER BY
      CASE pm.status
        WHEN 'pending' THEN 1
        WHEN 'active' THEN 2
        WHEN 'rejected' THEN 3
        ELSE 4
      END,
      pm.created_at DESC
  `;

        const { rows } = await pool.query(query, [projectId, schoolId]);

        return rows;
    },

    async findInvitationForUser(invitationId, userId) {
        const { rows } = await pool.query(
            `SELECT pm.id, pm.class_id
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       WHERE pm.id = $1
         AND pm.user_id = $2
         AND pm.status = 'pending'
         AND p.status = 'active'`,
            [invitationId, userId]
        );

        return rows[0];
    },


};

module.exports = ProjectsRepository;
