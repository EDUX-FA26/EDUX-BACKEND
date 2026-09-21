const ExcelJS = require('exceljs');
const GradingRepository = require('./grading.repository');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Kiểm tra lecturer có phải là giảng viên của class_id đó không.
 */
function assertLecturer(user, lecturerId) {
  if (user.role === 'admin') return; // admin được phép tất cả
  if (user.role !== 'lecturer') throw new Error('FORBIDDEN');
  if (user.id !== lecturerId) throw new Error('FORBIDDEN');
}

// ─── Grade Service ───────────────────────────────────────────────────────────

const GradingService = {
  // ── UC 37 – Create Grade ───────────────────────────────────────────────────
  /**
   * Chỉ nhận submissionId từ frontend.
   * Backend tự lấy assignment_id, student_id, class_id, lecturer_id
   * từ DB thông qua submission JOIN.
   */
  async createGrade({ submissionId, score, maxScore, feedback }, user) {
    // 1. Lấy submission + context
    const submission = await GradingRepository.findSubmissionById(submissionId);
    if (!submission) throw new Error('SUBMISSION_NOT_FOUND');

    // 2. Kiểm tra quyền (lecturer của class đó)
    assertLecturer(user, submission.lecturer_id);

    // 3. Kiểm tra chưa có grade
    const existing = await GradingRepository.findBySubmissionId(submissionId);
    if (existing) throw new Error('GRADE_ALREADY_EXISTS');

    // 4. max_score: ưu tiên dùng giá trị gửi lên, fallback về assignment.max_score
    const resolvedMaxScore = maxScore ?? submission.assignment_max_score ?? 10;

    // 5. Validate score <= max_score
    if (score > resolvedMaxScore) throw new Error('SCORE_EXCEEDS_MAX');

    // 6. Tạo grade
    const grade = await GradingRepository.create({
      submission_id: submissionId,
      assignment_id: submission.assignment_id,
      student_id: submission.student_id,
      class_id: submission.class_id,
      score,
      max_score: resolvedMaxScore,
      feedback: feedback ?? '',
      graded_by: user.id,
    });

    // 7. Cập nhật submission status → 'graded'
    await GradingRepository.markSubmissionGraded(submissionId);

    return grade;
  },

  // ── UC 38 – Update Grade ───────────────────────────────────────────────────
  async updateGrade(gradeId, { score, maxScore, feedback }, user) {
    // 1. Lấy grade
    const grade = await GradingRepository.findById(gradeId);
    if (!grade) throw new Error('GRADE_NOT_FOUND');

    // 2. Kiểm tra quyền
    assertLecturer(user, grade.lecturer_id ?? grade.graded_by);

    // 3. Nếu đổi score, validate không vượt max_score
    const effectiveMax = maxScore ?? grade.max_score;
    const effectiveScore = score ?? grade.score;
    if (effectiveScore > effectiveMax) throw new Error('SCORE_EXCEEDS_MAX');

    // 4. Update
    const updated = await GradingRepository.update(gradeId, {
      score: score,
      max_score: maxScore,
      feedback: feedback,
    });

    return updated;
  },

  // ── UC 39 – View Grade ────────────────────────────────────────────────────
  async getGrade(gradeId, user) {
    const grade = await GradingRepository.findById(gradeId);
    if (!grade) throw new Error('GRADE_NOT_FOUND');

    if (user.role === 'student') {
      // Student chỉ xem grade của mình
      if (grade.student_id !== user.id) throw new Error('FORBIDDEN');
    } else if (user.role === 'lecturer') {
      // Lecturer chỉ xem grade thuộc class mình quản lý
      const classData = await GradingRepository.findClassById(grade.class_id);
      if (!classData || classData.lecturer_id !== user.id) throw new Error('FORBIDDEN');
    }
    // admin: không hạn chế

    return grade;
  },

  // ── UC 41 – View Gradebook ────────────────────────────────────────────────
  async getGradebook(classId, user) {
    // Kiểm tra class tồn tại
    const classData = await GradingRepository.findClassById(classId);
    if (!classData) throw new Error('CLASS_NOT_FOUND');

    // Chỉ lecturer của class hoặc admin mới xem gradebook
    if (user.role === 'student') throw new Error('FORBIDDEN');
    assertLecturer(user, classData.lecturer_id);

    // Lấy dữ liệu song song
    const [assignments, students, grades] = await Promise.all([
      GradingRepository.findAssignmentsByClass(classId),
      GradingRepository.findStudentsByClass(classId),
      GradingRepository.findGradesByClass(classId),
    ]);

    // Map grades → { student_id → { assignment_id → grade } }
    const gradeMap = {};
    for (const g of grades) {
      if (!gradeMap[g.student_id]) gradeMap[g.student_id] = {};
      gradeMap[g.student_id][g.assignment_id] = g;
    }

    // Tổng hợp gradebook
    const gradebook = students.map((student) => {
      const studentGrades = gradeMap[student.student_id] || {};
      let totalWeightedScore = 0;
      let totalWeight = 0;

      const assignmentRows = assignments.map((a) => {
        const g = studentGrades[a.id] || null;
        const weight = Number(a.weight) || 0;

        if (g && weight > 0) {
          totalWeightedScore += (Number(g.score) / Number(g.max_score)) * weight;
          totalWeight += weight;
        }

        return {
          assignmentId: a.id,
          assignmentTitle: a.title,
          maxScore: g ? Number(g.max_score) : Number(a.max_score),
          score: g ? Number(g.score) : null,
          feedback: g ? g.feedback : null,
          gradedAt: g ? g.graded_at : null,
        };
      });

      // Tính điểm trung bình quy về thang điểm 10
      const averageScore = totalWeight > 0
        ? parseFloat(((totalWeightedScore / totalWeight) * 10).toFixed(2))
        : null;

      return {
        studentId: student.student_id,
        studentCode: student.student_code,
        studentName: student.full_name,
        email: student.email,
        assignments: assignmentRows,
        averageScore,
      };
    });

    return {
      classId,
      classCode: classData.class_code,
      assignments: assignments.map((a) => ({
        assignmentId: a.id,
        assignmentTitle: a.title,
        maxScore: Number(a.max_score),
        weight: Number(a.weight),
      })),
      students: gradebook,
    };
  },

  // ── UC 42 – Export Gradebook ──────────────────────────────────────────────
  async exportGradebook(classId, format = 'xlsx', user) {
    const gradebook = await this.getGradebook(classId, user);

    if (format === 'csv') {
      return _buildCsv(gradebook);
    }
    // Default: xlsx
    return _buildXlsx(gradebook);
  },
};

// ─── Private: Build XLSX ─────────────────────────────────────────────────────
async function _buildXlsx(gradebook) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Gradebook');

  // Header row 1 – fixed columns + one column per assignment
  const fixedHeaders = ['STT', 'MSSV', 'Họ và tên', 'Email'];
  const assignmentHeaders = gradebook.assignments.map(
    (a) => `${a.assignmentTitle} (/${a.maxScore})`
  );
  const trailingHeaders = ['Điểm TB'];

  worksheet.columns = [
    ...fixedHeaders.map((h, i) => ({ header: h, key: `fixed_${i}`, width: i === 2 ? 30 : 18 })),
    ...gradebook.assignments.map((a, i) => ({ header: assignmentHeaders[i], key: `a_${i}`, width: 22 })),
    { header: 'Điểm TB', key: 'avg', width: 12 },
  ];

  // Style header
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

  // Data rows
  gradebook.students.forEach((student, idx) => {
    const row = {
      fixed_0: idx + 1,
      fixed_1: student.studentCode,
      fixed_2: student.studentName,
      fixed_3: student.email,
      avg: student.averageScore ?? 'N/A',
    };
    student.assignments.forEach((a, i) => {
      row[`a_${i}`] = a.score !== null ? a.score : '';
    });
    worksheet.addRow(row);
  });

  return { workbook, classCode: gradebook.classCode };
}

// ─── Private: Build CSV ──────────────────────────────────────────────────────
function _buildCsv(gradebook) {
  const header = [
    'STT', 'MSSV', 'Họ và tên', 'Email',
    ...gradebook.assignments.map((a) => `${a.assignmentTitle} (/${a.maxScore})`),
    'Điểm TB',
  ];

  const rows = gradebook.students.map((student, idx) => [
    idx + 1,
    student.studentCode,
    student.studentName,
    student.email,
    ...student.assignments.map((a) => (a.score !== null ? a.score : '')),
    student.averageScore ?? '',
  ]);

  const csvLines = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  return { csv: csvLines, classCode: gradebook.classCode };
}

module.exports = GradingService;