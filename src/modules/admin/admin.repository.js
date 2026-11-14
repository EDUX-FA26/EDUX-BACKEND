const bcrypt = require("bcryptjs");
const { pool, withTransaction } = require("../../config/db.config");

const AdminRepository = {
  /**
   * Tạo user mới (với role tùy chọn) sử dụng transaction
   * Đảm bảo insert đồng thời vào users và user_profiles (giống auth.repository.js)
   */
  async createUser(userData) {
    return await withTransaction(async (client) => {
      // 1. Insert vào bảng users
      const userQuery = `
        INSERT INTO users (email, username, password_hash, role)
        VALUES ($1, $2, $3, $4)
        RETURNING id, email, username, role, is_active, created_at, updated_at
      `;
      const userValues = [
        userData.email,
        userData.username || null,
        userData.password_hash,
        userData.role || "student",
      ];
      const userResult = await client.query(userQuery, userValues);
      const newUser = userResult.rows[0];

      // 2. Insert vào bảng user_profiles
      const profileQuery = `
        INSERT INTO user_profiles (user_id, full_name, student_code, department_id)
        VALUES ($1, $2, $3, $4)
        RETURNING avatar_url, full_name, student_code, department_id
      `;
      const profileValues = [
        newUser.id,
        userData.full_name,
        userData.student_code || null,
        userData.department_id || null,
      ];
      const profileResult = await client.query(profileQuery, profileValues);

      // 3. Kế thừa các thông báo hệ thống toàn trường đã phát (SRS 3.7.2 / 3.7.5)
      await client.query(
        `INSERT INTO notifications
           (user_id, title, message, type, related_entity_type, related_entity_id)
         SELECT $1, title, message, 'system_announcement', related_entity_type, related_entity_id
         FROM notifications
         WHERE type = 'system_announcement'
           AND (related_entity_type LIKE 'admin_broadcast:all' OR related_entity_type = 'admin_broadcast' OR related_entity_type IS NULL)
         GROUP BY title, message, related_entity_type, related_entity_id`,
        [newUser.id]
      );

      return {
        ...newUser,
        profile: profileResult.rows[0],
      };
    });
  },

  /**
   * Tìm user kèm theo thông tin profile và department
   * (Tương tự auth.repository.findUserByIdWithProfile)
   */
  async findUserByIdWithProfile(userId) {
    const query = `
      SELECT 
        u.id, u.email, u.username, u.role, u.is_active, u.last_login_at, u.created_at, u.updated_at,
        p.avatar_url, p.full_name, p.student_code,
        d.id AS department_id, d.code AS department_code, d.name AS department_name
      FROM users u
      LEFT JOIN user_profiles p ON u.id = p.user_id
      LEFT JOIN departments d ON p.department_id = d.id
      WHERE u.id = $1
    `;
    const result = await pool.query(query, [userId]);
    return result.rows[0] || null;
  },

  /**
   * Cập nhật user và profile sử dụng transaction
   */
  async updateUser(userId, updateData) {
    return await withTransaction(async (client) => {
      const { email, role, full_name, student_code, department_id } = updateData;

      // Update bảng users nếu có email hoặc role thay đổi
      if (email !== undefined || role !== undefined) {
        const userFields = [];
        const userValues = [];
        let userIndex = 1;

        if (email !== undefined) {
          userFields.push(`email = $${userIndex++}`);
          userValues.push(email);
        }
        if (role !== undefined) {
          userFields.push(`role = $${userIndex++}`);
          userValues.push(role);
        }

        if (userFields.length > 0) {
          userFields.push(`updated_at = NOW()`);
          userValues.push(userId);
          const userQuery = `
            UPDATE users
            SET ${userFields.join(", ")}
            WHERE id = $${userIndex}
          `;
          await client.query(userQuery, userValues);
        }
      }

      // Update bảng user_profiles nếu có thông tin profile thay đổi
      if (full_name !== undefined || student_code !== undefined || department_id !== undefined) {
        const profileFields = [];
        const profileValues = [];
        let profileIndex = 1;

        if (full_name !== undefined) {
          profileFields.push(`full_name = $${profileIndex++}`);
          profileValues.push(full_name);
        }
        if (student_code !== undefined) {
          profileFields.push(`student_code = $${profileIndex++}`);
          profileValues.push(student_code);
        }
        if (department_id !== undefined) {
          profileFields.push(`department_id = $${profileIndex++}`);
          profileValues.push(department_id);
        }

        if (profileFields.length > 0) {
          profileFields.push(`updated_at = NOW()`);
          profileValues.push(userId);
          const profileQuery = `
            UPDATE user_profiles
            SET ${profileFields.join(", ")}
            WHERE user_id = $${profileIndex}
          `;
          await client.query(profileQuery, profileValues);
        }
      }
    });
  },

  /**
   * Cập nhật trạng thái active (UC 88 Suspend / UC 89 Activate)
   */
  async updateUserStatus(userId, isActive) {
    const query = `
      UPDATE users
      SET is_active = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, is_active
    `;
    const result = await pool.query(query, [isActive, userId]);
    return result.rows[0];
  },

  /**
   * Lấy danh sách tất cả users kèm thông tin profile và department
   */

  async getAllUsers(schoolId) {
    const { rows } = await pool.query(
      `
    SELECT
      u.id,
      u.email,
      u.username,
      u.created_at,
      u.last_login_at,

      p.full_name,
      p.avatar_url,

      mp.student_code,
      mp.staff_code,
      mp.department_id,

      d.code AS department_code,
      d.name AS department_name,

      sm.school_id,
      sm.status AS membership_status,
      sm.role AS school_role,

      CASE
        WHEN sm.role = 'school_admin'
        THEN 'admin'
        ELSE sm.role
      END AS role,

      (
        COALESCE(u.is_active, FALSE)
        AND sm.status = 'active'
      ) AS is_active,

      u.is_active AS account_is_active

    FROM public.school_memberships sm

    JOIN public.users u
      ON u.id = sm.user_id

    LEFT JOIN public.user_profiles p
      ON p.user_id = u.id

    LEFT JOIN public.school_member_profiles mp
      ON mp.school_id = sm.school_id
     AND mp.user_id = sm.user_id

    LEFT JOIN public.departments d
      ON d.id = mp.department_id
     AND d.school_id = sm.school_id

    WHERE sm.school_id = $1

    ORDER BY
      p.full_name ASC NULLS LAST,
      u.email ASC
    `,
      [schoolId]
    );

    return rows;
  },


  /**
   * Lấy danh sách ID user theo target (phục vụ broadcast notification)
   */
  async findUserIdsByTarget(target) {
    let query = `SELECT id FROM users WHERE is_active = true`;
    const params = [];

    if (target === "student" || target === "lecturer") {
      query += ` AND role = $1`;
      params.push(target);
    }

    const result = await pool.query(query, params);
    return result.rows.map(row => row.id);
  },

  async findUserIdsBySchoolTarget(schoolId, target) {
    const values = [schoolId];
    const roleFilter = target === "student" || target === "lecturer"
      ? "AND sm.role = $2"
      : "";

    if (roleFilter) values.push(target);

    const { rows } = await pool.query(
      `
      SELECT DISTINCT sm.user_id AS id
      FROM public.school_memberships sm
      JOIN public.schools s
        ON s.id = sm.school_id
      JOIN public.users u
        ON u.id = sm.user_id
      WHERE sm.school_id = $1
        AND sm.status = 'active'
        AND s.status = 'active'
        AND u.is_active = TRUE
        ${roleFilter}
      ORDER BY sm.user_id
      `,
      values
    );

    return rows.map((row) => row.id);
  },

  async findEmailRecipientsBySchoolTarget(schoolId, target) {
    const params = [schoolId];

    const roleFilter =
      target === "student" || target === "lecturer"
        ? "AND sm.role = $2"
        : "";

    if (roleFilter) {
      params.push(target);
    }

    const { rows } = await pool.query(
      `
    SELECT DISTINCT
      u.id,
      u.email
    FROM public.school_memberships sm
    JOIN public.schools s
      ON s.id = sm.school_id
    JOIN public.users u
      ON u.id = sm.user_id
    WHERE sm.school_id = $1
      AND sm.status = 'active'
      AND s.status = 'active'
      AND u.is_active = TRUE
      AND u.email IS NOT NULL
      AND TRIM(u.email) <> ''
      ${roleFilter}
    ORDER BY u.id
    `,
      params
    );

    return rows;
  },

  async findUserIdsByPlatformTarget(target) {
    let query = `
      SELECT DISTINCT u.id
      FROM public.users u
      WHERE u.is_active = TRUE
    `;

    if (target === "student" || target === "lecturer") {
      query = `
        SELECT DISTINCT sm.user_id AS id
        FROM public.school_memberships sm
        JOIN public.schools s
          ON s.id = sm.school_id
        JOIN public.users u
          ON u.id = sm.user_id
        WHERE sm.role = $1
          AND sm.status = 'active'
          AND s.status = 'active'
          AND u.is_active = TRUE
        ORDER BY sm.user_id
      `;
      const { rows } = await pool.query(query, [target]);
      return rows.map((row) => row.id);
    }

    const { rows } = await pool.query(query);
    return rows.map((row) => row.id);
  },

  /**
   * Lấy danh sách các thông báo hệ thống đã gửi
   */
  async getSystemNotifications(schoolId) {
    const query = `
      SELECT title, message, type, notification_scope,
             school_id, MAX(created_at) as created_at
      FROM public.notifications
      WHERE type = 'system_announcement'
        AND notification_scope = 'school'
        AND school_id = $1
      GROUP BY title, message, type, notification_scope, school_id
      ORDER BY MAX(created_at) DESC
    `;
    const result = await pool.query(query, [schoolId]);
    return result.rows;
  },

  /**
   * Quản lý Khoa / Bộ môn (Departments)
   */
  async getAllDepartments() {
    const query = `
      SELECT
        d.id,
        d.code,
        d.name,
        d.is_active,
        d.created_at,
        d.updated_at,
        (SELECT COUNT(*)::int FROM subjects s WHERE s.department_id = d.id AND s.is_active = true) AS subject_count,
        (SELECT COUNT(*)::int FROM users u JOIN user_profiles up ON up.user_id = u.id WHERE up.department_id = d.id AND u.role = 'lecturer' AND u.is_active = true) AS lecturer_count,
        (SELECT COUNT(*)::int FROM users u JOIN user_profiles up ON up.user_id = u.id WHERE up.department_id = d.id AND u.role = 'student' AND u.is_active = true) AS student_count,
        (SELECT COUNT(*)::int FROM classes c JOIN subjects s ON s.id = c.subject_id WHERE s.department_id = d.id AND c.is_active = true) AS class_count
      FROM departments d
      ORDER BY d.code ASC, d.name ASC
    `;
    const result = await pool.query(query);
    return result.rows;
  },

  async createDepartment({ code, name, is_active = true }) {
    const normalizedCode = code.trim().toUpperCase();
    const result = await pool.query(
      `INSERT INTO departments (code, name, is_active)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [normalizedCode, name.trim(), is_active]
    );
    return result.rows[0];
  },

  async updateDepartment(id, data) {
    const fields = [];
    const values = [];
    if (data.code !== undefined) {
      values.push(data.code.trim().toUpperCase());
      fields.push(`code = $${values.length}`);
    }
    if (data.name !== undefined) {
      values.push(data.name.trim());
      fields.push(`name = $${values.length}`);
    }
    if (data.is_active !== undefined) {
      values.push(Boolean(data.is_active));
      fields.push(`is_active = $${values.length}`);
    }
    if (fields.length === 0) {
      const { rows } = await pool.query('SELECT * FROM departments WHERE id = $1', [id]);
      return rows[0];
    }
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE departments
       SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );
    return rows[0];
  },

  async deleteDepartment(id) {
    return await withTransaction(async (client) => {
      const existing = await client.query('SELECT * FROM departments WHERE id = $1', [id]);
      if (existing.rows.length === 0) return null;

      const refs = await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM subjects WHERE department_id = $1) AS subjects_count,
           (SELECT COUNT(*)::int FROM user_profiles WHERE department_id = $1) AS users_count`,
        [id]
      );
      const hasRefs = (refs.rows[0]?.subjects_count || 0) > 0 || (refs.rows[0]?.users_count || 0) > 0;

      if (hasRefs || existing.rows[0].is_active) {
        const updated = await client.query(
          'UPDATE departments SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *',
          [id]
        );
        return { ...updated.rows[0], action: 'deactivated' };
      }

      const deleted = await client.query('DELETE FROM departments WHERE id = $1 RETURNING *', [id]);
      return { ...deleted.rows[0], action: 'deleted' };
    });
  },

  /**
   * Helper: Phân tích chuỗi lịch học / ca slot và sinh danh sách các buổi học (sessions)
   * Hỗ trợ định dạng như:
   * - "T3 (09:30-11:45) • T5 (07:00-09:15)"
   * - "T2(07:00-09:15); T4(09:30-11:45)"
   * - "08/09/2026 09:30-11:45; 10/09/2026 07:00-09:15"
   * - Hoặc danh sách explicitSlots từ Sheet 2
   */
  buildClassSessionsSchedule({
    scheduleText = 'T3 (09:30-11:45) • T5 (07:00-09:15)',
    startDateStr = '2026-09-08',
    totalSlots = 20,
    explicitSlots = [],
  } = {}) {
    const count = Math.max(1, Math.min(60, Number(totalSlots) || 20));
    const rawSchedule = String(scheduleText || 'T3 (09:30-11:45) • T5 (07:00-09:15)').trim();

    // Parse startDateStr (DD/MM/YYYY hoặc YYYY-MM-DD)
    const parseDateInput = (str) => {
      if (!str) return null;
      if (str instanceof Date && !Number.isNaN(str.getTime())) return new Date(str);
      const s = String(str).trim();
      const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (dmy) {
        const [, d, m, y] = dmy;
        return new Date(Number(y), Number(m) - 1, Number(d), 9, 30, 0);
      }
      const ymd = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
      if (ymd) {
        const [, y, m, d] = ymd;
        return new Date(Number(y), Number(m) - 1, Number(d), 9, 30, 0);
      }
      const parsed = new Date(s);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const baseDate = parseDateInput(startDateStr) || new Date(2026, 8, 8, 9, 30, 0); // Mặc định 08/09/2026

    // Kiểm tra xem scheduleText có chứa danh sách ngày cụ thể "DD/MM/YYYY HH:mm-HH:mm" không
    const explicitMatches = [
      ...rawSchedule.matchAll(/(\d{1,2}[/-]\d{1,2}[/-]\d{4})\s*[,(-]*\s*(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})/g),
    ];

    // Trích xuất quy luật Thứ + Giờ trong tuần (VD: T3 (09:30-11:45), T5 (07:00-09:15))
    const dayMap = {
      t2: 1, mon: 1, monday: 1, 'thu 2': 1, 'thứ 2': 1,
      t3: 2, tue: 2, tuesday: 2, 'thu 3': 2, 'thứ 3': 2,
      t4: 3, wed: 3, wednesday: 3, 'thu 4': 3, 'thứ 4': 3,
      t5: 4, thu: 4, thursday: 4, 'thu 5': 4, 'thứ 5': 4,
      t6: 5, fri: 5, friday: 5, 'thu 6': 5, 'thứ 6': 5,
      t7: 6, sat: 6, saturday: 6, 'thu 7': 6, 'thứ 7': 6,
      cn: 0, sun: 0, sunday: 0,
    };

    const weeklyPattern = [];
    const segments = rawSchedule.split(/[;•|,]+/).map((s) => s.trim()).filter(Boolean);
    for (const seg of segments) {
      const timeMatch = seg.match(/(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})/);
      const timeRange = timeMatch ? timeMatch[1].replace(/\s+/g, '') : null;
      let matchedDow = null;
      const lowerSeg = seg.toLowerCase();
      for (const [key, dow] of Object.entries(dayMap)) {
        if (new RegExp(`(^|\\b)${key}(\\b|\\(|:|-|\\s|$)`, 'i').test(lowerSeg)) {
          matchedDow = dow;
          break;
        }
      }
      if (matchedDow !== null || timeRange) {
        weeklyPattern.push({
          dow: matchedDow,
          time: timeRange || (weeklyPattern.length % 2 === 0 ? '09:30-11:45' : '07:00-09:15'),
        });
      }
    }

    if (weeklyPattern.length === 0) {
      weeklyPattern.push(
        { dow: 2, time: '09:30-11:45' }, // Thứ 3: 09:30-11:45
        { dow: 4, time: '07:00-09:15' }  // Thứ 5: 07:00-09:15
      );
    } else if (weeklyPattern.length === 1) {
      const firstDow = weeklyPattern[0].dow ?? 2;
      weeklyPattern.push({
        dow: firstDow === 2 ? 4 : firstDow === 1 ? 3 : (firstDow + 2) % 7,
        time: weeklyPattern[0].time === '09:30-11:45' ? '07:00-09:15' : '09:30-11:45',
      });
    }

    // Chuẩn hóa dow cho từng phần tử trong weeklyPattern
    weeklyPattern.forEach((p, idx) => {
      if (p.dow === null || p.dow === undefined) {
        p.dow = idx % 2 === 0 ? 2 : 4;
      }
    });
    weeklyPattern.sort((a, b) => ((a.dow + 6) % 7) - ((b.dow + 6) % 7));

    // Tạo chuỗi ngày học theo lịch tuần bắt đầu từ baseDate
    const generatedDates = [];
    const cursor = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 9, 0, 0);
    let safety = 0;
    while (generatedDates.length < count && safety < 400) {
      const dow = cursor.getDay();
      const matched = weeklyPattern.find((p) => p.dow === dow);
      if (matched) {
        generatedDates.push({
          date: new Date(cursor),
          time: matched.time,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
      safety++;
    }

    const sessions = [];
    for (let i = 0; i < count; i++) {
      const slotNo = i + 1;
      const weekNo = Math.floor(i / weeklyPattern.length) + 1;
      const exp = explicitSlots.find((s) => Number(s.slot_number || s.session_no) === slotNo);

      let slotDate = generatedDates[i]?.date || new Date(baseDate.getTime() + i * 3 * 86400000);
      let slotTime = generatedDates[i]?.time || (i % 2 === 0 ? '09:30-11:45' : '07:00-09:15');

      if (exp) {
        const parsedExpDate = parseDateInput(exp.date);
        if (parsedExpDate) slotDate = parsedExpDate;
        if (exp.time) slotTime = String(exp.time).replace(/\s+/g, '');
      } else if (explicitMatches[i]) {
        const parsedMatchDate = parseDateInput(explicitMatches[i][1]);
        if (parsedMatchDate) slotDate = parsedMatchDate;
        slotTime = explicitMatches[i][2].replace(/\s+/g, '');
      }

      // Gắn giờ bắt đầu vào learning_date để hiển thị chính xác
      const startHourMatch = slotTime.match(/^(\d{1,2}):(\d{2})/);
      const learningDate = new Date(slotDate);
      if (startHourMatch) {
        learningDate.setHours(Number(startHourMatch[1]), Number(startHourMatch[2]), 0, 0);
      }

      const defaultTitle =
        slotNo === 1
          ? 'Orientation'
          : `Slot ${slotNo}: Lý thuyết & Thực hành Tuần ${weekNo}`;
      const defaultNote =
        slotNo === 1
          ? 'Week 1 Exercises — Giới thiệu đề cương môn học, quy định lớp học và bài tập tuần 1'
          : `Week ${weekNo} Exercises — Bài tập thực hành và thảo luận nhóm Slot ${slotNo}`;

      sessions.push({
        session_no: slotNo,
        learning_date: learningDate.toISOString(),
        slot_time: slotTime,
        title: exp?.title || defaultTitle,
        note: exp?.content || exp?.note || defaultNote,
      });
    }

    return {
      scheduleText: rawSchedule,
      sessions,
    };
  },

  async syncClassSessions(client, classId, options = {}) {
    const db = client || pool;
    const { scheduleText, sessions } = this.buildClassSessionsSchedule(options);

    await db.query(
      'UPDATE classes SET schedule_text = $1, updated_at = NOW() WHERE id = $2',
      [scheduleText, classId]
    );

    await db.query('DELETE FROM sessions WHERE class_id = $1', [classId]);

    for (const s of sessions) {
      await db.query(
        `INSERT INTO sessions (class_id, session_no, title, note, learning_date, slot_time, is_published)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [classId, s.session_no, s.title, s.note, s.learning_date, s.slot_time]
      );
    }

    return sessions;
  },

  async getClassSlots(classId) {
    const { rows } = await pool.query(
      `SELECT
         id,
         session_no AS slot_number,
         learning_date AS date,
         COALESCE(slot_time, '09:30-11:45') AS time,
         title,
         note AS content
       FROM sessions
       WHERE class_id = $1
       ORDER BY session_no ASC`,
      [classId]
    );
    return rows;
  },

  async updateClassSlots(classId, payload = {}) {
    return await withTransaction(async (client) => {
      const sessions = await this.syncClassSessions(client, classId, {
        scheduleText: payload.schedule_text || payload.scheduleText,
        startDateStr: payload.start_date || payload.startDate,
        totalSlots: payload.total_slots || payload.totalSlots || 20,
        explicitSlots: Array.isArray(payload.slots) ? payload.slots : [],
      });
      return sessions;
    });
  },

  async createClass(data) {
    return await withTransaction(async (client) => {
      const classCode = (data.class_code || data.classCode || '').trim().toUpperCase();
      const semesterId = data.semester_id || data.semesterId;
      const subjectId = data.subject_id || data.subjectId;
      const lecturerId = data.lecturer_id || data.lecturerId;
      const maxStudents = Number(data.max_students ?? data.maxStudents ?? 30);
      const scheduleText =
        (data.schedule_text || data.scheduleText || '').trim() ||
        'T3 (09:30-11:45) • T5 (07:00-09:15)';

      const { rows } = await client.query(
        `INSERT INTO classes (class_code, semester_id, subject_id, lecturer_id, max_students, schedule_text)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [classCode, semesterId, subjectId, lecturerId, maxStudents, scheduleText]
      );
      const created = rows[0];

      await this.syncClassSessions(client, created.id, {
        scheduleText,
        startDateStr: data.start_date || data.startDate || '2026-09-08',
        totalSlots: data.total_slots || data.totalSlots || 20,
      });

      return created;
    });
  },

  async updateClass(classId, data) {
    return await withTransaction(async (client) => {
      const fields = [];
      const values = [];

      const classCode = data.class_code ?? data.classCode;
      const semesterId = data.semester_id ?? data.semesterId;
      const subjectId = data.subject_id ?? data.subjectId;
      const lecturerId = data.lecturer_id ?? data.lecturerId;
      const maxStudents = data.max_students ?? data.maxStudents;
      const isActive = data.is_active ?? data.isActive;
      const scheduleText = data.schedule_text ?? data.scheduleText;

      if (classCode !== undefined && String(classCode).trim() !== '') {
        values.push(String(classCode).trim().toUpperCase());
        fields.push(`class_code = $${values.length}`);
      }
      if (semesterId !== undefined && semesterId !== '') {
        values.push(semesterId);
        fields.push(`semester_id = $${values.length}`);
      }
      if (subjectId !== undefined && subjectId !== '') {
        values.push(subjectId);
        fields.push(`subject_id = $${values.length}`);
      }
      if (lecturerId !== undefined && lecturerId !== '') {
        values.push(lecturerId);
        fields.push(`lecturer_id = $${values.length}`);
      }
      if (maxStudents !== undefined && maxStudents !== '') {
        values.push(Number(maxStudents));
        fields.push(`max_students = $${values.length}`);
      }
      if (isActive !== undefined) {
        values.push(Boolean(isActive));
        fields.push(`is_active = $${values.length}`);
      }
      if (scheduleText !== undefined && String(scheduleText).trim() !== '') {
        values.push(String(scheduleText).trim());
        fields.push(`schedule_text = $${values.length}`);
      }

      if (fields.length > 0) {
        values.push(classId);
        await client.query(
          `UPDATE classes SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
          values
        );
      }

      if (scheduleText || data.start_date || data.total_slots || data.regenerate_slots) {
        await this.syncClassSessions(client, classId, {
          scheduleText: scheduleText || 'T3 (09:30-11:45) • T5 (07:00-09:15)',
          startDateStr: data.start_date || data.startDate || '2026-09-08',
          totalSlots: data.total_slots || data.totalSlots || 20,
        });
      }

      return { success: true };
    });
  },

  async deleteClass(classId) {
    return await withTransaction(async (client) => {
      await client.query('DELETE FROM sessions WHERE class_id = $1', [classId]);
      await client.query('DELETE FROM class_members WHERE class_id = $1', [classId]);
      await client.query('DELETE FROM assignments WHERE class_id = $1', [classId]);
      await client.query('DELETE FROM class_materials WHERE class_id = $1', [classId]);
      await client.query('DELETE FROM flashcard_decks WHERE class_id = $1', [classId]);
      await client.query('DELETE FROM classes WHERE id = $1', [classId]);
      return { success: true };
    });
  },

  /**
   * Import dữ liệu Lớp học ĐÃ ĐƯỢC XẾP SẴN
   * Sinh viên/Giảng viên chưa có sẽ tự được add vào DB
   */
  async processPreAssignedClassesImport(records) {
    return await withTransaction(async (client) => {
      let importedUsers = 0;
      let importedClasses = 0;
      let importedMembers = 0;

      const defaultPasswordHash = await bcrypt.hash('Edux@123', 10);

      // Caches
      const deptCache = {};
      const semesterCache = {};
      const subjectCache = {};
      const userCache = {}; // email -> id
      const classCache = {}; // classCode -> id

      // Theo dõi thông tin lớp học tạo ra để báo cáo frontend
      const createdClassesMap = {}; // classCode -> { subjectCode, lecturerName, studentsCount }

      const getDeptId = async (code) => {
        if (!deptCache[code]) {
          let res = await client.query('SELECT id FROM departments WHERE code = $1', [code]);
          if (res.rows.length === 0) {
            res = await client.query('INSERT INTO departments (code, name) VALUES ($1, $2) RETURNING id', [code, `Khoa ${code}`]);
          }
          deptCache[code] = res.rows[0].id;
        }
        return deptCache[code];
      };

      const getSemesterId = async (code) => {
        if (!semesterCache[code]) {
          let res = await client.query('SELECT id FROM semesters WHERE code = $1', [code]);
          if (res.rows.length === 0) {
            res = await client.query('INSERT INTO semesters (code, name, academic_year, start_date, end_date) VALUES ($1, $2, $3, NOW(), NOW() + interval \'4 months\') RETURNING id', [code, `Học kỳ ${code}`, '2025-2026']);
          }
          semesterCache[code] = res.rows[0].id;
        }
        return semesterCache[code];
      };

      const getSubjectId = async (code, deptId) => {
        if (!subjectCache[code]) {
          let res = await client.query('SELECT id FROM subjects WHERE code = $1', [code]);
          if (res.rows.length === 0) {
            res = await client.query('INSERT INTO subjects (code, name, department_id) VALUES ($1, $2, $3) RETURNING id', [code, `Môn ${code}`, deptId]);
          }
          subjectCache[code] = res.rows[0].id;
        }
        return subjectCache[code];
      };

      const upsertUser = async (email, role, code, fullName, deptId) => {
        if (userCache[email]) return userCache[email];

        let res = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (res.rows.length > 0) {
          userCache[email] = res.rows[0].id;
          if (role === 'student' && code) {
            await client.query(
              `UPDATE user_profiles
               SET student_code = COALESCE(NULLIF(student_code, ''), $1),
                   full_name = COALESCE(NULLIF(full_name, ''), $2),
                   department_id = COALESCE(department_id, $3)
               WHERE user_id = $4`,
              [code, fullName, deptId, res.rows[0].id]
            );
          }
          return res.rows[0].id;
        }

        // Nếu là sinh viên, kiểm tra xem mã sinh viên đã tồn tại chưa (để tránh lỗi unique)
        if (role === 'student' && code) {
          const profileRes = await client.query('SELECT user_id FROM user_profiles WHERE student_code = $1', [code]);
          if (profileRes.rows.length > 0) {
            userCache[email] = profileRes.rows[0].user_id;
            return userCache[email];
          }
        }

        res = await client.query(
          'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
          [email, defaultPasswordHash, role]
        );
        const userId = res.rows[0].id;

        await client.query(
          'INSERT INTO user_profiles (user_id, full_name, student_code, department_id) VALUES ($1, $2, $3, $4)',
          [userId, fullName, role === 'student' ? code : null, deptId]
        );

        // Kế thừa các thông báo hệ thống toàn trường đã phát (SRS 3.7.2)
        await client.query(
          `INSERT INTO notifications
             (user_id, title, message, type, related_entity_type, related_entity_id)
           SELECT $1, title, message, 'system_announcement', related_entity_type, related_entity_id
           FROM notifications
           WHERE type = 'system_announcement'
             AND (related_entity_type LIKE 'admin_broadcast:all' OR related_entity_type = 'admin_broadcast' OR related_entity_type IS NULL)
           GROUP BY title, message, related_entity_type, related_entity_id`,
          [userId]
        );

        userCache[email] = userId;
        importedUsers++;
        return userId;
      };

      for (const record of records) {
        // 1. Upsert Department, Semester, Subject
        const deptId = await getDeptId(record.major);
        const semesterId = await getSemesterId(record.semester);
        const subjectId = await getSubjectId(record.subjectCode, deptId);

        // 2. Upsert Lecturer
        const lecturerId = await upsertUser(record.lecturerEmail, 'lecturer', record.lecturerCode, record.lecturerName, deptId);

        // 3. Upsert Student
        const studentId = await upsertUser(record.studentEmail, 'student', record.studentCode, record.studentName, deptId);

        // 4. Upsert Class & Sync Slots (20 sessions)
        if (!classCache[record.classCode]) {
          let cRes = await client.query('SELECT id FROM classes WHERE class_code = $1 AND semester_id = $2', [record.classCode, semesterId]);
          if (cRes.rows.length === 0) {
            cRes = await client.query('INSERT INTO classes (class_code, semester_id, subject_id, lecturer_id, max_students) VALUES ($1, $2, $3, $4, $5) RETURNING id', [record.classCode, semesterId, subjectId, lecturerId, 30]);
            importedClasses++;
          } else {
            // Cập nhật lại GV và Subject nếu cần
            await client.query('UPDATE classes SET subject_id = $1, lecturer_id = $2 WHERE id = $3', [subjectId, lecturerId, cRes.rows[0].id]);
          }
          classCache[record.classCode] = cRes.rows[0].id;

          const scheduleText =
            record.slotSchedule || 'T3 (09:30-11:45) • T5 (07:00-09:15)';
          const startDateStr = record.startDate || '08/09/2026';
          const totalSlots = Number(record.totalSlots) || 20;
          const explicitClassSlots = Array.isArray(record.explicitSlots)
            ? record.explicitSlots
            : [];

          const generatedSessions = await this.syncClassSessions(
            client,
            classCache[record.classCode],
            {
              scheduleText,
              startDateStr,
              totalSlots,
              explicitSlots: explicitClassSlots,
            }
          );

          createdClassesMap[record.classCode] = {
            subjectCode: record.subjectCode,
            lecturerName: record.lecturerName,
            studentsCount: 0,
            scheduleText,
            slotsCount: generatedSessions.length,
          };
        }
        const classId = classCache[record.classCode];

        // 5. Upsert Class Member
        const cmRes = await client.query('SELECT id FROM class_members WHERE class_id = $1 AND student_id = $2', [classId, studentId]);
        if (cmRes.rows.length === 0) {
          await client.query('INSERT INTO class_members (class_id, student_id) VALUES ($1, $2)', [classId, studentId]);
          importedMembers++;
          createdClassesMap[record.classCode].studentsCount++;
        }
      }

      const createdClassesInfo = Object.keys(createdClassesMap).map(classCode => ({
        classCode,
        ...createdClassesMap[classCode]
      }));

      return { importedUsers, importedClasses, importedMembers, createdClassesInfo };
    });
  },

  /**
   * Thuật toán tự động xếp lớp: Gom 30 sinh viên -> 1 Lớp, phân công GV theo Khoa & tự động chia Slot học (20 sessions)
   */
  async processAutoAssignExcelImport(students, lecturers) {
    return await withTransaction(async (client) => {
      let importedUsers = 0;
      let importedClasses = 0;
      let importedMembers = 0;
      const createdClassesInfo = [];

      const defaultPasswordHash = await bcrypt.hash('Edux@123', 10);

      const deptCache = {};
      const semesterCache = {};
      const subjectCache = {};
      const userCache = {}; // email -> id

      const upsertDept = async (code) => {
        if (!code) return null;
        if (deptCache[code]) return deptCache[code];
        let res = await client.query('SELECT id FROM departments WHERE code = $1', [code]);
        if (res.rows.length === 0) {
          res = await client.query('INSERT INTO departments (code, name) VALUES ($1, $2) RETURNING id', [code, code]);
        }
        deptCache[code] = res.rows[0].id;
        return deptCache[code];
      };

      const upsertUser = async (email, role, code, fullName, deptId) => {
        if (userCache[email]) return userCache[email];

        let res = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (res.rows.length > 0) {
          userCache[email] = res.rows[0].id;
          if (role === 'student' && code) {
            await client.query(
              `UPDATE user_profiles
               SET student_code = COALESCE(NULLIF(student_code, ''), $1),
                   full_name = COALESCE(NULLIF(full_name, ''), $2),
                   department_id = COALESCE(department_id, $3)
               WHERE user_id = $4`,
              [code, fullName, deptId, res.rows[0].id]
            );
          }
          return userCache[email];
        }

        // Nếu là sinh viên, kiểm tra xem mã sinh viên đã tồn tại chưa (để tránh lỗi unique)
        if (role === 'student' && code) {
          const profileRes = await client.query('SELECT user_id FROM user_profiles WHERE student_code = $1', [code]);
          if (profileRes.rows.length > 0) {
            userCache[email] = profileRes.rows[0].user_id;
            return userCache[email];
          }
        }

        const uRes = await client.query(
          'INSERT INTO users (email, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
          [email, email.split('@')[0], defaultPasswordHash, role]
        );
        const userId = uRes.rows[0].id;

        await client.query(
          'INSERT INTO user_profiles (user_id, full_name, student_code, department_id) VALUES ($1, $2, $3, $4)',
          [userId, fullName, role === 'student' ? code : null, deptId]
        );

        // Kế thừa các thông báo hệ thống toàn trường đã phát (SRS 3.7.2)
        await client.query(
          `INSERT INTO notifications
             (user_id, title, message, type, related_entity_type, related_entity_id)
           SELECT $1, title, message, 'system_announcement', related_entity_type, related_entity_id
           FROM notifications
           WHERE type = 'system_announcement'
             AND (related_entity_type LIKE 'admin_broadcast:all' OR related_entity_type = 'admin_broadcast' OR related_entity_type IS NULL)
           GROUP BY title, message, related_entity_type, related_entity_id`,
          [userId]
        );

        userCache[email] = userId;
        importedUsers++;
        return userId;
      };

      // 1. Lưu Giảng viên
      const deptLecturers = {}; // deptId -> [lecturerId]
      for (const lec of lecturers) {
        if (!lec.lecturerCode || !lec.departmentCode) continue;
        const deptId = await upsertDept(lec.departmentCode);
        const email = `${lec.lecturerCode.toLowerCase()}@fe.edu.vn`;
        const id = await upsertUser(email, 'lecturer', lec.lecturerCode, lec.fullName || lec.lecturerCode, deptId);

        if (deptId) {
          if (!deptLecturers[deptId]) deptLecturers[deptId] = [];
          if (!deptLecturers[deptId].includes(id)) deptLecturers[deptId].push(id);
        }
      }

      // Lấy thêm danh sách GV hiện có trong DB (để fallback)
      if (lecturers.length === 0 || true) {
        const existingLecs = await client.query(`
            SELECT u.id, p.department_id 
            FROM users u JOIN user_profiles p ON u.id = p.user_id 
            WHERE u.role = 'lecturer' AND p.department_id IS NOT NULL
         `);
        existingLecs.rows.forEach(r => {
          if (!deptLecturers[r.department_id]) deptLecturers[r.department_id] = [];
          if (!deptLecturers[r.department_id].includes(r.id)) deptLecturers[r.department_id].push(r.id);
        });
      }

      // 2. Lưu Sinh viên & Gom nhóm
      const studentGroups = {}; // deptCode_semesterCode_subjectCode -> [{ id, slotSchedule, startDate, totalSlots }]
      for (const stu of students) {
        if (!stu.studentCode || !stu.departmentCode || !stu.semesterCode) continue;
        const deptId = await upsertDept(stu.departmentCode);
        const email = `${stu.studentCode.toLowerCase()}@fpt.edu.vn`;
        const id = await upsertUser(email, 'student', stu.studentCode, stu.fullName || stu.studentCode, deptId);

        const subCode = stu.subjectCode || `${stu.departmentCode}101`;
        const groupKey = `${stu.departmentCode}_${stu.semesterCode}_${subCode}`;
        if (!studentGroups[groupKey]) studentGroups[groupKey] = [];
        studentGroups[groupKey].push({
          id,
          slotSchedule: stu.slotSchedule,
          startDate: stu.startDate,
          totalSlots: stu.totalSlots,
        });
      }

      const defaultSlotTemplates = [
        'T3 (09:30-11:45) • T5 (07:00-09:15)',
        'T2 (07:00-09:15) • T4 (09:30-11:45)',
        'T3 (12:30-14:45) • T5 (15:00-17:15)',
        'T4 (12:30-14:45) • T6 (09:30-11:45)',
      ];

      // 3. Tự động xếp lớp
      const MAX_STUDENTS = 30;
      for (const groupKey of Object.keys(studentGroups)) {
        const [deptCode, semesterCode, subjectCode] = groupKey.split('_');
        const deptId = await upsertDept(deptCode);
        const stus = studentGroups[groupKey];

        // Semester
        if (!semesterCache[semesterCode]) {
          let sRes = await client.query('SELECT id FROM semesters WHERE code = $1', [semesterCode]);
          if (sRes.rows.length === 0) {
            sRes = await client.query('INSERT INTO semesters (code, name, academic_year, start_date, end_date) VALUES ($1, $2, $3, NOW(), NOW() + interval \'4 months\') RETURNING id', [semesterCode, semesterCode, '2025-2026']);
          }
          semesterCache[semesterCode] = sRes.rows[0].id;
        }
        const semesterId = semesterCache[semesterCode];

        // Môn học (đã lấy từ excel hoặc mặc định)
        if (!subjectCache[subjectCode]) {
          let subRes = await client.query('SELECT id FROM subjects WHERE code = $1', [subjectCode]);
          if (subRes.rows.length === 0) {
            subRes = await client.query('INSERT INTO subjects (code, name, department_id) VALUES ($1, $2, $3) RETURNING id', [subjectCode, `Môn ${subjectCode}`, deptId]);
          }
          subjectCache[subjectCode] = subRes.rows[0].id;
        }
        const subjectId = subjectCache[subjectCode];

        const availableLecs = deptLecturers[deptId] || [];

        // Chia chunk (30 sv/lớp)
        for (let i = 0; i < stus.length; i += MAX_STUDENTS) {
          const chunk = stus.slice(i, i + MAX_STUDENTS);
          const classSeq = Math.floor(i / MAX_STUDENTS) + 1;
          const classCode = `${deptCode}${semesterCode}-${classSeq.toString().padStart(2, '0')}`; // VD: SEFALL2025-01

          // Assign Lecturer (Round Robin)
          let lecturerId = null;
          if (availableLecs.length > 0) {
            lecturerId = availableLecs[classSeq % availableLecs.length];
          } else {
            const dummyEmail = `dummy_${deptCode}@fe.edu.vn`;
            lecturerId = await upsertUser(dummyEmail, 'lecturer', `DUMMY_${deptCode}`, `GV Tạm ${deptCode}`, deptId);
            availableLecs.push(lecturerId);
            deptLecturers[deptId] = availableLecs;
          }

          // Create class
          let cRes = await client.query('SELECT id FROM classes WHERE class_code = $1 AND semester_id = $2 AND subject_id = $3', [classCode, semesterId, subjectId]);
          let classId;
          if (cRes.rows.length === 0) {
            cRes = await client.query('INSERT INTO classes (class_code, semester_id, subject_id, lecturer_id, max_students) VALUES ($1, $2, $3, $4, $5) RETURNING id', [classCode, semesterId, subjectId, lecturerId, MAX_STUDENTS]);
            importedClasses++;
          }
          classId = cRes.rows[0].id;

          const customSchedule = chunk.find((item) => item.slotSchedule)?.slotSchedule;
          const customStartDate = chunk.find((item) => item.startDate)?.startDate;
          const customTotalSlots = chunk.find((item) => item.totalSlots)?.totalSlots;

          const scheduleText =
            customSchedule ||
            defaultSlotTemplates[(classSeq - 1) % defaultSlotTemplates.length];

          const generatedSessions = await this.syncClassSessions(client, classId, {
            scheduleText,
            startDateStr: customStartDate || '08/09/2026',
            totalSlots: Number(customTotalSlots) || 20,
          });

          // Lấy tên giảng viên
          const lecRes = await client.query('SELECT full_name FROM user_profiles WHERE user_id = $1', [lecturerId]);
          const lecName = lecRes.rows.length > 0 ? lecRes.rows[0].full_name : 'N/A';

          // Add members
          for (const stuObj of chunk) {
            const sId = stuObj.id;
            const cmRes = await client.query('SELECT id FROM class_members WHERE class_id = $1 AND student_id = $2', [classId, sId]);
            if (cmRes.rows.length === 0) {
              await client.query('INSERT INTO class_members (class_id, student_id) VALUES ($1, $2)', [classId, sId]);
              importedMembers++;
            }
          }

          createdClassesInfo.push({
            classCode: classCode,
            subjectCode: subjectCode,
            lecturerName: lecName,
            studentsCount: chunk.length,
            scheduleText,
            slotsCount: generatedSessions.length,
          });
        }
      }

      return { importedUsers, importedClasses, importedMembers, createdClassesInfo };
    });

  },

  /**
   * Lấy danh sách toàn bộ lớp học (cho Admin)
   */
  async getAllClasses() {
    const query = `
      SELECT 
        c.id, 
        c.class_code, 
        c.semester_id,
        c.subject_id,
        c.lecturer_id,
        c.max_students,
        c.is_active,
        COALESCE(c.schedule_text, 'T3 (09:30-11:45) • T5 (07:00-09:15)') AS schedule_text,
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
        (SELECT COUNT(*)::int FROM class_members cm WHERE cm.class_id = c.id AND (cm.status IS NULL OR cm.status = 'active')) AS enrolled_students,
        (SELECT COUNT(*)::int FROM sessions ses WHERE ses.class_id = c.id) AS slot_count
      FROM classes c
      LEFT JOIN semesters s ON c.semester_id = s.id
      LEFT JOIN subjects sub ON c.subject_id = sub.id
      LEFT JOIN departments d ON sub.department_id = d.id
      LEFT JOIN users u ON c.lecturer_id = u.id
      LEFT JOIN user_profiles up ON u.id = up.user_id
      ORDER BY c.created_at DESC
    `;
    const result = await pool.query(query);
    return result.rows;
  },

  /**
   * Lấy danh sách sinh viên của một lớp học
   */
  async getClassStudents(classId) {
    const query = `
      SELECT 
        u.id, 
        u.email, 
        up.full_name, 
        up.student_code, 
        up.avatar_url,
        up.department_id,
        d.code AS department_code,
        d.name AS department_name,
        cm.status
      FROM class_members cm
      JOIN users u ON cm.student_id = u.id
      JOIN user_profiles up ON u.id = up.user_id
      LEFT JOIN departments d ON up.department_id = d.id
      WHERE cm.class_id = $1 AND (cm.status IS NULL OR cm.status = 'active')
      ORDER BY up.full_name ASC
    `;
    const result = await pool.query(query, [classId]);
    return result.rows;
  },

  async getLecturers() {
    const result = await pool.query(`
      SELECT u.id, u.email, up.full_name, up.department_id, d.code AS department_code, d.name AS department_name
      FROM users u
      LEFT JOIN user_profiles up ON up.user_id = u.id
      LEFT JOIN departments d ON up.department_id = d.id
      WHERE u.role = 'lecturer' AND u.is_active = TRUE
      ORDER BY up.full_name NULLS LAST, u.email
    `);
    return result.rows;
  },

  async addClassStudent(classId, { student_id, identifier }) {
    return await withTransaction(async (client) => {
      const classRes = await client.query('SELECT id, max_students FROM classes WHERE id = $1 FOR UPDATE', [classId]);
      if (classRes.rows.length === 0) {
        const err = new Error('Không tìm thấy lớp học');
        err.status = 404;
        throw err;
      }

      const maxStudents = Number(classRes.rows[0].max_students || 0);
      if (maxStudents > 0) {
        const countRes = await client.query(
          "SELECT COUNT(*)::int AS cnt FROM class_members WHERE class_id = $1 AND (status IS NULL OR status = 'active')",
          [classId]
        );
        if (countRes.rows[0].cnt >= maxStudents) {
          const err = new Error(`Lớp học đã đạt sĩ số tối đa (${maxStudents} sinh viên)`);
          err.status = 409;
          throw err;
        }
      }

      let studentQuery;
      let studentParam;
      if (student_id) {
        studentQuery = `
          SELECT u.id, u.email, up.full_name, up.student_code, up.avatar_url
          FROM users u
          LEFT JOIN user_profiles up ON up.user_id = u.id
          WHERE u.id = $1 AND u.role = 'student'
        `;
        studentParam = student_id;
      } else {
        studentQuery = `
          SELECT u.id, u.email, up.full_name, up.student_code, up.avatar_url
          FROM users u
          LEFT JOIN user_profiles up ON up.user_id = u.id
          WHERE u.role = 'student'
            AND (LOWER(u.email) = LOWER($1) OR LOWER(COALESCE(up.student_code, '')) = LOWER($1))
          LIMIT 1
        `;
        studentParam = identifier.trim();
      }

      const studentRes = await client.query(studentQuery, [studentParam]);
      if (studentRes.rows.length === 0) {
        const err = new Error('Không tìm thấy sinh viên phù hợp');
        err.status = 404;
        throw err;
      }

      const student = studentRes.rows[0];
      const existingMember = await client.query(
        'SELECT id, status FROM class_members WHERE class_id = $1 AND student_id = $2',
        [classId, student.id]
      );

      if (existingMember.rows.length > 0) {
        const currentStatus = existingMember.rows[0].status;
        if (!currentStatus || currentStatus === 'active') {
          const err = new Error('Sinh viên đã có trong lớp học này');
          err.status = 409;
          throw err;
        }
        await client.query(
          "UPDATE class_members SET status = 'active', updated_at = NOW() WHERE id = $1",
          [existingMember.rows[0].id]
        );
      } else {
        await client.query(
          "INSERT INTO class_members (class_id, student_id, status) VALUES ($1, $2, 'active')",
          [classId, student.id]
        );
      }

      return student;
    });
  },

  async removeClassStudent(classId, studentId) {
    const result = await pool.query(
      'DELETE FROM class_members WHERE class_id = $1 AND student_id = $2 RETURNING id',
      [classId, studentId]
    );
    return result.rowCount > 0;
  },

  async processUserListImport(records) {
    return await withTransaction(async (client) => {
      const results = [];
      const credentials = [];
      let importedUsers = 0;
      const defaultPasswordHash = await bcrypt.hash('Edux@123', 10);

      for (const record of records) {
        await client.query("SAVEPOINT admin_user_import");
        try {
          const userResult = await client.query(
            `INSERT INTO users (email, username, password_hash, role)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (email) DO NOTHING
             RETURNING id`,
            [record.email, record.username || record.email.split('@')[0], defaultPasswordHash, record.role || 'student']
          );

          if (userResult.rowCount === 0) {
            await client.query("ROLLBACK TO SAVEPOINT admin_user_import");
            results.push({ row: record.rowNumber, email: record.email, status: "skipped", reason: "Email đã tồn tại" });
            await client.query("RELEASE SAVEPOINT admin_user_import");
            continue;
          }

          const userId = userResult.rows[0].id;

          const profileResult = await client.query(
            `INSERT INTO user_profiles (user_id, full_name, student_code, department_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (student_code) DO NOTHING
             RETURNING user_id`,
            [userId, record.full_name, record.student_code || null, record.department_id || null]
          );

          if (profileResult.rowCount === 0) {
            await client.query("ROLLBACK TO SAVEPOINT admin_user_import");
            results.push({ row: record.rowNumber, email: record.email, status: "skipped", reason: "Mã sinh viên đã tồn tại" });
            await client.query("RELEASE SAVEPOINT admin_user_import");
            continue;
          }

          // Kế thừa thông báo phát thanh toàn trường
          await client.query(
            `INSERT INTO notifications
               (user_id, title, message, type, related_entity_type)
             SELECT $1, title, message, 'system_announcement', 'admin_broadcast:all'
             FROM notifications
             WHERE type = 'system_announcement'
             GROUP BY title, message`,
            [userId]
          );

          await client.query("RELEASE SAVEPOINT admin_user_import");
          importedUsers++;
          credentials.push({ email: record.email, role: record.role || 'student', password: 'Edux@123' });
          results.push({
            row: record.rowNumber,
            email: record.email,
            status: "created"
          });
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT admin_user_import");
          await client.query("RELEASE SAVEPOINT admin_user_import");
          results.push({ row: record.rowNumber, email: record.email, status: "skipped", reason: error.message });
        }
      }

      return { importedUsers, skippedUsers: results.length - importedUsers, results, credentials };
    });
  },


  async setSchoolMemberStatus({
    schoolId,
    actorUserId,
    targetUserId,
    status,
  }) {
    if (!["active", "suspended"].includes(status)) {
      throw Object.assign(
        new Error("Trạng thái không hợp lệ"),
        { status: 400 }
      );
    }

    if (
      actorUserId === targetUserId &&
      status === "suspended"
    ) {
      throw Object.assign(
        new Error("Không thể tự tạm ngưng chính mình"),
        { status: 403 }
      );
    }

    return withTransaction(async (client) => {
      // Serialize membership status changes
      // within the same school.
      const schoolResult = await client.query(
        `
      SELECT id
      FROM public.schools
      WHERE id = $1
      FOR UPDATE
      `,
        [schoolId]
      );

      if (schoolResult.rowCount === 0) {
        throw Object.assign(
          new Error("Không tìm thấy trường"),
          { status: 404 }
        );
      }

      // Recheck actor permission inside transaction.
      const actorResult = await client.query(
        `
      SELECT sm.user_id
      FROM public.school_memberships sm
      JOIN public.users u
        ON u.id = sm.user_id
      JOIN public.schools s
        ON s.id = sm.school_id
      WHERE sm.school_id = $1
        AND sm.user_id = $2
        AND sm.role = 'school_admin'
        AND sm.status = 'active'
        AND u.is_active = TRUE
        AND s.status = 'active'
      LIMIT 1
      `,
        [schoolId, actorUserId]
      );

      if (actorResult.rowCount === 0) {
        throw Object.assign(
          new Error("Không đủ quyền quản trị trường"),
          { status: 403 }
        );
      }

      const targetResult = await client.query(
        `
      SELECT
        sm.user_id,
        sm.role,
        sm.status,
        u.is_active AS account_is_active

      FROM public.school_memberships sm

      JOIN public.users u
        ON u.id = sm.user_id

      WHERE sm.school_id = $1
        AND sm.user_id = $2

      FOR UPDATE OF sm
      `,
        [schoolId, targetUserId]
      );

      if (targetResult.rowCount === 0) {
        throw Object.assign(
          new Error("Thành viên không thuộc trường"),
          { status: 404 }
        );
      }

      const target = targetResult.rows[0];

      // School Admin cannot globally unlock an account.
      if (
        status === "active" &&
        !target.account_is_active
      ) {
        throw Object.assign(
          new Error(
            "Tài khoản toàn hệ thống đang bị khóa"
          ),
          { status: 409 }
        );
      }

      // Protect the last active School Admin.
      if (
        status === "suspended" &&
        target.role === "school_admin" &&
        target.status === "active"
      ) {
        const adminCount = await client.query(
          `
        SELECT COUNT(*)::int AS total
        FROM public.school_memberships sm
        JOIN public.users u
          ON u.id = sm.user_id
        WHERE sm.school_id = $1
          AND sm.user_id <> $2
          AND sm.role = 'school_admin'
          AND sm.status = 'active'
          AND u.is_active = TRUE
        `,
          [schoolId, targetUserId]
        );

        if (adminCount.rows[0].total === 0) {
          throw Object.assign(
            new Error(
              "Không thể tạm ngưng quản trị viên cuối cùng"
            ),
            { status: 409 }
          );
        }
      }

      const { rows } = await client.query(
        `
      UPDATE public.school_memberships
      SET status = $3,
          updated_at = NOW()
      WHERE school_id = $1
        AND user_id = $2
      RETURNING
        school_id,
        user_id,
        role,
        status
      `,
        [schoolId, targetUserId, status]
      );

      return rows[0];
    });
  },

};

module.exports = AdminRepository;
