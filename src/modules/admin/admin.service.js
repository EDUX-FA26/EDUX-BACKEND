const bcrypt = require("bcryptjs");
const ExcelJS = require("exceljs");
const adminRepository = require("./admin.repository");
const authRepository = require("../auth/auth.repository");
const EmailService = require("../../config/email.config");
const notificationsRepository = require("../notifications/notifications.repository");
const { getIO } = require("../../config/socket.config");
const {
  emitCreatedNotifications,
} = require('../notifications/notifications.realtime');
const schoolUsersRepository = require(
  "./admin.school-users.repository"
);
const schoolDepartmentsRepository = require(
  "./admin.school-departments.repository"
);
const schoolAcademicReadRepository = require(
  "./admin.school-academic-read.repository"
);
const schoolClassesRepository = require(
  "./admin.school-classes.repository"
);
const AdminService = {

  // 007D-3B — Create user / enroll existing identity
  async createUser(data, tenant) {
    const passwordHash = data.password
      ? await bcrypt.hash(data.password, 12)
      : null;

    try {
      const result =
        await schoolUsersRepository.createSchoolUser({
          schoolId: tenant.schoolId,
          actorUserId: tenant.userId,
          data,
          passwordHash,
        });

      const user =
        await schoolUsersRepository.findSchoolMemberById({
          schoolId: tenant.schoolId,
          userId: result.userId,
        });

      return {
        ...user,
        linked_existing_user: result.linkedExistingUser,
      };
    } catch (error) {
      if (error.code === "23505") {
        throw Object.assign(
          new Error(
            "Email, username hoặc mã thành viên đã tồn tại"
          ),
          { status: 409 }
        );
      }

      if (error.code === "23503") {
        throw Object.assign(
          new Error("Dữ liệu liên kết không hợp lệ"),
          { status: 400 }
        );
      }

      throw error;
    }
  },

  // 007D-3B — Update membership and school profile
  async updateUser(userId, data, tenant) {
    try {
      await schoolUsersRepository.updateSchoolUser({
        schoolId: tenant.schoolId,
        actorUserId: tenant.userId,
        targetUserId: userId,
        data,
      });

      return schoolUsersRepository.findSchoolMemberById({
        schoolId: tenant.schoolId,
        userId,
      });
    } catch (error) {
      if (error.code === "23505") {
        throw Object.assign(
          new Error("Mã thành viên đã tồn tại trong trường"),
          { status: 409 }
        );
      }

      if (error.code === "23503") {
        throw Object.assign(
          new Error("Khoa hoặc dữ liệu liên kết không hợp lệ"),
          { status: 400 }
        );
      }

      throw error;
    }
  },

  // ============================================
  // SCHOOL-SCOPED USER LIST
  // ============================================

  async getAllUsers(schoolId) {
    return adminRepository.getAllUsers(schoolId);
  },

  // ============================================
  // SCHOOL MEMBERSHIP SUSPENSION
  // ============================================

  async suspendUser({
    schoolId,
    actorUserId,
    targetUserId,
  }) {
    return adminRepository.setSchoolMemberStatus({
      schoolId,
      actorUserId,
      targetUserId,
      status: "suspended",
    });
  },

  // ============================================
  // SCHOOL MEMBERSHIP ACTIVATION
  // ============================================

  async activateUser({
    schoolId,
    actorUserId,
    targetUserId,
  }) {
    return adminRepository.setSchoolMemberStatus({
      schoolId,
      actorUserId,
      targetUserId,
      status: "active",
    });
  },


  /**
   * UC 90 — Broadcast Notification
   */

  async broadcastNotification(data, tenant) {
    if (
      tenant?.role !== "school_admin" ||
      !tenant.schoolId ||
      !tenant.userId
    ) {
      throw Object.assign(
        new Error("Chỉ School Admin có thể gửi thông báo trong trường"),
        { status: 403 }
      );
    }

    const { title, message, target } = data;

    const allowedTargets = [
      "all",
      "student",
      "lecturer",
    ];

    if (!allowedTargets.includes(target)) {
      throw Object.assign(
        new Error("INVALID_BROADCAST_TARGET"),
        { status: 400 }
      );
    }

    // 1. Lấy danh sách người nhận theo trường
    const userIds =
      await adminRepository.findUserIdsBySchoolTarget(
        tenant.schoolId,
        target
      );

    if (userIds.length === 0) {
      return {
        success: true,
        count: 0,
        email: {
          attempted: 0,
          sent: 0,
          failed: 0,
        },
      };
    }

    // 2. Tạo thông báo nội bộ
    const notifications = userIds.map((userId) => ({
      userId,
      title,
      message,
      type: "system_announcement",
      related_entity_type: "school_broadcast",
      related_entity_id: null,
      notification_scope: "school",
      school_id: tenant.schoolId,
    }));

    const createdNotifications =
      await notificationsRepository.bulkCreate(notifications);

    // 3. Phát thông báo realtime
    try {
      emitCreatedNotifications(createdNotifications);
    } catch (error) {
      console.error(
        "[ADMIN BROADCAST REALTIME]",
        error.message
      );
    }

    // 4. Lấy email người nhận theo trường
    const recipients =
      await adminRepository.findEmailRecipientsBySchoolTarget(
        tenant.schoolId,
        target
      );

    let emailSent = 0;
    let emailFailed = 0;

    // 5. Gửi email theo từng nhóm 5 người
    const BATCH_SIZE = 5;

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map((recipient) =>
          EmailService.sendEmail({
            to: recipient.email,
            subject: title,
            message,
          })
        )
      );

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          emailSent++;
        } else {
          emailFailed++;

          console.error("[BROADCAST EMAIL FAILED]", {
            userId: batch[index].id,
            error: result.reason?.message,
          });
        }
      });
    }

    // 6. Trả kết quả từng kênh
    return {
      success: true,
      count: createdNotifications.length,
      email: {
        attempted: recipients.length,
        sent: emailSent,
        failed: emailFailed,
      },
    };
  },


  /**
   * Lấy danh sách các thông báo hệ thống đã gửi
   */
  async getSystemNotifications(schoolId) {
    return await adminRepository.getSystemNotifications(schoolId);
  },

  /**
   * Import dữ liệu Lớp học ĐÃ ĐƯỢC XẾP SẴN
   * (Gồm sinh viên, môn học, kỳ học, ngành, giảng viên, lịch slot học theo ngày giờ)
   */
  async importExcelData(fileBuffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw Object.assign(new Error("File Excel không hợp lệ"), { status: 400 });
    }

    // Kiểm tra nếu có sheet phụ "Slots" hoặc "Lịch Học" định nghĩa từng buổi học cụ thể
    const explicitSlotsByClass = {};
    const slotSheet = workbook.worksheets.find((ws, idx) =>
      idx > 0 && /slot|lịch|lich|session/i.test(ws.name || "")
    );
    if (slotSheet) {
      slotSheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          const classCode = row.getCell(1).value?.toString().trim()?.toUpperCase();
          const slotNo = Number(row.getCell(2).value) || rowNumber - 1;
          const dateVal = row.getCell(3).value;
          const timeVal = row.getCell(4).value?.toString().trim();
          const titleVal = row.getCell(5).value?.toString().trim();
          const contentVal = row.getCell(6).value?.toString().trim();
          if (classCode) {
            if (!explicitSlotsByClass[classCode]) explicitSlotsByClass[classCode] = [];
            explicitSlotsByClass[classCode].push({
              slot_number: slotNo,
              date: dateVal,
              time: timeVal,
              title: titleVal,
              content: contentVal,
            });
          }
        }
      });
    }

    const records = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) { // Bỏ qua dòng tiêu đề
        // Cấu trúc (10 cột chuẩn + 3 cột Slot ngày giờ tùy chọn):
        // 1: Mã Sinh Viên
        // 2: Tên Sinh Viên
        // 3: Email Sinh Viên
        // 4: Mã Ngành / Khoa (Major)
        // 5: Kỳ Học (Term/Semester)
        // 6: Mã Lớp (Class Code)
        // 7: Mã Môn Học (Subject Code)
        // 8: Mã Giảng Viên
        // 9: Tên Giảng Viên
        // 10: Email Giảng Viên
        // 11: Lịch / Ca Slot Học (VD: "T3 (09:30-11:45) • T5 (07:00-09:15)" hoặc "08/09/2026 09:30-11:45; 10/09/2026 07:00-09:15")
        // 12: Ngày Bắt Đầu Học (VD: "08/09/2026")
        // 13: Số Buổi / Tổng Slot (VD: 20)

        const studentCode = row.getCell(1).value?.toString().trim();
        const studentName = row.getCell(2).value?.toString().trim();
        const studentEmail = row.getCell(3).value?.toString().trim();
        const major = row.getCell(4).value?.toString().trim();
        const semester = row.getCell(5).value?.toString().trim();
        const classCode = row.getCell(6).value?.toString().trim()?.toUpperCase();
        const subjectCode = row.getCell(7).value?.toString().trim()?.toUpperCase();
        const lecturerCode = row.getCell(8).value?.toString().trim();
        const lecturerName = row.getCell(9).value?.toString().trim();
        const lecturerEmail = row.getCell(10).value?.toString().trim();
        const slotSchedule = row.getCell(11).value?.toString().trim();
        const startDate = row.getCell(12).value;
        const totalSlots = row.getCell(13).value;

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
            lecturerEmail: lecturerEmail || (lecturerCode ? `${lecturerCode.toLowerCase()}@fe.edu.vn` : 'dummy@fe.edu.vn'),
            slotSchedule: slotSchedule || 'T3 (09:30-11:45) • T5 (07:00-09:15)',
            startDate: startDate || '08/09/2026',
            totalSlots: Number(totalSlots) || 20,
            explicitSlots: explicitSlotsByClass[classCode] || [],
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
   * Import dữ liệu tự động chia lớp (30 SV/lớp + phân công GV theo Khoa + chia Slot học theo ngày giờ)
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
        // Hỗ trợ cả file 5-8 cột (MSSV, Họ tên, Mã khoa, Kỳ học, Mã môn, [Ca Slot học, Ngày bắt đầu, Số buổi])
        // hoặc 10-13 cột (MSSV, Họ tên, Email, Mã khoa, Kỳ học, Mã lớp, Mã môn, Mã GV, Tên GV, Email GV, [Ca Slot học, Ngày bắt đầu, Số buổi])
        const c1 = row.getCell(1).value?.toString().trim();
        const c2 = row.getCell(2).value?.toString().trim();
        const c3 = row.getCell(3).value?.toString().trim();
        const c4 = row.getCell(4).value?.toString().trim();
        const c5 = row.getCell(5).value?.toString().trim();
        const c6 = row.getCell(6).value?.toString().trim();
        const c7 = row.getCell(7).value?.toString().trim();
        const c8 = row.getCell(8).value?.toString().trim();
        const c9 = row.getCell(9).value?.toString().trim();
        const c11 = row.getCell(11).value?.toString().trim();
        const c12 = row.getCell(12).value;
        const c13 = row.getCell(13).value;

        const isTenCol = Boolean(c3 && c3.includes('@'));
        const studentCode = c1;
        const fullName = c2 || c1;
        const departmentCode = isTenCol ? (c4 || 'SE') : (c3 || 'SE');
        const semesterCode = isTenCol ? (c5 || 'FALL2025') : (c4 || 'FALL2025');
        const subjectCode = isTenCol ? (c7 || `${departmentCode}101`) : (c5 || `${departmentCode}101`);
        const slotSchedule = isTenCol ? c11 : c6;
        const startDate = isTenCol ? c12 : c7;
        const totalSlots = isTenCol ? c13 : c8;

        if (studentCode && departmentCode && semesterCode) {
          students.push({
            studentCode,
            fullName,
            departmentCode: departmentCode.toUpperCase(),
            semesterCode: semesterCode.toUpperCase(),
            subjectCode: subjectCode.toUpperCase(),
            slotSchedule: slotSchedule || null,
            startDate: startDate || null,
            totalSlots: Number(totalSlots) || 20,
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
    if (lecturerSheet && !/slot|lịch|lich|session/i.test(lecturerSheet.name || "")) {
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


  // =============================================
  // 007D-3C: SCHOOL DEPARTMENTS
  // =============================================

  async getAllDepartments(schoolId) {
    return schoolDepartmentsRepository
      .getAllDepartments(schoolId);
  },

  async createDepartment(data, tenant) {
    try {
      return await schoolDepartmentsRepository
        .createDepartment({
          schoolId: tenant.schoolId,
          actorUserId: tenant.userId,
          data,
        });
    } catch (error) {
      if (error.code === "23505") {
        throw Object.assign(
          new Error("Mã khoa đã tồn tại"),
          { status: 409 }
        );
      }

      throw error;
    }
  },

  async updateDepartment(id, data, tenant) {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(id)) {
      throw Object.assign(
        new Error("ID khoa không hợp lệ"),
        { status: 400 }
      );
    }

    try {
      const updated =
        await schoolDepartmentsRepository
          .updateDepartment({
            schoolId: tenant.schoolId,
            actorUserId: tenant.userId,
            departmentId: id,
            data,
          });

      if (!updated) {
        throw Object.assign(
          new Error("Không tìm thấy khoa trong trường"),
          { status: 404 }
        );
      }

      return updated;
    } catch (error) {
      if (error.code === "23505") {
        throw Object.assign(
          new Error("Mã khoa đã tồn tại"),
          { status: 409 }
        );
      }

      throw error;
    }
  },

  async deleteDepartment(id, tenant) {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(id)) {
      throw Object.assign(
        new Error("ID khoa không hợp lệ"),
        { status: 400 }
      );
    }

    const result =
      await schoolDepartmentsRepository
        .deleteDepartment({
          schoolId: tenant.schoolId,
          actorUserId: tenant.userId,
          departmentId: id,
        });

    if (!result) {
      throw Object.assign(
        new Error("Không tìm thấy khoa trong trường"),
        { status: 404 }
      );
    }

    return result;
  },



  async createClass(data, tenant) {
    try {
      return await schoolClassesRepository
        .createSchoolClass({
          schoolId: tenant.schoolId,
          actorUserId: tenant.userId,
          data,
        });
    } catch (error) {
      if (error.code === "23505") {
        throw Object.assign(
          new Error("Mã lớp đã tồn tại hoặc vi phạm ràng buộc duy nhất"),
          { status: 409 }
        );
      }

      if (error.code === "23503") {
        throw Object.assign(
          new Error("Dữ liệu học kỳ, môn học, giảng viên hoặc buổi học không hợp lệ"),
          { status: 400 }
        );
      }

      throw error;
    }
  },



  async updateClass(id, data, tenant) {
    try {
      return await schoolClassesRepository
        .updateSchoolClass({
          schoolId: tenant.schoolId,
          actorUserId: tenant.userId,
          classId: id,
          data,
        });
    } catch (error) {
      if (error.code === "23505") {
        throw Object.assign(
          new Error("Mã lớp đã tồn tại"),
          { status: 409 }
        );
      }

      if (error.code === "23503") {
        throw Object.assign(
          new Error("Dữ liệu liên kết không hợp lệ"),
          { status: 400 }
        );
      }

      throw error;
    }
  },

  async deleteClass(id, tenant) {
    return schoolClassesRepository
      .deleteSchoolClass({
        schoolId: tenant.schoolId,
        actorUserId: tenant.userId,
        classId: id,
      });
  },


  /**
   * Lấy danh sách lớp học
   */

  async getLecturers(schoolId) {
    return schoolAcademicReadRepository
      .getLecturers(schoolId);
  },

  async getAllClasses(schoolId) {
    return schoolAcademicReadRepository
      .getAllClasses(schoolId);
  },

  async getClassStudents(classId, schoolId) {
    return schoolAcademicReadRepository
      .getClassStudents(schoolId, classId);
  },

  async getClassSlots(classId, schoolId) {
    return schoolAcademicReadRepository
      .getClassSlots(schoolId, classId);
  },


  async updateClassSlots(classId, payload, tenant) {
    return await schoolClassesRepository.updateSchoolClassSlots({
      schoolId: tenant.schoolId,
      actorUserId: tenant.userId,
      classId,
      payload,
    });
  },


  async addClassStudent(classId, payload, tenant) {
    try {
      return await schoolClassesRepository
        .addSchoolClassStudent({
          schoolId: tenant.schoolId,
          actorUserId: tenant.userId,
          classId,
          payload,
        });
    } catch (error) {
      if (error.code === "23505") {
        throw Object.assign(
          new Error("Sinh viên đã có trong lớp"),
          { status: 409 }
        );
      }

      if (error.code === "23503") {
        throw Object.assign(
          new Error("Dữ liệu thành viên không hợp lệ"),
          { status: 400 }
        );
      }

      throw error;
    }
  },

  async removeClassStudent(classId, studentId, tenant) {
    return schoolClassesRepository.removeSchoolClassStudent({
      schoolId: tenant.schoolId,
      actorUserId: tenant.userId,
      classId,
      studentId,
    });
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
