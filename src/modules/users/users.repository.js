
const {
  pool,
  withTransaction,
} = require("../../config/db.config");

function createHttpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

class UsersRepository {
  // =========================================
  // FIND CURRENT USER IN SELECTED SCHOOL
  // =========================================

  async findUserByIdWithProfile({
    userId,
    schoolId,
  }) {
    if (!userId || !schoolId) {
      throw createHttpError(
        "School context is required",
        400
      );
    }

    const query = `
      SELECT
        -- Global account
        u.id,
        u.email,
        u.username,
        u.is_active,
        u.last_login_at,
        u.created_at,

        -- Compatibility for existing EDUX UI
        CASE
          WHEN sm.role = 'school_admin'
          THEN 'admin'
          ELSE sm.role
        END AS role,

        -- Canonical school membership
        sm.role AS school_role,
        sm.school_id,
        sm.status AS membership_status,

        -- Global personal profile
        p.avatar_url,
        p.full_name,

        -- School-specific profile
        mp.student_code,
        mp.staff_code,

        -- Department in the selected school
        d.id AS department_id,
        d.code AS department_code,
        d.name AS department_name

      FROM public.users u

      INNER JOIN public.user_profiles p
        ON p.user_id = u.id

      INNER JOIN public.school_memberships sm
        ON sm.user_id = u.id

      INNER JOIN public.schools s
        ON s.id = sm.school_id

      LEFT JOIN public.school_member_profiles mp
        ON mp.school_id = sm.school_id
       AND mp.user_id = sm.user_id

      LEFT JOIN public.departments d
        ON d.id = mp.department_id
       AND d.school_id = sm.school_id

      WHERE u.id = $1
        AND sm.school_id = $2
        AND u.is_active = TRUE
        AND sm.status = 'active'
        AND s.status = 'active'

      LIMIT 1
    `;

    const { rows } = await pool.query(
      query,
      [userId, schoolId]
    );

    return rows[0] || null;
  }

  // =========================================
  // UPDATE GLOBAL + SCHOOL PROFILE ATOMICALLY
  // =========================================

  async updateUserProfile({
    userId,
    schoolId,
    updateData,
  }) {
    if (!userId || !schoolId) {
      throw createHttpError(
        "School context is required",
        400
      );
    }

    return withTransaction(async (client) => {
      // =====================================
      // 1. RECHECK CURRENT MEMBERSHIP
      // =====================================

      const membershipResult =
        await client.query(
          `
          SELECT sm.role
          FROM public.school_memberships sm

          INNER JOIN public.schools s
            ON s.id = sm.school_id

          INNER JOIN public.users u
            ON u.id = sm.user_id

          WHERE sm.school_id = $1
            AND sm.user_id = $2
            AND sm.status = 'active'
            AND s.status = 'active'
            AND u.is_active = TRUE

          FOR SHARE OF sm
          `,
          [schoolId, userId]
        );

      if (membershipResult.rowCount === 0) {
        throw createHttpError(
          "School membership is unavailable",
          403
        );
      }

      const currentRole =
        membershipResult.rows[0].role;

      const {
        full_name,
        avatar_url,
        department_id,
      } = updateData;

      // =====================================
      // 2. VALIDATE SCHOOL-SPECIFIC FIELDS
      // =====================================

      if (department_id !== undefined) {
        if (currentRole !== "lecturer") {
          throw createHttpError(
            "Only lecturers can update their department",
            403
          );
        }

        // null means remove department.
        if (department_id !== null) {
          const departmentResult =
            await client.query(
              `
              SELECT id
              FROM public.departments
              WHERE id = $1
                AND school_id = $2
              LIMIT 1
              `,
              [department_id, schoolId]
            );

          if (departmentResult.rowCount === 0) {
            throw createHttpError(
              "Department does not belong to this school",
              400
            );
          }
        }
      }

      // =====================================
      // 3. UPDATE GLOBAL PERSONAL PROFILE
      // =====================================

      const fields = [];
      const values = [userId];

      if (full_name !== undefined) {
        values.push(full_name);

        fields.push(
          `full_name = $${values.length}`
        );
      }

      if (avatar_url !== undefined) {
        values.push(avatar_url);

        fields.push(
          `avatar_url = $${values.length}`
        );
      }

      if (fields.length > 0) {
        const globalResult =
          await client.query(
            `
            UPDATE public.user_profiles

            SET
              ${fields.join(", ")},
              updated_at = NOW()

            WHERE user_id = $1

            RETURNING user_id
            `,
            values
          );

        if (globalResult.rowCount === 0) {
          throw createHttpError(
            "Global user profile not found",
            404
          );
        }
      }

      // =====================================
      // 4. UPDATE SCHOOL-SPECIFIC PROFILE
      // =====================================

      if (department_id !== undefined) {
        const schoolResult =
          await client.query(
            `
            UPDATE public.school_member_profiles

            SET
              department_id = $3,
              updated_at = NOW()

            WHERE school_id = $1
              AND user_id = $2

            RETURNING user_id
            `,
            [
              schoolId,
              userId,
              department_id,
            ]
          );

        if (schoolResult.rowCount === 0) {
          throw createHttpError(
            "School member profile not found",
            409
          );
        }
      }

      // =====================================
      // 5. SUCCESS
      // =====================================

      return true;
    });
  }
}

module.exports = new UsersRepository();
