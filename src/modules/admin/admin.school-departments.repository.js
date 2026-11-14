
"use strict";

const {
  pool,
  withTransaction,
} = require("../../config/db.config");

function httpError(message, status) {
  return Object.assign(
    new Error(message),
    { status }
  );
}

// Recheck School Admin permission inside
// the same transaction as the write.
async function requireSchoolAdmin(
  client,
  schoolId,
  actorUserId
) {
  const { rowCount } = await client.query(
    `
    SELECT s.id
    FROM public.schools s

    JOIN public.school_memberships sm
      ON sm.school_id = s.id

    JOIN public.users u
      ON u.id = sm.user_id

    WHERE s.id = $1
      AND s.status = 'active'
      AND sm.user_id = $2
      AND sm.role = 'school_admin'
      AND sm.status = 'active'
      AND u.is_active = TRUE

    FOR UPDATE OF s
    `,
    [schoolId, actorUserId]
  );

  if (!rowCount) {
    throw httpError(
      "Không có quyền quản lý khoa tại trường này",
      403
    );
  }
}

// =============================================
// GET DEPARTMENTS BY SCHOOL
// =============================================

async function getAllDepartments(schoolId) {
  const { rows } = await pool.query(
    `
    SELECT
      d.id,
      d.school_id,
      d.code,
      d.name,
      d.is_active,
      d.created_at,
      d.updated_at,

      (
        SELECT COUNT(*)::int
        FROM public.subjects sub
        WHERE sub.school_id = d.school_id
          AND sub.department_id = d.id
          AND sub.is_active = TRUE
      ) AS subject_count,

      (
        SELECT COUNT(*)::int
        FROM public.school_member_profiles mp

        JOIN public.school_memberships sm
          ON sm.school_id = mp.school_id
         AND sm.user_id = mp.user_id

        JOIN public.users u
          ON u.id = mp.user_id

        WHERE mp.school_id = d.school_id
          AND mp.department_id = d.id
          AND sm.role = 'lecturer'
          AND sm.status = 'active'
          AND u.is_active = TRUE
      ) AS lecturer_count,

      (
        SELECT COUNT(*)::int
        FROM public.school_member_profiles mp

        JOIN public.school_memberships sm
          ON sm.school_id = mp.school_id
         AND sm.user_id = mp.user_id

        JOIN public.users u
          ON u.id = mp.user_id

        WHERE mp.school_id = d.school_id
          AND mp.department_id = d.id
          AND sm.role = 'student'
          AND sm.status = 'active'
          AND u.is_active = TRUE
      ) AS student_count,

      (
        SELECT COUNT(*)::int
        FROM public.classes c

        JOIN public.subjects sub
          ON sub.id = c.subject_id
         AND sub.school_id = c.school_id

        WHERE c.school_id = d.school_id
          AND sub.department_id = d.id
          AND c.is_active = TRUE
      ) AS class_count

    FROM public.departments d

    WHERE d.school_id = $1

    ORDER BY d.code ASC, d.name ASC
    `,
    [schoolId]
  );

  return rows;
}

// =============================================
// CREATE SCHOOL DEPARTMENT
// =============================================

async function createDepartment({
  schoolId,
  actorUserId,
  data,
}) {
  return withTransaction(async (client) => {
    await requireSchoolAdmin(
      client,
      schoolId,
      actorUserId
    );

    const { rows } = await client.query(
      `
      INSERT INTO public.departments (
        school_id,
        code,
        name,
        is_active
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [
        schoolId,
        data.code.trim().toUpperCase(),
        data.name.trim(),
        data.is_active ?? true,
      ]
    );

    return rows[0];
  });
}

// =============================================
// UPDATE SCHOOL DEPARTMENT
// =============================================

async function updateDepartment({
  schoolId,
  actorUserId,
  departmentId,
  data,
}) {
  return withTransaction(async (client) => {
    await requireSchoolAdmin(
      client,
      schoolId,
      actorUserId
    );

    const { rowCount } = await client.query(
      `
      SELECT id
      FROM public.departments
      WHERE school_id = $1
        AND id = $2
      FOR UPDATE
      `,
      [schoolId, departmentId]
    );

    if (!rowCount) return null;

    const updates = [];
    const values = [schoolId, departmentId];

    if (data.code !== undefined) {
      values.push(
        data.code.trim().toUpperCase()
      );

      updates.push(
        `code = $${values.length}`
      );
    }

    if (data.name !== undefined) {
      values.push(data.name.trim());

      updates.push(
        `name = $${values.length}`
      );
    }

    if (data.is_active !== undefined) {
      values.push(data.is_active);

      updates.push(
        `is_active = $${values.length}`
      );
    }

    if (updates.length === 0) {
      throw httpError(
        "Không có thông tin khoa cần cập nhật",
        400
      );
    }

    const { rows } = await client.query(
      `
      UPDATE public.departments

      SET
        ${updates.join(", ")},
        updated_at = NOW()

      WHERE school_id = $1
        AND id = $2

      RETURNING *
      `,
      values
    );

    return rows[0] || null;
  });
}

// =============================================
// SOFT DELETE SCHOOL DEPARTMENT
// =============================================

async function deleteDepartment({
  schoolId,
  actorUserId,
  departmentId,
}) {
  return withTransaction(async (client) => {
    await requireSchoolAdmin(
      client,
      schoolId,
      actorUserId
    );

    // Preserve subjects, member profiles
    // and historical references.
    const { rows } = await client.query(
      `
      UPDATE public.departments

      SET
        is_active = FALSE,
        updated_at = NOW()

      WHERE school_id = $1
        AND id = $2

      RETURNING *
      `,
      [schoolId, departmentId]
    );

    return rows[0]
      ? {
          ...rows[0],
          action: "deactivated",
        }
      : null;
  });
}

module.exports = {
  getAllDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
};
