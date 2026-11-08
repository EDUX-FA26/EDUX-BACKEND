const bcrypt = require("bcryptjs");
const ExcelJS = require("exceljs");
const adminRepository = require("./admin.repository");
const authRepository = require("../auth/auth.repository");
const notificationsRepository = require("../notifications/notifications.repository");
const { getIO } = require("../../config/socket.config");
const {
  emitCreatedNotifications,
} = require('../notifications/notifications.realtime');
const AdminService = {
  /**
   * UC 86 — Tạo user mới với role tùy chọn (admin, lecturer, student)
   */
  async createUser(data) {
    // 1. Kiểm tra trùng lặp email, username, student_code
    const duplicates = await authRepository.checkDuplication(
      data.email,
      data.username || null,
      data.student_code || null
    );
    if (duplicates && duplicates.length > 0) {
      const error = new Error(`Conflict: ${duplicates.join(", ")} đã tồn tại`);
      error.status = 409;
      throw error;
    }

    // 2. Hash password
    const password_hash = await bcrypt.hash(data.password, 10);

    const userData = {
      ...data,
      password_hash,
    };

    // 3. Tạo user (transaction: insert users + user_profiles)
    const newUser = await adminRepository.createUser(userData);

    // 4. Fetch lại full profile để trả về
    return await adminRepository.findUserByIdWithProfile(newUser.id);
  },

  /**
   * UC 87 — Cập nhật thông tin user
   */
  async updateUser(userId, data) {
    // Kiểm tra user tồn tại
    const existingUser = await adminRepository.findUserByIdWithProfile(userId);
    if (!existingUser) {
      const error = new Error("Không tìm thấy người dùng");
      error.status = 404;
      throw error;
    }

    // Nếu đổi email, kiểm tra trùng lặp
    if (data.email && data.email !== existingUser.email) {
      const duplicates = await authRepository.checkDuplication(data.email, null, null);
      if (duplicates && duplicates.includes("email")) {
        const error = new Error("Email đã được sử dụng");
        error.status = 409;
        throw error;
      }
    }

    // Nếu đổi student_code, kiểm tra trùng lặp
    if (data.student_code && data.student_code !== existingUser.student_code) {
      const duplicates = await authRepository.checkDuplication(null, null, data.student_code);
      if (duplicates && duplicates.includes("student_code")) {
        const error = new Error("Mã số sinh viên đã được sử dụng");
        error.status = 409;
        throw error;
      }
    }

    await adminRepository.updateUser(userId, data);

    // Trả về profile đã cập nhật
    return await adminRepository.findUserByIdWithProfile(userId);
  },

  /**
   * UC 88 — Tạm khóa tài khoản người dùng
   */
  async suspendUser(userId) {
    const existingUser = await adminRepository.findUserByIdWithProfile(userId);
    if (!existingUser) {
      const error = new Error("Không tìm thấy người dùng");
      error.status = 404;
      throw error;
    }

    await adminRepository.updateUserStatus(userId, false);
    return { success: true };
  },

  /**
   * UC 89 — Kích hoạt lại tài khoản người dùng
   */
  async activateUser(userId) {
    const existingUser = await adminRepository.findUserByIdWithProfile(userId);
    if (!existingUser) {
      const error = new Error("Không tìm thấy người dùng");
      error.status = 404;
      throw error;
    }

    await adminRepository.updateUserStatus(userId, true);
    return { success: true };
  },

  /**
   * Lấy danh sách tất cả users (phục vụ giao diện quản lý)
   */
  async getAllUsers() {
    return await adminRepository.getAllUsers();
  },

  /**
   * UC 90 — Broadcast Notification
   */

  async broadcastNotification(data) {
    const { title, message, target } = data;

    // 1. Lấy danh sách người nhận
    const userIds =
      await adminRepository.findUserIdsByTarget(target);

    if (userIds.length === 0) {
      return {
        success: true,
        count: 0,
      };
    }

    // 2. Chuẩn bị notifications
    const notifications = userIds.map(userId => ({
      userId,
      title,
      message,
      type: "system_announcement",
      related_entity_type: "admin_broadcast",
      related_entity_id: null,
    }));

    // 3. Lưu notification vào PostgreSQL
    const createdNotifications =
      await notificationsRepository.bulkCreate(notifications);

    // 4. Phát sự kiện realtime
    // Không làm thất bại API nếu socket gặp lỗi
    try {
      emitCreatedNotifications(createdNotifications);
    } catch (error) {
      console.error(
        "[ADMIN BROADCAST REALTIME]",
        error.message
      );
    }

    // 5. Trả kết quả
    return {
      success: true,
      count: createdNotifications.length,
    };
  },


  /**
   * Lấy danh sách các thông báo hệ thống đã gửi
   */
  async getSystemNotifications() {
    return await adminRepository.getSystemNotifications();
  },

  /**
   * Import dữ liệu Lớp học ĐÃ ĐƯỢC XẾP SẴN
   * (Gồm sinh viên, môn học, kỳ học, ngành, giảng viên)
   */
  async importExcelData(fileBuffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw Object.assign(new Error("File Excel không hợp lệ"), { status: 400 });
    }

    const records = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) { // Bỏ qua dòng tiêu đề
        // Cấu trúc dự kiến (10 cột):
        // 1: Mã Sinh Viên
        // 2: Tên Sinh Viên
        // 3: Email Sinh Viên
        // 4: Mã Ngành (Major)
        // 5: Kỳ Học (Term/Semester)
        // 6: Mã Lớp (Class Code)
        // 7: Mã Môn Học (Subject Code)
        // 8: Mã Giảng Viên
        // 9: Tên Giảng Viên
        // 10: Email Giảng Viên

        const studentCode = row.getCell(1).value?.toString().trim();
        const studentName = row.getCell(2).value?.toString().trim();
        const studentEmail = row.getCell(3).value?.toString().trim();
        const major = row.getCell(4).value?.toString().trim();
        const semester = row.getCell(5).value?.toString().trim();
        const classCode = row.getCell(6).value?.toString().trim();
        const subjectCode = row.getCell(7).value?.toString().trim();
        const lecturerCode = row.getCell(8).value?.toString().trim();
        const lecturerName = row.getCell(9).value?.toString().trim();
        const lecturerEmail = row.getCell(10).value?.toString().trim();

        if (studentCode && classCode && subjectCode) {
          records.push({
            studentCode,
            studentName: studentName || studentCode,
            studentEmail: studentEmail || `${studentCode.toLowerCase()}@fpt.edu.vn`,
            major: major || 'N/A',
            semester: semester || 'UNKNOWN',
            classCode,
            subjectCode,
            lecturerCode: lecturerCode || 'CHUA_XEP',
            lecturerName: lecturerName || lecturerCode || 'Chưa phân công',
            lecturerEmail: lecturerEmail || (lecturerCode ? `${lecturerCode.toLowerCase()}@fe.edu.vn` : 'dummy@fe.edu.vn')
          });
        }
      }
    });

    if (records.length === 0) {
      throw Object.assign(new Error("Sheet không có dữ liệu lớp học/sinh viên hợp lệ"), { status: 400 });
    }

    // Gọi repo để lưu dữ liệu đã xếp sẵn này
    return await adminRepository.processPreAssignedClassesImport(records);
  },

  /**
   * Import dữ liệu tự động chia lớp (30 SV/lớp + phân công GV theo Khoa)
   */
  async importAutoAssignExcelData(fileBuffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw Object.assign(new Error("File Excel không hợp lệ"), { status: 400 });
    }

    const students = [];
    const lecturers = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        // Hỗ trợ cả file 5 cột (MSSV, Họ tên, Mã khoa, Kỳ học, Mã môn)
        // hoặc 10 cột (MSSV, Họ tên, Email, Mã khoa, Kỳ học, Mã lớp, Mã môn, Mã GV, Tên GV, Email GV)
        const c1 = row.getCell(1).value?.toString().trim();
        const c2 = row.getCell(2).value?.toString().trim();
        const c3 = row.getCell(3).value?.toString().trim();
        const c4 = row.getCell(4).value?.toString().trim();
        const c5 = row.getCell(5).value?.toString().trim();
        const c7 = row.getCell(7).value?.toString().trim();
        const c8 = row.getCell(8).value?.toString().trim();
        const c9 = row.getCell(9).value?.toString().trim();

        const isTenCol = Boolean(c3 && c3.includes('@'));
        const studentCode = c1;
        const fullName = c2 || c1;
        const departmentCode = isTenCol ? (c4 || 'SE') : (c3 || 'SE');
        const semesterCode = isTenCol ? (c5 || 'FALL2025') : (c4 || 'FALL2025');
        const subjectCode = isTenCol ? (c7 || `${departmentCode}101`) : (c5 || `${departmentCode}101`);

        if (studentCode && departmentCode && semesterCode) {
          students.push({
            studentCode,
            fullName,
            departmentCode: departmentCode.toUpperCase(),
            semesterCode: semesterCode.toUpperCase(),
            subjectCode: subjectCode.toUpperCase(),
          });
        }

        if (isTenCol && c8) {
          lecturers.push({
            lecturerCode: c8,
            fullName: c9 || c8,
            departmentCode: (c4 || 'SE').toUpperCase(),
          });
        }
      }
    });

    const lecturerSheet = workbook.worksheets[1];
    if (lecturerSheet) {
      lecturerSheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          const lecturerCode = row.getCell(1).value?.toString().trim();
          const fullName = row.getCell(2).value?.toString().trim();
          const departmentCode = row.getCell(3).value?.toString().trim();
          if (lecturerCode && departmentCode) {
            lecturers.push({
              lecturerCode,
              fullName: fullName || lecturerCode,
              departmentCode: departmentCode.toUpperCase(),
            });
          }
        }
      });
    }

    if (students.length === 0) {
      throw Object.assign(new Error("Sheet không có dữ liệu sinh viên hợp lệ để tự động xếp lớp"), { status: 400 });
    }

    return await adminRepository.processAutoAssignExcelImport(students, lecturers);
  },

  /**
   * Quản lý Khoa / Bộ môn (Departments)
   */
  async getAllDepartments() {
    return await adminRepository.getAllDepartments();
  },

  async createDepartment(data) {
    try {
      return await adminRepository.createDepartment(data);
    } catch (error) {
      if (error.code === "23505") {
        throw Object.assign(new Error("Mã khoa đã tồn tại"), { status: 409 });
      }
      throw error;
    }
  },

  async updateDepartment(id, data) {
    try {
      const updated = await adminRepository.updateDepartment(id, data);
      if (!updated) {
        throw Object.assign(new Error("Không tìm thấy khoa"), { status: 404 });
      }
      return updated;
    } catch (error) {
      if (error.code === "23505") {
        throw Object.assign(new Error("Mã khoa đã tồn tại"), { status: 409 });
      }
      throw error;
    }
  },

  async deleteDepartment(id) {
    const result = await adminRepository.deleteDepartment(id);
    if (!result) {
      throw Object.assign(new Error("Không tìm thấy khoa"), { status: 404 });
    }
    return result;
  },

  async createClass(data) {
    try {
      return await adminRepository.createClass(data);
    } catch (error) {
      if (error.code === "23505") {
        throw Object.assign(new Error("Mã lớp đã tồn tại trong học kỳ và môn học này"), { status: 409 });
      }
      if (error.code === "23503") {
        throw Object.assign(new Error("Học kỳ, môn học hoặc giảng viên không tồn tại"), { status: 400 });
      }
      throw error;
    }
  },

  async updateClass(id, data) {
    try {
      return await adminRepository.updateClass(id, data);
    } catch (error) {
      if (error.code === "23505") {
        throw Object.assign(new Error("Mã lớp đã tồn tại trong học kỳ và môn học này"), { status: 409 });
      }
      if (error.code === "23503") {
        throw Object.assign(new Error("Học kỳ, môn học hoặc giảng viên không hợp lệ"), { status: 400 });
      }
      throw error;
    }
  },

  async deleteClass(id) {
    return await adminRepository.deleteClass(id);
  },

  /**
   * Lấy danh sách lớp học
   */
  async getAllClasses() {
    return await adminRepository.getAllClasses();
  },

  async getClassStudents(classId) {
    return await adminRepository.getClassStudents(classId);
  },

  async addClassStudent(classId, payload) {
    return await adminRepository.addClassStudent(classId, payload);
  },

  async getLecturers() {
    return await adminRepository.getLecturers();
  },

  async removeClassStudent(classId, studentId) {
    const removed = await adminRepository.removeClassStudent(classId, studentId);
    if (!removed) {
      const error = new Error("Không tìm thấy sinh viên trong lớp");
      error.status = 404;
      throw error;
    }
    return { success: true };
  },

  async importUsersData(fileBuffer, filename) {
    const workbook = new ExcelJS.Workbook();
    const isZip = fileBuffer.length > 2 && fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4B;
    if (isZip) {
      await workbook.xlsx.load(fileBuffer);
    } else {
      const { Readable } = require("stream");
      await workbook.csv.read(Readable.from([fileBuffer.toString("utf8")]));
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw Object.assign(new Error("File không có worksheet dữ liệu"), { status: 400 });
    }

    const records = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        const fullName = row.getCell(1).value?.toString().trim();
        const email = row.getCell(2).value?.toString().trim();
        const role = row.getCell(3).value?.toString().trim()?.toLowerCase() || 'student';
        const studentCode = row.getCell(4).value?.toString().trim();

        if (fullName && email && email.includes('@')) {
          records.push({
            rowNumber,
            full_name: fullName,
            email,
            role: ['student', 'lecturer', 'admin'].includes(role) ? role : 'student',
            student_code: studentCode || null
          });
        }
      }
    });

    if (records.length === 0) {
      throw Object.assign(new Error("Sheet không có dữ liệu người dùng hợp lệ"), { status: 400 });
    }

    return await adminRepository.processUserListImport(records);
  },
};

module.exports = AdminService;
