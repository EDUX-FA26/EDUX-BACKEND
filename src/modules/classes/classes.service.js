const ClassesRepository = require('./classes.repository');
const ExcelJS = require('exceljs');
const LearningStreakService = require('../learning/learningStreak.service');
const SchoolClassesRepository = require('../admin/admin.school-classes.repository');

const ClassesService = {
  async getClasses(filters, tenant) {
    return await ClassesRepository.findClasses({
      ...filters,
      role: tenant.role,
      userId: tenant.userId,
      schoolId: tenant.schoolId,
    });
  },

  async getClassById(id, tenant) {
    const classData = await ClassesRepository.findById(
      id,
      tenant.schoolId
    );
    if (!classData) {
      throw new Error('CLASS_NOT_FOUND');
    }

    if (
      tenant.role === 'lecturer' &&
      classData.lecturer_id !== tenant.userId
    ) {
      throw new Error('FORBIDDEN');
    }
    if (tenant.role === 'student') {
      const members = await ClassesRepository.findMembers(
        id,
        tenant.schoolId
      );
      const isMember = members.some(
        member =>
          member.student_id === tenant.userId &&
          member.status === 'active'
      );
      if (!isMember) {
        throw new Error('FORBIDDEN');
      }
    }

    return classData;
  },
  async getSlots(classId, tenant) {
    await this.getClassById(classId, tenant);
    return await ClassesRepository.getSlots(
      classId,
      tenant.schoolId
    );
  },


  async createClass(data, tenant) {
    return SchoolClassesRepository.createSchoolClass({
      schoolId: tenant.schoolId,
      actorUserId: tenant.userId,
      data,
    });
  },

  async updateClass(id, data, tenant) {
    return SchoolClassesRepository.updateSchoolClass({
      schoolId: tenant.schoolId,
      actorUserId: tenant.userId,
      classId: id,
      data,
    });
  },

  async deleteClass(id, tenant) {
    return SchoolClassesRepository.deleteSchoolClass({
      schoolId: tenant.schoolId,
      actorUserId: tenant.userId,
      classId: id,
    });
  },


  async getMembers(classId, tenant) {
    await this.getClassById(classId, tenant);

    const rows = await ClassesRepository.findMembers(
      classId,
      tenant.schoolId
    );

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

  async removeMember(classId, studentId, tenant) {
    return SchoolClassesRepository.removeSchoolClassStudent({
      schoolId: tenant.schoolId,
      actorUserId: tenant.userId,
      classId,
      studentId,
    });
  },

  async importMembers(classId, fileBuffer, tenant) {
    await this.getClassById(classId, tenant);

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

    const records = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const code = String(row.getCell(studentCodeColIdx).value || '').trim();
      if (code) records.push({ rowNumber, code });
    });

    if (records.length === 0) {
      return { total: 0, imported: 0, skipped: 0, errors: [] };
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const record of records) {
      try {
        await SchoolClassesRepository.addSchoolClassStudent({
          schoolId: tenant.schoolId,
          actorUserId: tenant.userId,
          classId,
          payload: { identifier: record.code },
        });
        imported += 1;
      } catch (error) {
        if (error.status !== 404 && error.status !== 409) {
          throw error;
        }

        skipped += 1;
        errors.push({
          row: record.rowNumber,
          code: record.code,
          reason: error.message,
        });
      }
    }

    return {
      total: records.length,
      imported,
      skipped,
      errors,
    };
  },

  async exportMembers(classId, tenant) {
    const classData = await this.getClassById(classId, tenant);

    const members = await ClassesRepository.findMembers(
      classId,
      tenant.schoolId
    );

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

};


module.exports = ClassesService;
