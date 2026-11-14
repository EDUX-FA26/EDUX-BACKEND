
"use strict";

const {
  pool,
  withTransaction,
} = require("../../config/db.config");

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function normalizeSchoolRole(role) {
  const value = role === "admin"
    ? "school_admin"
    : role;

  if (!["student", "lecturer", "school_admin"].includes(value)) {
    throw httpError("Vai trò thành viên không hợp lệ", 400);
  }

  return value;
}

// Lock school before modifying memberships.
// Other membership writers must follow this convention.
async function requireSchoolAdmin(client, schoolId, actorUserId) {
  const school = await client.query(
    `
    SELECT id
    FROM schools
    WHERE id = $1
      AND status = 'active'
    FOR UPDATE
    `,
    [schoolId]
  );

  if (!school.rowCount) {
    throw httpError(
      "Trường không hoạt động hoặc không tồn tại",
      403
    );
  }

  const actor = await client.query(
    `
    SELECT 1
    FROM school_memberships sm
    JOIN users u ON u.id = sm.user_id
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
      "Không có quyền quản trị trường",
      403
    );
  }
}

// Validate school-specific department and codes.
async function checkSchoolProfileFields(
  client,
  {
    schoolId,
    userId,
    studentCode,
    staffCode,
    departmentId,
  }
) {
  if (departmentId !== undefined && departmentId !== null) {
    const dept = await client.query(
      `
      SELECT 1
      FROM departments
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
      `,
      [departmentId, schoolId]
    );

    if (!dept.rowCount) {
      throw httpError(
        "Khoa không thuộc trường hiện tại",
        400
      );
    }
  }

  for (const [column, code, label] of [
    ["student_code", studentCode, "Mã sinh viên"],
    ["staff_code", staffCode, "Mã giảng viên/nhân viên"],
  ]) {
    if (code === undefined || code === null) continue;

    // column comes only from the fixed list above.
    const duplicate = await client.query(
      `
      SELECT 1
      FROM school_member_profiles
      WHERE school_id = $1
        AND ${column} = $2
        AND user_id <> $3
      LIMIT 1
      `,
      [schoolId, code, userId]
    );

    if (duplicate.rowCount) {
      throw httpError(
        `${label} đã tồn tại trong trường`,
        409
      );
    }
  }
}

// Return one school member, never a global user listing.
async function findSchoolMemberById({ schoolId, userId }) {
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.email,
      u.username,
      u.created_at,
      u.last_login_at,

      u.is_active AS account_is_active,

      (
        u.is_active = TRUE
        AND sm.status = 'active'
      ) AS is_active,

      CASE
        WHEN sm.role = 'school_admin' THEN 'admin'
        ELSE sm.role
      END AS role,

      sm.role AS school_role,
      sm.status AS membership_status,
      sm.school_id,

      p.full_name,
      p.avatar_url,

      mp.student_code,
      mp.staff_code,
      mp.department_id,

      d.code AS department_code,
      d.name AS department_name

    FROM school_memberships sm

    JOIN users u
      ON u.id = sm.user_id

    LEFT JOIN user_profiles p
      ON p.user_id = u.id

    LEFT JOIN school_member_profiles mp
      ON mp.school_id = sm.school_id
     AND mp.user_id = sm.user_id

    LEFT JOIN departments d
      ON d.id = mp.department_id
     AND d.school_id = sm.school_id

    WHERE sm.school_id = $1
      AND sm.user_id = $2

    LIMIT 1
    `,
    [schoolId, userId]
  );

  return rows[0] || null;
}

// =============================================
// CREATE USER OR ENROLL EXISTING ACCOUNT
// =============================================

async function createSchoolUser({
  schoolId,
  actorUserId,
  data,
  passwordHash,
}) {
  return withTransaction(async (client) => {
    await requireSchoolAdmin(
      client,
      schoolId,
      actorUserId
    );

    const role = normalizeSchoolRole(data.role);
    const email = data.email.trim().toLowerCase();

    const existing = await client.query(
      `
      SELECT id, is_active
      FROM users
      WHERE LOWER(email) = LOWER($1)
      ORDER BY created_at ASC
      LIMIT 2
      `,
      [email]
    );

    if (existing.rowCount > 1) {
      throw httpError(
        "Có nhiều tài khoản trùng email không phân biệt hoa/thường",
        409
      );
    }

    let userId;
    const linkedExistingUser = existing.rowCount === 1;

    if (linkedExistingUser) {
      // Reuse existing identity. NEVER reset password.
      const account = existing.rows[0];

      if (!account.is_active) {
        throw httpError(
          "Tài khoản toàn cục đang bị khóa",
          409
        );
      }

      userId = account.id;

      const membership = await client.query(
        `
        SELECT 1
        FROM school_memberships
        WHERE school_id = $1
          AND user_id = $2
        LIMIT 1
        `,
        [schoolId, userId]
      );

      if (membership.rowCount) {
        throw httpError(
          "Tài khoản đã là thành viên của trường",
          409
        );
      }

      const profile = await client.query(
        `
        SELECT 1
        FROM user_profiles
        WHERE user_id = $1
        LIMIT 1
        `,
        [userId]
      );

      if (!profile.rowCount) {
        throw httpError(
          "Tài khoản thiếu hồ sơ toàn cục; cần sửa dữ liệu",
          409
        );
      }
    } else {
      if (!passwordHash) {
        throw httpError(
          "Tài khoản mới phải có mật khẩu",
          400
        );
      }

      // Legacy role is intentionally non-privileged.
      const created = await client.query(
        `
        INSERT INTO users (
          email,
          username,
          password_hash,
          role
        )
        VALUES ($1, $2, $3, 'student')
        RETURNING id
        `,
        [
          email,
          data.username || null,
          passwordHash,
        ]
      );

      userId = created.rows[0].id;

      await client.query(
        `
        INSERT INTO user_profiles (
          user_id,
          full_name,
          student_code,
          department_id
        )
        VALUES ($1, $2, NULL, NULL)
        `,
        [userId, data.full_name]
      );
    }

    // All school-specific values are validated.
    await checkSchoolProfileFields(client, {
      schoolId,
      userId,
      studentCode: data.student_code ?? null,
      staffCode: data.staff_code ?? null,
      departmentId: data.department_id ?? null,
    });

    await client.query(
      `
      INSERT INTO school_memberships (
        school_id,
        user_id,
        role,
        status
      )
      VALUES ($1, $2, $3, 'active')
      `,
      [schoolId, userId, role]
    );

    await client.query(
      `
      INSERT INTO school_member_profiles (
        school_id,
        user_id,
        student_code,
        staff_code,
        department_id
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        schoolId,
        userId,
        data.student_code ?? null,
        data.staff_code ?? null,
        data.department_id ?? null,
      ]
    );

    return { userId, linkedExistingUser };
  });
}

// =============================================
// UPDATE SCHOOL MEMBERSHIP & SCHOOL PROFILE
// =============================================

async function updateSchoolUser({
  schoolId,
  actorUserId,
  targetUserId,
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
      SELECT
        sm.role,
        sm.status,
        u.email,
        p.full_name
      FROM school_memberships sm

      JOIN users u ON u.id = sm.user_id

      LEFT JOIN user_profiles p
        ON p.user_id = u.id

      WHERE sm.school_id = $1
        AND sm.user_id = $2

      FOR UPDATE OF sm
      `,
      [schoolId, targetUserId]
    );

    if (!rows.length) {
      throw httpError(
        "Thành viên không thuộc trường",
        404
      );
    }

    const target = rows[0];

    // Global identity fields are read-only for
    // a School Admin. Unchanged values are
    // tolerated for old frontend forms.
    if (
      data.email !== undefined &&
      data.email.trim().toLowerCase() !==
        target.email.toLowerCase()
    ) {
      throw httpError(
        "School Admin không được đổi email toàn cục",
        403
      );
    }

    if (
      data.full_name !== undefined &&
      data.full_name !== target.full_name
    ) {
      throw httpError(
        "School Admin không được đổi họ tên toàn cục",
        403
      );
    }

    // Change only the membership role.
    if (data.role !== undefined) {
      const role = normalizeSchoolRole(data.role);

      if (role !== target.role) {
        if (actorUserId === targetUserId) {
          throw httpError(
            "Không thể tự đổi vai trò School Admin",
            403
          );
        }

        if (
          target.role === "school_admin" &&
          target.status === "active"
        ) {
          const remaining = await client.query(
            `
            SELECT COUNT(*)::int AS total
            FROM school_memberships sm

            JOIN users u ON u.id = sm.user_id

            WHERE sm.school_id = $1
              AND sm.user_id <> $2
              AND sm.role = 'school_admin'
              AND sm.status = 'active'
              AND u.is_active = TRUE
            `,
            [schoolId, targetUserId]
          );

          if (remaining.rows[0].total === 0) {
            throw httpError(
              "Không thể hạ quyền School Admin cuối cùng",
              409
            );
          }
        }

        await client.query(
          `
          UPDATE school_memberships
          SET role = $3,
              updated_at = NOW()
          WHERE school_id = $1
            AND user_id = $2
          `,
          [schoolId, targetUserId, role]
        );
      }
    }

    await checkSchoolProfileFields(client, {
      schoolId,
      userId: targetUserId,
      studentCode: data.student_code,
      staffCode: data.staff_code,
      departmentId: data.department_id,
    });

    const fields = [];
    const values = [schoolId, targetUserId];

    for (const [column, value] of [
      ["student_code", data.student_code],
      ["staff_code", data.staff_code],
      ["department_id", data.department_id],
    ]) {
      if (value !== undefined) {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
      }
    }

    if (fields.length) {
      const updated = await client.query(
        `
        UPDATE school_member_profiles

        SET
          ${fields.join(", ")},
          updated_at = NOW()

        WHERE school_id = $1
          AND user_id = $2

        RETURNING user_id
        `,
        values
      );

      if (!updated.rowCount) {
        throw httpError(
          "Thiếu hồ sơ thành viên tại trường",
          409
        );
      }
    }

    return { userId: targetUserId };
  });
}

module.exports = {
  createSchoolUser,
  updateSchoolUser,
  findSchoolMemberById,
};