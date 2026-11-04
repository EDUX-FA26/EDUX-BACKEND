const ClassesRepository = require('./classes.repository');
const ExcelJS = require('exceljs');
const LearningStreakService = require('../learning/learningStreak.service');

const ClassesService = {
  async getClasses(filters, user) {
    // If admin, they see all. Lecturer sees theirs. Student sees joined.
    return await ClassesRepository.findClasses({
      ...filters,
      role: user.role,
      userId: user.id
    });
  },

  async getClassById(id, user) {
    const classData = await ClassesRepository.findById(id);
    if (!classData) {
      throw new Error('CLASS_NOT_FOUND');
    }

    // Checking permissions:
    // Admin: allowed
    // Lecturer: must be their class
    // Student: must be in class_members
    if (user.role === 'lecturer' && classData.lecturer_id !== user.id) {
      throw new Error('FORBIDDEN');
    }
    if (user.role === 'student') {
      const members = await ClassesRepository.findMembers(id);
      const isMember = members.some(m => m.student_id === user.id && m.status === 'active');
      if (!isMember) {
        throw new Error('FORBIDDEN');
      }
    }

    return classData;
  },
  async getSlots(classId, user) {
    // verify access using getClassById logic
    await this.getClassById(classId, user);
    return await ClassesRepository.getSlots(classId);
  },


  async createClass(data) {
    // Could add uniqueness check for class_code + semester_id + subject_id here 
    // by catching DB unique constraint error in controller, or checking beforehand.
    return await ClassesRepository.create(data);
  },

  async updateClass(id, data) {
    const existing = await ClassesRepository.findById(id);
    if (!existing) throw new Error('CLASS_NOT_FOUND');

    return await ClassesRepository.update(id, data);
  },

  async deleteClass(id) {
    const existing = await ClassesRepository.findById(id);
    if (!existing) throw new Error('CLASS_NOT_FOUND');

    return await ClassesRepository.delete(id);
  },


  async getMembers(classId, user) {
    // Kiểm tra quyền truy cập lớp
    await this.getClassById(classId, user);

    const rows = await ClassesRepository.findMembers(classId);

    return rows.map((row) => {
      let streakInfo = {
        currentStreak: 0,
        longestStreak: 0,
        lastActivityDate: null,
        recoveryUsed: 0,
        recoveryRemaining: 3,
        status: 'not_started'
      };

      // Tính lại Streak theo logic hiện tại
      if (
        row.current_streak !== null &&
        row.current_streak !== undefined &&
        row.is_active !== false
      ) {
        const calculated =
          LearningStreakService.calculateCurrentStreak({
            current_streak: parseInt(row.current_streak, 10) || 0,
            longest_streak: parseInt(row.longest_streak, 10) || 0,
            last_activity_date: row.last_activity_date,
            recovery_used: parseInt(row.recovery_used, 10) || 0,
            recovery_month: row.recovery_month
          });

        streakInfo = {
          currentStreak: calculated.currentStreak,
          longestStreak: calculated.longestStreak,
          lastActivityDate: calculated.lastActivityDate,
          recoveryUsed: calculated.recoveryUsed,
          recoveryRemaining: calculated.recoveryRemaining,
          status: calculated.status
        };
      }

      // Tách trạng thái Streak và trạng thái thành viên
      const { status: streakStatus, ...streakData } = streakInfo;

      return {
        studentId: row.student_id,

        // Trạng thái tham gia lớp
        status: row.status,
        membershipStatus: row.status,

        email: row.email,
        fullName: row.full_name,
        studentCode: row.student_code,
        departmentName: row.department_name,

        // Thông tin Streak
        ...streakData,
        streakStatus
      };
    });
  },

  async removeMember(classId, studentId, user) {
    const classData = await ClassesRepository.findById(classId);
    if (!classData) throw new Error('CLASS_NOT_FOUND');

    if (user.role === 'lecturer' && classData.lecturer_id !== user.id) {
      throw new Error('FORBIDDEN');
    }

    const removed = await ClassesRepository.removeMember(classId, studentId);
    if (!removed) throw new Error('MEMBER_NOT_FOUND');
    return removed;
  },

  async importMembers(classId, fileBuffer, user) {
    const classData = await ClassesRepository.findById(classId);
    if (!classData) throw new Error('CLASS_NOT_FOUND');

    if (user.role === 'lecturer' && classData.lecturer_id !== user.id) {
      throw new Error('FORBIDDEN');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);

    const worksheet = workbook.worksheets[0]; // Get first sheet
    if (!worksheet) throw new Error('INVALID_EXCEL_FORMAT');

    // Assuming first row is header
    const headers = worksheet.getRow(1).values;
    // Find the column index for student_code (Mã sinh viên)
    let studentCodeColIdx = -1;
    for (let i = 1; i < headers.length; i++) {
      const header = String(headers[i] || '').trim().toLowerCase();
      if (header === 'student_code' || header === 'mã sinh viên' || header === 'mssv' || header === 'student code') {
        studentCodeColIdx = i;
        break;
      }
    }

    if (studentCodeColIdx === -1) {
      // Fallback: assume column 1 or 2 is student code if not found explicitly, but better to enforce header name.
      throw new Error('HEADER_STUDENT_CODE_NOT_FOUND');
    }

    const codes = new Set();
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header
      const code = String(row.getCell(studentCodeColIdx).value || '').trim();
      if (code) codes.add(code);
    });

    const uniqueCodes = Array.from(codes);
    if (uniqueCodes.length === 0) {
      return { total: 0, imported: 0, skipped: 0, invalidCodes: [] };
    }

    const foundUsers = await ClassesRepository.getStudentIdsByCodes(uniqueCodes);
    const validCodesMap = new Map();
    foundUsers.forEach(u => validCodesMap.set(u.student_code, u.user_id));

    const invalidCodes = uniqueCodes.filter(code => !validCodesMap.has(code));
    const studentIdsToInsert = Array.from(validCodesMap.values());

    const importedCount = await ClassesRepository.bulkUpsertMembers(classId, studentIdsToInsert);

    return {
      total: uniqueCodes.length,
      imported: validCodesMap.size,
      skipped: invalidCodes.length,
      invalidCodes
    };
  },

  async exportMembers(classId, user) {
    // Check permission
    const classData = await ClassesRepository.findById(classId);
    if (!classData) throw new Error('CLASS_NOT_FOUND');

    if (user.role === 'lecturer' && classData.lecturer_id !== user.id) {
      throw new Error('FORBIDDEN');
    }

    const members = await ClassesRepository.findMembers(classId);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Members');

    // Define columns
    worksheet.columns = [
      { header: 'STT', key: 'stt', width: 5 },
      { header: 'Mã sinh viên', key: 'student_code', width: 20 },
      { header: 'Họ và tên', key: 'full_name', width: 30 },
      { header: 'Email', key: 'email', width: 35 },
      { header: 'Trạng thái', key: 'status', width: 15 },
      { header: 'Khoa', key: 'department_name', width: 30 }
    ];

    // Add rows
    members.forEach((member, index) => {
      worksheet.addRow({
        stt: index + 1,
        student_code: member.student_code,
        full_name: member.full_name,
        email: member.email,
        status: member.status,
        department_name: member.department_name || ''
      });
    });

    // Styling headers
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    return { workbook, classData };
  },

  async sendBulkNotification(classId, user, payload) {
    // Chỉ cho phép Lecturer / Admin.
    if (!['lecturer', 'admin'].includes(user?.role)) {
      throw new Error('FORBIDDEN');
    }

    // Kiểm tra quyền truy cập lớp.
    // Lecturer chỉ được thao tác với lớp mình phụ trách.
    await ClassesService.getClassById(classId, user);

    const { studentIds, title, message } = payload || {};

    if (
      !Array.isArray(studentIds) ||
      studentIds.length === 0 ||
      studentIds.length > 100 ||
      studentIds.some(id => typeof id !== 'string' || !isUuid(id)) ||
      typeof title !== 'string' ||
      typeof message !== 'string' ||
      !title.trim() ||
      !message.trim() ||
      title.trim().length > 200 ||
      message.trim().length > 5000
    ) {
      throw new Error('INVALID_NOTIFICATION_PAYLOAD');
    }

    const uniqueStudentIds = [...new Set(studentIds)];

    // Lấy danh sách thành viên từ Backend, không tin danh sách
    // do Frontend gửi lên.
    const members = await ClassesService.getMembers(classId, user);

    const activeMemberIds = new Set(
      members
        .filter(member => member.membershipStatus === 'active')
        .map(member => member.studentId)
    );

    // Từ chối toàn bộ request nếu có người nhận không hợp lệ.
    const invalidStudentIds = uniqueStudentIds.filter(
      studentId => !activeMemberIds.has(studentId)
    );

    if (invalidStudentIds.length > 0) {
      throw new Error('INVALID_RECIPIENTS');
    }

    // Tạo một notification cho mỗi sinh viên.
    const notifications = uniqueStudentIds.map(studentId => ({
      userId: studentId,
      title: title.trim(),
      message: message.trim(),
      type: 'system_announcement',
      related_entity_type: 'class',
      related_entity_id: classId,
    }));

    // Sử dụng Repository đã có của EduX.
    const created = await NotificationsRepository.bulkCreate(
      notifications
    );

    return {
      classId,
      sentCount: created.length,
      requestedCount: uniqueStudentIds.length,
      notificationIds: created.map(item => item.id),
    };
  },

};


module.exports = ClassesService;
