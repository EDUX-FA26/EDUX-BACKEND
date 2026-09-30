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
  async getAllUsers() {
    const query = `
      SELECT 
        u.id, u.email, u.username, u.role, u.is_active, u.last_login_at, u.created_at,
        p.avatar_url, p.full_name, p.student_code,
        d.id AS department_id, d.name AS department_name
      FROM users u
      LEFT JOIN user_profiles p ON u.id = p.user_id
      LEFT JOIN departments d ON p.department_id = d.id
      ORDER BY u.created_at DESC
    `;
    const result = await pool.query(query);
    return result.rows;
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

  /**
   * Lấy danh sách các thông báo hệ thống đã gửi
   */
  async getSystemNotifications() {
    const query = `
      SELECT title, message, type, MAX(created_at) as created_at
      FROM notifications
      WHERE type = 'system_announcement'
      GROUP BY title, message, type
      ORDER BY MAX(created_at) DESC
    `;
    const result = await pool.query(query);
    return result.rows;
  },

  async updateClass(classId, data) {
    const { classCode, subjectCode, lecturerName } = data;
    return await withTransaction(async (client) => {
      // Basic update: just updating class code for now
      // If we need to update subject or lecturer, we'd look them up by code/name, but for simplicity, allow updating class code.
      if (classCode) {
        await client.query(
          'UPDATE classes SET class_code = $1 WHERE id = $2',
          [classCode, classId]
        );
      }
      return { success: true };
    });
  },

  async deleteClass(classId) {
    return await withTransaction(async (client) => {
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

        // 4. Upsert Class
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
          createdClassesMap[record.classCode] = {
            subjectCode: record.subjectCode,
            lecturerName: record.lecturerName,
            studentsCount: 0
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
   * Thuật toán tự động xếp lớp: Gom 30 sinh viên -> 1 Lớp, random GV
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
      const studentGroups = {}; // deptCode_semesterCode_subjectCode -> [studentId]
      for (const stu of students) {
        if (!stu.studentCode || !stu.departmentCode || !stu.semesterCode) continue;
        const deptId = await upsertDept(stu.departmentCode);
        const email = `${stu.studentCode.toLowerCase()}@fpt.edu.vn`;
        const id = await upsertUser(email, 'student', stu.studentCode, stu.fullName || stu.studentCode, deptId);

        const subCode = stu.subjectCode || `${stu.departmentCode}101`; // Môn mặc định nếu ko truyền
        const groupKey = `${stu.departmentCode}_${stu.semesterCode}_${subCode}`;
        if (!studentGroups[groupKey]) studentGroups[groupKey] = [];
        studentGroups[groupKey].push(id);
      }

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

          // Lấy tên giảng viên
          const lecRes = await client.query('SELECT full_name FROM user_profiles WHERE user_id = $1', [lecturerId]);
          const lecName = lecRes.rows.length > 0 ? lecRes.rows[0].full_name : 'N/A';

          // Add members
          for (const sId of chunk) {
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
            studentsCount: chunk.length
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
        c.max_students,
        c.created_at,
        s.code AS semester_code, 
        s.name AS semester_name,
        sub.code AS subject_code,
        sub.name AS subject_name,
        up.full_name AS lecturer_name,
        u.email AS lecturer_email,
        (SELECT COUNT(*) FROM class_members cm WHERE cm.class_id = c.id) AS enrolled_students
      FROM classes c
      LEFT JOIN semesters s ON c.semester_id = s.id
      LEFT JOIN subjects sub ON c.subject_id = sub.id
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
        up.avatar_url
      FROM class_members cm
      JOIN users u ON cm.student_id = u.id
      JOIN user_profiles up ON u.id = up.user_id
      WHERE cm.class_id = $1
      ORDER BY up.full_name ASC
    `;
    const result = await pool.query(query, [classId]);
    return result.rows;
  }
};

module.exports = AdminRepository;
