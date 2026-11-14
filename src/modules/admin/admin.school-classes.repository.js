
"use strict";

const { withTransaction } = require("../../config/db.config");
const legacyRepository = require("./admin.repository");

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function createSchoolClass({
  schoolId,
  actorUserId,
  data,
}) {
  if (!schoolId || !actorUserId) {
    throw httpError("School context is required", 400);
  }

  return withTransaction(async (client) => {
    // 1. Lock school and check its status.
    const school = await client.query(
      `
      SELECT id
      FROM public.schools
      WHERE id = $1
        AND status = 'active'
      FOR UPDATE
      `,
      [schoolId]
    );

    if (!school.rowCount) {
      throw httpError("Trường không hoạt động", 403);
    }

    // 2. Verify the actor is still School Admin.
    const admin = await client.query(
      `
      SELECT 1
      FROM public.school_memberships sm
      JOIN public.users u
        ON u.id = sm.user_id
      WHERE sm.school_id = $1
        AND sm.user_id = $2
        AND sm.role = 'school_admin'
        AND sm.status = 'active'
        AND u.is_active = TRUE
      LIMIT 1
      `,
      [schoolId, actorUserId]
    );

    if (!admin.rowCount) {
      throw httpError("Không có quyền tạo lớp", 403);
    }

    // 3. Semester must belong to this school.
    const semester = await client.query(
      `
      SELECT id
      FROM public.semesters
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
      `,
      [data.semester_id, schoolId]
    );

    if (!semester.rowCount) {
      throw httpError(
        "Học kỳ không thuộc trường hiện tại",
        400
      );
    }

    // 4. Subject must belong to this school.
    const subject = await client.query(
      `
      SELECT id
      FROM public.subjects
      WHERE id = $1
        AND school_id = $2
        AND is_active = TRUE
      LIMIT 1
      `,
      [data.subject_id, schoolId]
    );

    if (!subject.rowCount) {
      throw httpError(
        "Môn học không thuộc trường hoặc không hoạt động",
        400
      );
    }

    // 5. Lecturer must have an active membership.
    const lecturer = await client.query(
      `
      SELECT 1
      FROM public.school_memberships sm

      JOIN public.users u
        ON u.id = sm.user_id

      WHERE sm.school_id = $1
        AND sm.user_id = $2
        AND sm.role = 'lecturer'
        AND sm.status = 'active'
        AND u.is_active = TRUE
      LIMIT 1
      `,
      [schoolId, data.lecturer_id]
    );

    if (!lecturer.rowCount) {
      throw httpError(
        "Giảng viên không thuộc trường hoặc không hoạt động",
        400
      );
    }

    // 6. Reuse only the legacy schedule generator,
    // not the legacy database-writing method.
    const { scheduleText, sessions } =
      legacyRepository.buildClassSessionsSchedule({
        scheduleText:
          data.schedule_text ||
          "T3 (09:30-11:45) • T5 (07:00-09:15)",
        startDateStr:
          data.start_date || "2026-09-08",
        totalSlots: data.total_slots ?? 20,
      });

    // 7. Insert class with explicit school_id.
    const created = await client.query(
      `
      INSERT INTO public.classes (
        school_id,
        class_code,
        semester_id,
        subject_id,
        lecturer_id,
        max_students,
        schedule_text
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        schoolId,
        data.class_code.trim().toUpperCase(),
        data.semester_id,
        data.subject_id,
        data.lecturer_id,
        data.max_students ?? 30,
        scheduleText,
      ]
    );

    const classRow = created.rows[0];

    // 8. Create sessions in the SAME transaction
    // and explicitly assign school_id.
    for (const slot of sessions) {
      await client.query(
        `
        INSERT INTO public.sessions (
          school_id,
          class_id,
          session_no,
          title,
          note,
          learning_date,
          slot_time,
          is_published
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
        `,
        [
          schoolId,
          classRow.id,
          slot.session_no,
          slot.title,
          slot.note,
          slot.learning_date,
          slot.slot_time,
        ]
      );
    }

    return {
      ...classRow,
      sessions_created: sessions.length,
    };
  });
}


const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateClassId(classId) {
  if (!UUID_REGEX.test(classId)) {
    throw httpError("ID lớp học không hợp lệ", 400);
  }
}

async function requireSchoolAdminForWrite(
  client,
  schoolId,
  actorUserId
) {
  // Lock school to coordinate membership changes.
  const school = await client.query(
    `
    SELECT id
    FROM public.schools
    WHERE id = $1
      AND status = 'active'
    FOR UPDATE
    `,
    [schoolId]
  );

  if (!school.rowCount) {
    throw httpError("Trường không hoạt động", 403);
  }

  const actor = await client.query(
    `
    SELECT 1
    FROM public.school_memberships sm
    JOIN public.users u
      ON u.id = sm.user_id
    WHERE sm.school_id = $1
      AND sm.user_id = $2
      AND sm.role = 'school_admin'
      AND sm.status = 'active'
      AND u.is_active = TRUE
    LIMIT 1
    `,
    [schoolId, actorUserId]
  );

  if (!actor.rowCount) {
    throw httpError(
      "Không có quyền quản lý lớp học",
      403
    );
  }
}

// =============================================
// UPDATE CLASS IN CURRENT SCHOOL
// =============================================

async function updateSchoolClass({
  schoolId,
  actorUserId,
  classId,
  data,
}) {
  validateClassId(classId);

  return withTransaction(async (client) => {
    await requireSchoolAdminForWrite(
      client,
      schoolId,
      actorUserId
    );

    const existing = await client.query(
      `
      SELECT *
      FROM public.classes
      WHERE school_id = $1
        AND id = $2
      FOR UPDATE
      `,
      [schoolId, classId]
    );

    if (!existing.rowCount) {
      throw httpError(
        "Không tìm thấy lớp trong trường",
        404
      );
    }

    const current = existing.rows[0];

    // Protect academic history.
    // Semester/Subject cannot be changed
    // through this endpoint after creation.
    if (
      data.semester_id !== undefined &&
      data.semester_id !== current.semester_id
    ) {
      throw httpError(
        "Không hỗ trợ đổi học kỳ của lớp đã tạo",
        409
      );
    }

    if (
      data.subject_id !== undefined &&
      data.subject_id !== current.subject_id
    ) {
      throw httpError(
        "Không hỗ trợ đổi môn học của lớp đã tạo",
        409
      );
    }

    // Schedule changes must use the dedicated
    // Slots API, not this update endpoint.
    if (
      data.schedule_text !== undefined &&
      data.schedule_text !== current.schedule_text
    ) {
      throw httpError(
        "Vui lòng cập nhật lịch học qua API Slots",
        409
      );
    }

    // Validate new lecturer membership.
    if (
      data.lecturer_id !== undefined &&
      data.lecturer_id !== current.lecturer_id
    ) {
      const lecturer = await client.query(
        `
        SELECT 1
        FROM public.school_memberships sm
        JOIN public.users u
          ON u.id = sm.user_id

        WHERE sm.school_id = $1
          AND sm.user_id = $2
          AND sm.role = 'lecturer'
          AND sm.status = 'active'
          AND u.is_active = TRUE
        LIMIT 1
        `,
        [schoolId, data.lecturer_id]
      );

      if (!lecturer.rowCount) {
        throw httpError(
          "Giảng viên không thuộc trường hoặc không hoạt động",
          400
        );
      }
    }

    // Cannot reduce capacity below current
    // active enrollment.
    if (data.max_students !== undefined) {
      const enrolled = await client.query(
        `
        SELECT COUNT(*)::int AS total
        FROM public.class_members
        WHERE school_id = $1
          AND class_id = $2
          AND (
            status IS NULL
            OR status = 'active'
          )
        `,
        [schoolId, classId]
      );

      if (
        data.max_students <
        enrolled.rows[0].total
      ) {
        throw httpError(
          "Sĩ số tối đa không được nhỏ hơn số sinh viên đang học",
          409
        );
      }
    }

    // Strict whitelist: never update school_id.
    const fields = [];
    const values = [schoolId, classId];

    const updates = {
      class_code: data.class_code === undefined
        ? undefined
        : data.class_code.trim().toUpperCase(),

      lecturer_id: data.lecturer_id,
      max_students: data.max_students,
      is_active: data.is_active,
    };

    for (const [column, value] of Object.entries(updates)) {
      if (value === undefined) continue;

      values.push(value);
      fields.push(
        `${column} = $${values.length}`
      );
    }

    if (!fields.length) {
      return current;
    }

    const { rows } = await client.query(
      `
      UPDATE public.classes
      SET
        ${fields.join(", ")},
        updated_at = NOW()
      WHERE school_id = $1
        AND id = $2
      RETURNING *
      `,
      values
    );

    return rows[0];
  });
}

// =============================================
// SOFT DELETE CLASS
// =============================================

async function deleteSchoolClass({
  schoolId,
  actorUserId,
  classId,
}) {
  validateClassId(classId);

  return withTransaction(async (client) => {
    await requireSchoolAdminForWrite(
      client,
      schoolId,
      actorUserId
    );

    const { rows } = await client.query(
      `
      UPDATE public.classes
      SET
        is_active = FALSE,
        updated_at = NOW()
      WHERE school_id = $1
        AND id = $2
      RETURNING
        id,
        school_id,
        class_code,
        is_active
      `,
      [schoolId, classId]
    );

    if (!rows.length) {
      throw httpError(
        "Không tìm thấy lớp trong trường",
        404
      );
    }

    return {
      ...rows[0],
      action: "deactivated",
    };
  });
}

async function updateSchoolClassSlots({
  schoolId,
  actorUserId,
  classId,
  payload,
}) {
  validateClassId(classId);

  return withTransaction(async (client) => {
    await requireSchoolAdminForWrite(
      client,
      schoolId,
      actorUserId
    );

    const classResult = await client.query(
      `
      SELECT
        c.id,
        c.schedule_text,
        s.is_locked
      FROM public.classes c
      JOIN public.semesters s
        ON s.id = c.semester_id
       AND s.school_id = c.school_id
      WHERE c.school_id = $1
        AND c.id = $2
      FOR UPDATE OF c, s
      `,
      [schoolId, classId]
    );

    if (!classResult.rowCount) {
      throw httpError(
        "Không tìm thấy lớp trong trường",
        404
      );
    }

    if (classResult.rows[0].is_locked) {
      throw httpError(
        "Không thể cập nhật lịch của học kỳ đã khóa",
        409
      );
    }

    const options = {
      scheduleText:
        payload.schedule_text ||
        payload.scheduleText ||
        classResult.rows[0].schedule_text,
      startDateStr: payload.start_date || payload.startDate,
      totalSlots: payload.total_slots ?? payload.totalSlots ?? 20,
      explicitSlots: Array.isArray(payload.slots)
        ? payload.slots
        : [],
    };

    const { scheduleText, sessions } =
      legacyRepository.buildClassSessionsSchedule(options);

    const sessionNumbers = sessions.map(
      (session) => session.session_no
    );

    if (
      sessions.length === 0 ||
      sessionNumbers.some(
        (number) => !Number.isInteger(number) || number < 1
      ) ||
      new Set(sessionNumbers).size !== sessionNumbers.length
    ) {
      throw httpError("Danh sách session không hợp lệ", 400);
    }

    await client.query(
      `
      UPDATE public.classes
      SET schedule_text = $3,
          updated_at = NOW()
      WHERE school_id = $1
        AND id = $2
      `,
      [schoolId, classId, scheduleText]
    );

    for (const session of sessions) {
      const existing = await client.query(
        `
        SELECT id
        FROM public.sessions
        WHERE school_id = $1
          AND class_id = $2
          AND session_no = $3
        FOR UPDATE
        `,
        [schoolId, classId, session.session_no]
      );

      if (existing.rowCount) {
        await client.query(
          `
          UPDATE public.sessions
          SET title = $4,
              note = $5,
              learning_date = $6,
              slot_time = $7,
              updated_at = NOW()
          WHERE school_id = $1
            AND class_id = $2
            AND session_no = $3
          `,
          [
            schoolId,
            classId,
            session.session_no,
            session.title,
            session.note,
            session.learning_date,
            session.slot_time,
          ]
        );
        continue;
      }

      await client.query(
        `
        INSERT INTO public.sessions (
          school_id,
          class_id,
          session_no,
          title,
          note,
          learning_date,
          slot_time,
          is_published
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
        `,
        [
          schoolId,
          classId,
          session.session_no,
          session.title,
          session.note,
          session.learning_date,
          session.slot_time,
        ]
      );
    }

    const { rows } = await client.query(
      `
      SELECT
        id,
        session_no AS slot_number,
        learning_date AS date,
        COALESCE(slot_time, '09:30-11:45') AS time,
        title,
        note AS content
      FROM public.sessions
      WHERE school_id = $1
        AND class_id = $2
      ORDER BY session_no ASC
      `,
      [schoolId, classId]
    );

    return rows;
  });
}


async function addSchoolClassStudent({
  schoolId,
  actorUserId,
  classId,
  payload,
}) {
  validateClassId(classId);

  const studentId = payload.student_id;
  const identifier = payload.identifier?.trim();

  if (!studentId && !identifier) {
    throw httpError(
      "Cần cung cấp Student ID hoặc Email/MSSV",
      400
    );
  }

  return withTransaction(async (client) => {
    // 1. Recheck School Admin permission.
    await requireSchoolAdminForWrite(
      client,
      schoolId,
      actorUserId
    );

    // 2. Lock class to serialize enrollment.
    const classResult = await client.query(
      `
      SELECT id, max_students, is_active
      FROM public.classes
      WHERE school_id = $1
        AND id = $2
      FOR UPDATE
      `,
      [schoolId, classId]
    );

    if (!classResult.rowCount) {
      throw httpError(
        "Không tìm thấy lớp trong trường",
        404
      );
    }

    const selectedClass = classResult.rows[0];

    if (!selectedClass.is_active) {
      throw httpError(
        "Không thể thêm sinh viên vào lớp đã ngưng hoạt động",
        409
      );
    }

    // 3. Find an active STUDENT membership
    // in the selected school.
    const condition = studentId
      ? "sm.user_id = $2"
      : `(
          LOWER(u.email) = LOWER($2)
          OR LOWER(mp.student_code) = LOWER($2)
        )`;

    const studentResult = await client.query(
      `
      SELECT
        u.id,
        u.email,
        up.full_name,
        up.avatar_url,
        mp.student_code,
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
        AND sm.role = 'student'
        AND sm.status = 'active'
        AND u.is_active = TRUE
        AND ${condition}

      LIMIT 2
      `,
      [schoolId, studentId || identifier]
    );

    if (!studentResult.rowCount) {
      throw httpError(
        "Không tìm thấy sinh viên đang hoạt động tại trường",
        404
      );
    }

    if (studentResult.rowCount > 1) {
      throw httpError(
        "Thông tin tìm kiếm khớp nhiều sinh viên; hãy chọn Student ID",
        409
      );
    }

    const student = studentResult.rows[0];

    // 4. Check existing class membership.
    const existing = await client.query(
      `
      SELECT id, status
      FROM public.class_members
      WHERE school_id = $1
        AND class_id = $2
        AND student_id = $3
      FOR UPDATE
      `,
      [schoolId, classId, student.id]
    );

    if (existing.rowCount) {
      const status = existing.rows[0].status;

      if (!status || status === "active") {
        throw httpError(
          "Sinh viên đã có trong lớp",
          409
        );
      }
    }

    // 5. Check maximum capacity.
    const countResult = await client.query(
      `
      SELECT COUNT(*)::int AS total
      FROM public.class_members
      WHERE school_id = $1
        AND class_id = $2
        AND (
          status IS NULL
          OR status = 'active'
        )
      `,
      [schoolId, classId]
    );

    const total = countResult.rows[0].total;
    const maxStudents = selectedClass.max_students;

    if (
      maxStudents != null &&
      total >= Number(maxStudents)
    ) {
      throw httpError(
        `Lớp đã đạt sĩ số tối đa (${maxStudents})`,
        409
      );
    }

    // 6. Insert or reactivate class membership.
    if (existing.rowCount) {
      await client.query(
        `
        UPDATE public.class_members
        SET status = 'active',
            updated_at = NOW()
        WHERE id = $1
          AND school_id = $2
          AND class_id = $3
          AND student_id = $4
        `,
        [
          existing.rows[0].id,
          schoolId,
          classId,
          student.id,
        ]
      );
    } else {
      await client.query(
        `
        INSERT INTO public.class_members (
          school_id,
          class_id,
          student_id,
          status
        )
        VALUES ($1, $2, $3, 'active')
        `,
        [schoolId, classId, student.id]
      );
    }

    return {
      ...student,
      school_id: schoolId,
      class_id: classId,
      status: "active",
    };
  });
}

async function removeSchoolClassStudent({
  schoolId,
  actorUserId,
  classId,
  studentId,
}) {
  validateClassId(classId);

  return withTransaction(async (client) => {
    await requireSchoolAdminForWrite(
      client,
      schoolId,
      actorUserId
    );

    const { rows } = await client.query(
      `
      UPDATE public.class_members
      SET status = 'dropped',
          updated_at = NOW()
      WHERE school_id = $1
        AND class_id = $2
        AND student_id = $3
        AND (status IS NULL OR status = 'active')
      RETURNING id
      `,
      [schoolId, classId, studentId]
    );

    if (!rows.length) {
      throw httpError(
        "Không tìm thấy sinh viên đang học trong lớp",
        404
      );
    }

    return {
      school_id: schoolId,
      class_id: classId,
      student_id: studentId,
      status: "dropped",
    };
  });
}


module.exports = {
  createSchoolClass,
  updateSchoolClass,
  deleteSchoolClass,
  updateSchoolClassSlots,
  addSchoolClassStudent,
  removeSchoolClassStudent,
};
