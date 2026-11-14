
"use strict";

const { pool } = require("../../config/db.config");

function notFound(message) {
  return Object.assign(new Error(message), {
    status: 404,
  });
}

async function requireClassInSchool(
  schoolId,
  classId
) {
  const { rowCount } = await pool.query(
    `
    SELECT 1
    FROM public.classes
    WHERE id = $1
      AND school_id = $2
    LIMIT 1
    `,
    [classId, schoolId]
  );

  if (!rowCount) {
    throw notFound(
      "Không tìm thấy lớp học trong trường"
    );
  }
}

// ===========================================
// 1. ACTIVE LECTURERS IN SELECTED SCHOOL
// ===========================================

async function getLecturers(schoolId) {
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.email,
      up.full_name,
      up.avatar_url,

      sm.school_id,
      sm.role AS school_role,

      mp.staff_code,
      mp.department_id,

      d.code AS department_code,
      d.name AS department_name

    FROM public.school_memberships sm

    JOIN public.users u
      ON u.id = sm.user_id

    LEFT JOIN public.user_profiles up
      ON up.user_id = u.id

    LEFT JOIN public.school_member_profiles mp
      ON mp.school_id = sm.school_id
     AND mp.user_id = sm.user_id

    LEFT JOIN public.departments d
      ON d.id = mp.department_id
     AND d.school_id = sm.school_id

    WHERE sm.school_id = $1
      AND sm.role = 'lecturer'
      AND sm.status = 'active'
      AND u.is_active = TRUE

    ORDER BY
      up.full_name ASC NULLS LAST,
      u.email ASC
    `,
    [schoolId]
  );

  return rows;
}

// ===========================================
// 2. CLASSES IN SELECTED SCHOOL
// ===========================================

async function getAllClasses(schoolId) {
  const { rows } = await pool.query(
    `
    SELECT
      c.id,
      c.school_id,
      c.class_code,
      c.semester_id,
      c.subject_id,
      c.lecturer_id,
      c.max_students,
      c.is_active,

      COALESCE(
        c.schedule_text,
        'T3 (09:30-11:45) • T5 (07:00-09:15)'
      ) AS schedule_text,

      c.created_at,

      s.code AS semester_code,
      s.name AS semester_name,
      s.academic_year AS semester_academic_year,
      s.is_current AS semester_is_current,

      sub.code AS subject_code,
      sub.name AS subject_name,
      sub.credits AS subject_credits,
      sub.department_id,

      d.code AS department_code,
      d.name AS department_name,

      up.full_name AS lecturer_name,
      u.email AS lecturer_email,

      (
        SELECT COUNT(*)::int
        FROM public.class_members cm
        WHERE cm.school_id = c.school_id
          AND cm.class_id = c.id
          AND (
            cm.status IS NULL
            OR cm.status = 'active'
          )
      ) AS enrolled_students,

      (
        SELECT COUNT(*)::int
        FROM public.sessions ses
        WHERE ses.school_id = c.school_id
          AND ses.class_id = c.id
      ) AS slot_count

    FROM public.classes c

    LEFT JOIN public.semesters s
      ON s.id = c.semester_id
     AND s.school_id = c.school_id

    LEFT JOIN public.subjects sub
      ON sub.id = c.subject_id
     AND sub.school_id = c.school_id

    LEFT JOIN public.departments d
      ON d.id = sub.department_id
     AND d.school_id = c.school_id

    LEFT JOIN public.users u
      ON u.id = c.lecturer_id

    LEFT JOIN public.user_profiles up
      ON up.user_id = u.id

    WHERE c.school_id = $1

    ORDER BY c.created_at DESC
    `,
    [schoolId]
  );

  return rows;
}

// ===========================================
// 3. STUDENTS IN A SCHOOL CLASS
// ===========================================

async function getClassStudents(
  schoolId,
  classId
) {
  await requireClassInSchool(
    schoolId,
    classId
  );

  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.email,

      up.full_name,
      up.avatar_url,

      mp.student_code,
      mp.department_id,

      d.code AS department_code,
      d.name AS department_name,

      cm.status,
      cm.school_id

    FROM public.class_members cm

    JOIN public.school_memberships sm
      ON sm.school_id = cm.school_id
     AND sm.user_id = cm.student_id
     AND sm.role = 'student'
     AND sm.status = 'active'

    JOIN public.users u
      ON u.id = cm.student_id
     AND u.is_active = TRUE

    LEFT JOIN public.user_profiles up
      ON up.user_id = u.id

    LEFT JOIN public.school_member_profiles mp
      ON mp.school_id = cm.school_id
     AND mp.user_id = cm.student_id

    LEFT JOIN public.departments d
      ON d.id = mp.department_id
     AND d.school_id = cm.school_id

    WHERE cm.school_id = $1
      AND cm.class_id = $2
      AND (
        cm.status IS NULL
        OR cm.status = 'active'
      )

    ORDER BY
      up.full_name ASC NULLS LAST,
      u.email ASC
    `,
    [schoolId, classId]
  );

  return rows;
}

// ===========================================
// 4. SESSIONS / CLASS SLOTS
// ===========================================

async function getClassSlots(
  schoolId,
  classId
) {
  await requireClassInSchool(
    schoolId,
    classId
  );

  const { rows } = await pool.query(
    `
    SELECT
      ses.id,
      ses.session_no AS slot_number,
      ses.learning_date AS date,

      COALESCE(
        ses.slot_time,
        '09:30-11:45'
      ) AS time,

      ses.title,
      ses.note AS content

    FROM public.sessions ses

    WHERE ses.school_id = $1
      AND ses.class_id = $2

    ORDER BY ses.session_no ASC
    `,
    [schoolId, classId]
  );

  return rows;
}

module.exports = {
  getLecturers,
  getAllClasses,
  getClassStudents,
  getClassSlots,
};
