const ClassesRepository = require('./classes.repository');
const ExcelJS = require('exceljs');

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
    // verify access using getClassById logic
    await this.getClassById(classId, user);
    return await ClassesRepository.findMembers(classId);
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
  }
};

module.exports = ClassesService;
