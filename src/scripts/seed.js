require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const bcrypt = require("bcryptjs");
const { pool, withTransaction } = require("../config/db.config");

async function runSeed() {
  console.log("🌱 Bắt đầu chạy Database Seeder...");

  try {
    await withTransaction(async (client) => {
      // 0. Tạo cấu trúc Database (DDL) nếu chưa tồn tại
      console.log("🛠 Đang kiểm tra và tạo Schema PostgreSQL (nếu chưa có)...");
      await client.query(`
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

        CREATE TABLE IF NOT EXISTS departments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code VARCHAR(100) UNIQUE NOT NULL,
            name VARCHAR(255) NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE NOT NULL,
            username VARCHAR(255) UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL CHECK (role IN ('student', 'lecturer', 'admin')),
            is_active BOOLEAN DEFAULT TRUE,
            last_login_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS user_profiles (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            avatar_url TEXT DEFAULT '',
            full_name VARCHAR(255) NOT NULL,
            student_code VARCHAR(100) UNIQUE,
            department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS semesters (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code VARCHAR(100) UNIQUE NOT NULL,
            name VARCHAR(255) NOT NULL,
            academic_year VARCHAR(100) NOT NULL,
            start_date TIMESTAMP WITH TIME ZONE NOT NULL,
            end_date TIMESTAMP WITH TIME ZONE NOT NULL,
            is_current BOOLEAN DEFAULT FALSE,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS subjects (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code VARCHAR(100) UNIQUE NOT NULL,
            name VARCHAR(255) NOT NULL,
            description TEXT DEFAULT '',
            department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
            credits INT DEFAULT 0 CHECK (credits >= 0),
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS classes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            class_code VARCHAR(100) NOT NULL,
            semester_id UUID NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
            subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
            lecturer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            max_students INT DEFAULT 0 CHECK (max_students >= 0),
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uk_class_code_semester_subject UNIQUE (class_code, semester_id, subject_id)
        );

        CREATE TABLE IF NOT EXISTS class_members (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
            student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'dropped', 'completed')),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uk_class_student UNIQUE (class_id, student_id)
        );
        DROP TABLE IF EXISTS assignment_materials CASCADE;
        DROP TABLE IF EXISTS assignments CASCADE;

        CREATE TABLE IF NOT EXISTS assignments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            uuid VARCHAR(255) UNIQUE,
            class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
            session_id UUID,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            instructions TEXT,
            deadline TIMESTAMP WITH TIME ZONE NOT NULL,
            max_score DECIMAL(5,2) DEFAULT 10,
            weight DECIMAL(5,2) DEFAULT 0,
            ai_declaration_required BOOLEAN DEFAULT TRUE,
            min_ai_interactions INT DEFAULT 1,
            max_ai_interactions INT DEFAULT 20,
            allow_late_submission BOOLEAN DEFAULT TRUE,
            publish_status VARCHAR(50) DEFAULT 'draft' CHECK (publish_status IN ('draft', 'published', 'closed')),
            published_at TIMESTAMP WITH TIME ZONE,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS assignment_materials (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
            file_key TEXT NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            file_size INT DEFAULT 0,
            file_type VARCHAR(100),
            description TEXT,
            uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log("✅ Database schema đã sẵn sàng.");

      // 1. Tạo Department mẫu: Khoa SE
      const deptQuery = `
        INSERT INTO departments (code, name)
        VALUES ('SE', 'Software Engineering')
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `;
      const deptResult = await client.query(deptQuery);
      const seDeptId = deptResult.rows[0].id;
      console.log("✅ Đã xử lý Khoa SE (Software Engineering).");

      // 2. Hash passwords
      const adminPass = await bcrypt.hash("Admin@123456", 10);
      const lecturerPass = await bcrypt.hash("Lecturer@123456", 10);
      const studentPass = await bcrypt.hash("Student@123456", 10);

      // 3. Tạo Admin user
      let adminId;
      let adminQuery = `SELECT id FROM users WHERE email = 'admin@art-ai.edu.vn'`;
      let adminResult = await client.query(adminQuery);
      if (adminResult.rowCount === 0) {
        const insertAdmin = `
          INSERT INTO users (email, username, password_hash, role)
          VALUES ('admin@art-ai.edu.vn', 'admin', $1, 'admin')
          RETURNING id
        `;
        const newAdmin = await client.query(insertAdmin, [adminPass]);
        adminId = newAdmin.rows[0].id;

        const insertAdminProfile = `
          INSERT INTO user_profiles (user_id, full_name)
          VALUES ($1, 'Super Admin')
        `;
        await client.query(insertAdminProfile, [adminId]);
        console.log("✅ Đã tạo tài khoản Admin mặc định.");
      } else {
        adminId = adminResult.rows[0].id;
        const updateAdmin = `
          UPDATE users 
          SET password_hash = $1, role = 'admin' 
          WHERE id = $2
        `;
        await client.query(updateAdmin, [adminPass, adminId]);
        console.log("⚡ Tài khoản Admin đã tồn tại. Đã cập nhật mật khẩu.");
      }

      // 4. Tạo Lecturer user (lecturer1@art-ai.edu.vn)
      let lecturerId;
      let lecturerQuery = `SELECT id FROM users WHERE email = 'lecturer1@art-ai.edu.vn'`;
      let lecturerResult = await client.query(lecturerQuery);
      if (lecturerResult.rowCount === 0) {
        const insertLecturer = `
          INSERT INTO users (email, username, password_hash, role)
          VALUES ('lecturer1@art-ai.edu.vn', 'lecturer_1', $1, 'lecturer')
          RETURNING id
        `;
        const newLecturer = await client.query(insertLecturer, [lecturerPass]);
        lecturerId = newLecturer.rows[0].id;

        const insertLecturerProfile = `
          INSERT INTO user_profiles (user_id, full_name, department_id)
          VALUES ($1, 'Lecturer 1', $2)
        `;
        await client.query(insertLecturerProfile, [lecturerId, seDeptId]);
        console.log("✅ Đã tạo tài khoản Lecturer 1.");
      } else {
        lecturerId = lecturerResult.rows[0].id;
        const updateLecturer = `
          UPDATE users 
          SET password_hash = $1 
          WHERE id = $2
        `;
        await client.query(updateLecturer, [lecturerPass, lecturerId]);
        console.log("⚡ Tài khoản Lecturer 1 đã tồn tại. Đã cập nhật mật khẩu.");
      }

      // 5. Tạo 2 Student users
      let student1Id;
      let s1Query = `SELECT id FROM users WHERE email = 'student1@art-ai.edu.vn'`;
      let s1Result = await client.query(s1Query);
      if (s1Result.rowCount === 0) {
        const insertStudent = `
          INSERT INTO users (email, username, password_hash, role)
          VALUES ('student1@art-ai.edu.vn', 'student_1', $1, 'student')
          RETURNING id
        `;
        const newS1 = await client.query(insertStudent, [studentPass]);
        student1Id = newS1.rows[0].id;

        const insertProfile = `
          INSERT INTO user_profiles (user_id, full_name, department_id, student_code)
          VALUES ($1, 'Nguyen Van An', $2, 'SE180001')
        `;
        await client.query(insertProfile, [student1Id, seDeptId]);
        console.log("✅ Đã tạo tài khoản Student 1.");
      } else {
        student1Id = s1Result.rows[0].id;
        const updateStudent = `
          UPDATE users 
          SET password_hash = $1 
          WHERE id = $2
        `;
        await client.query(updateStudent, [studentPass, student1Id]);
        console.log("⚡ Tài khoản Student 1 đã tồn tại. Đã cập nhật mật khẩu.");
      }

      let student2Id;
      let s2Query = `SELECT id FROM users WHERE email = 'student2@art-ai.edu.vn'`;
      let s2Result = await client.query(s2Query);
      if (s2Result.rowCount === 0) {
        const insertStudent = `
          INSERT INTO users (email, username, password_hash, role)
          VALUES ('student2@art-ai.edu.vn', 'student_2', $1, 'student')
          RETURNING id
        `;
        const newS2 = await client.query(insertStudent, [studentPass]);
        student2Id = newS2.rows[0].id;

        const insertProfile = `
          INSERT INTO user_profiles (user_id, full_name, department_id, student_code)
          VALUES ($1, 'Tran Thi Binh', $2, 'SE180002')
        `;
        await client.query(insertProfile, [student2Id, seDeptId]);
        console.log("✅ Đã tạo tài khoản Student 2.");
      } else {
        student2Id = s2Result.rows[0].id;
        const updateStudent = `
          UPDATE users 
          SET password_hash = $1 
          WHERE id = $2
        `;
        await client.query(updateStudent, [studentPass, student2Id]);
        console.log("⚡ Tài khoản Student 2 đã tồn tại. Đã cập nhật mật khẩu.");
      }

      // 6. Tạo Semester
      const semesterQuery = `
        INSERT INTO semesters (code, name, academic_year, start_date, end_date, is_current)
        VALUES ('FA26', 'Fall 2026', '2026-2027', '2026-09-01', '2026-12-31', TRUE)
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `;
      const semResult = await client.query(semesterQuery);
      const semesterId = semResult.rows[0].id;
      console.log("✅ Đã xử lý Semester FA26.");

      // 7. Tạo Subjects
      const prnQuery = `
        INSERT INTO subjects (code, name, department_id, credits)
        VALUES ('PRN231', 'Building Cross-Platform Web Applications', $1, 3)
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `;
      const prnResult = await client.query(prnQuery, [seDeptId]);
      const prnSubjectId = prnResult.rows[0].id;

      const swpQuery = `
        INSERT INTO subjects (code, name, department_id, credits)
        VALUES ('SWP391', 'Software Development Project', $1, 3)
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `;
      const swpResult = await client.query(swpQuery, [seDeptId]);
      console.log("✅ Đã xử lý Subjects (PRN231, SWP391).");

      // 8. Tạo Class mẫu (SE1801)
      const classQuery = `
        INSERT INTO classes (class_code, semester_id, subject_id, lecturer_id, max_students)
        VALUES ('SE1801', $1, $2, $3, 30)
        ON CONFLICT (class_code, semester_id, subject_id) DO UPDATE SET max_students = EXCLUDED.max_students
        RETURNING id
      `;
      const classResult = await client.query(classQuery, [semesterId, prnSubjectId, lecturerId]);
      const classId = classResult.rows[0].id;
      console.log("✅ Đã xử lý Class SE1801.");

      // 9. Assign Student 1 to Class
      const memberQuery = `
        INSERT INTO class_members (class_id, student_id, status)
        VALUES ($1, $2, 'active')
        ON CONFLICT (class_id, student_id) DO UPDATE SET status = 'active'
      `;
      await client.query(memberQuery, [classId, student1Id]);
      console.log("✅ Đã gán Student 1 vào lớp SE1801.");

      // 10. Seed Assignments cho lớp SE1801
      const crypto = require("crypto");
      
      const checkAssign1 = await client.query(`SELECT id FROM assignments WHERE class_id = $1 AND title = 'Assignment 1 - Draft Specs'`, [classId]);
      if (checkAssign1.rowCount === 0) {
        const assign1Query = `
          INSERT INTO assignments (uuid, class_id, title, description, deadline, max_score, weight, publish_status, created_by)
          VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days', 10, 10, 'draft', $5)
        `;
        await client.query(assign1Query, [crypto.randomUUID(), classId, 'Assignment 1 - Draft Specs', 'This is a draft assignment', lecturerId]);
        console.log("✅ Đã tạo Assignment 1 - Draft Specs.");
      }

      const checkAssign2 = await client.query(`SELECT id FROM assignments WHERE class_id = $1 AND title = 'Assignment 2 - Final Capstone'`, [classId]);
      if (checkAssign2.rowCount === 0) {
        const assign2Query = `
          INSERT INTO assignments (
            uuid, class_id, title, description, deadline, max_score, weight, 
            ai_declaration_required, min_ai_interactions, max_ai_interactions, 
            publish_status, published_at, created_by
          ) VALUES (
            $1, $2, $3, $4, NOW() + INTERVAL '14 days', 10, 30, 
            TRUE, 2, 10, 
            'published', NOW(), $5
          )
        `;
        await client.query(assign2Query, [crypto.randomUUID(), classId, 'Assignment 2 - Final Capstone', 'Capstone project with AI requirements', lecturerId]);
        console.log("✅ Đã tạo Assignment 2 - Final Capstone.");
      }
    });

    console.log("🎉 Seed dữ liệu thành công!");
  } catch (error) {
    console.error("❌ Lỗi khi seed dữ liệu:", error);
  } finally {
    pool.end();
  }
}

runSeed();
