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

      // 3. Tạo Admin user
      let adminQuery = `SELECT id FROM users WHERE email = 'admin@art-ai.edu.vn'`;
      let adminResult = await client.query(adminQuery);
      if (adminResult.rowCount === 0) {
        const insertAdmin = `
          INSERT INTO users (email, username, password_hash, role)
          VALUES ('admin@art-ai.edu.vn', 'admin', $1, 'admin')
          RETURNING id
        `;
        const newAdmin = await client.query(insertAdmin, [adminPass]);
        const adminId = newAdmin.rows[0].id;

        const insertAdminProfile = `
          INSERT INTO user_profiles (user_id, full_name)
          VALUES ($1, 'Super Admin')
        `;
        await client.query(insertAdminProfile, [adminId]);
        console.log("✅ Đã tạo tài khoản Admin mặc định.");
      } else {
        console.log("⚡ Tài khoản Admin đã tồn tại. Bỏ qua.");
      }

      // 4. Tạo Lecturer user
      let lecturerQuery = `SELECT id FROM users WHERE email = 'lecturer@art-ai.edu.vn'`;
      let lecturerResult = await client.query(lecturerQuery);
      if (lecturerResult.rowCount === 0) {
        const insertLecturer = `
          INSERT INTO users (email, username, password_hash, role)
          VALUES ('lecturer@art-ai.edu.vn', 'lecturer1', $1, 'lecturer')
          RETURNING id
        `;
        const newLecturer = await client.query(insertLecturer, [lecturerPass]);
        const lecturerId = newLecturer.rows[0].id;

        const insertLecturerProfile = `
          INSERT INTO user_profiles (user_id, full_name, department_id)
          VALUES ($1, 'Lecturer Mẫu', $2)
        `;
        await client.query(insertLecturerProfile, [lecturerId, seDeptId]);
        console.log("✅ Đã tạo tài khoản Lecturer mẫu.");
      } else {
        console.log("⚡ Tài khoản Lecturer đã tồn tại. Bỏ qua.");
      }

      // 5. Tạo Student user
      let studentQuery = `SELECT id FROM users WHERE email = 'student@art-ai.edu.vn'`;
      let studentResult = await client.query(studentQuery);
      if (studentResult.rowCount === 0) {
        const studentPass = await bcrypt.hash("Student@123456", 10);
        const insertStudent = `
          INSERT INTO users (email, username, password_hash, role)
          VALUES ('student@art-ai.edu.vn', 'student1', $1, 'student')
          RETURNING id
        `;
        const newStudent = await client.query(insertStudent, [studentPass]);
        const studentId = newStudent.rows[0].id;

        const insertStudentProfile = `
          INSERT INTO user_profiles (user_id, full_name, department_id, student_code)
          VALUES ($1, 'Student Mẫu', $2, 'SE123456')
        `;
        await client.query(insertStudentProfile, [studentId, seDeptId]);
        console.log("✅ Đã tạo tài khoản Student mẫu.");
      } else {
        console.log("⚡ Tài khoản Student đã tồn tại. Bỏ qua.");
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
