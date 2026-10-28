const ExcelJS = require('exceljs');
const GradingRepository = require('./grading.repository');
const { evaluateRubricWithGemini } = require('../../config/gemini.config');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Kiểm tra lecturer có phải là giảng viên của class_id đó không.
 */
function assertLecturer(user, lecturerId) {
  if (user.role === 'admin') return; // admin được phép tất cả
  if (user.role !== 'lecturer') throw new Error('FORBIDDEN');
  if (user.id !== lecturerId) throw new Error('FORBIDDEN');
}

/**
 * Trích xuất tập tin bài nộp, cấu trúc AST và Lịch sử Git commit thực tế
 */
async function extractSubmissionFiles(filesList) {
  let zipBuffer = null;
  const { s3, S3_BUCKET } = require('../../config/seaweed.config');
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const AdmZip = require('adm-zip');
  const fs = require('fs');

  const zipFileMeta = (filesList || []).find(f => 
    (f.name || f.filename || '').toLowerCase().endsWith('.zip') || 
    (f.key || '').toLowerCase().endsWith('.zip')
  );

  if (zipFileMeta && zipFileMeta.key) {
    try {
      const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: zipFileMeta.key });
      const res = await s3.send(command);
      const chunks = [];
      for await (const chunk of res.Body) {
        chunks.push(chunk);
      }
      zipBuffer = Buffer.concat(chunks);
    } catch (err) {
      if (fs.existsSync('temp_sub.zip')) {
        zipBuffer = fs.readFileSync('temp_sub.zip');
      }
    }
  } else if (fs.existsSync('temp_sub.zip')) {
    zipBuffer = fs.readFileSync('temp_sub.zip');
  }

  if (zipBuffer) {
    try {
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();
      const fileTree = [];
      const codeContents = [];
      let gitHistory = null;

      for (const entry of entries) {
        if (entry.isDirectory) continue;

        // Trích xuất git log từ .git/logs/HEAD
        if (entry.entryName.endsWith('.git/logs/HEAD')) {
          const logText = entry.getData().toString('utf8');
          const lines = logText.trim().split('\n').filter(Boolean);
          const commits = lines.map(line => {
            const parts = line.split('\t');
            const header = parts[0] || '';
            const msg = parts[1] || '';
            const match = header.match(/^(\w+)\s+(\w+)\s+([^<]+)<([^>]+)>\s+(\d+)\s+([+-]\d+)/);
            if (match) {
              const ts = parseInt(match[5], 10);
              return {
                commitHash: match[2].slice(0, 7),
                author: match[3].trim(),
                email: match[4].trim(),
                timestamp: ts,
                date: new Date(ts * 1000).toISOString(),
                message: msg
              };
            }
            return { raw: line };
          });
          gitHistory = {
            totalCommits: commits.length,
            commits
          };
          continue;
        }

        if (entry.entryName.includes('.git/')) continue;

        fileTree.push({
          path: entry.entryName,
          size: entry.header.size
        });

        const isCodeOrDoc = /\.(py|js|ts|tsx|jsx|java|cpp|cs|html|css|json|md|txt|sql|yml|yaml)$/i.test(entry.entryName);
        if (isCodeOrDoc) {
          const text = entry.getData().toString('utf8');
          const imports = [];
          const classes = [];
          const functions = [];

          text.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
              imports.push(trimmed);
            }
            const classMatch = trimmed.match(/^(?:export\s+)?class\s+([A-Za-z0-9_]+)/);
            if (classMatch) classes.push(classMatch[1]);
            const funcMatch = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(/) || trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/);
            if (funcMatch) functions.push(funcMatch[1]);
          });

          codeContents.push({
            path: entry.entryName,
            size: entry.header.size,
            imports: imports.slice(0, 20),
            classes: classes.slice(0, 15),
            functions: functions.slice(0, 25),
            sampleContent: text.slice(0, 4000)
          });
        }
      }

      return { fileTree, codeContents, gitHistory };
    } catch (zipErr) {
      console.warn('Lỗi giải nén ZIP bài nộp:', zipErr.message);
    }
  }

  return null;
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

    // 3. Kiểm tra chưa có grade -> nếu đã có thì tự động update thay vì báo lỗi
    const existing = await GradingRepository.findBySubmissionId(submissionId);
    if (existing) {
      return this.updateGrade(existing.id, { score, maxScore, feedback }, user);
    }

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

    if (grade.submission_id) {
      await GradingRepository.markSubmissionGraded(grade.submission_id);
    }

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

  // ── AI Audit Rubric Grading ────────────────────────────────────────────────
  /**
   * Thẩm định và gợi ý điểm 5 tiêu chí Rubric qua Gemini AI (đối soát chéo AI audit + Q&A vấn đáp)
   * @param {string} submissionId
   * @param {Object} clientContext
   */
  async auditRubricForSubmission(submissionId, clientContext = {}) {
    // 1. Lấy toàn bộ thông tin bài nộp, đề bài, version từ Database thực tế
    const auditData = await GradingRepository.getSubmissionAuditData(submissionId);
    if (!auditData) {
      throw new Error('SUBMISSION_NOT_FOUND');
    }

    // 2. Chuẩn bị thông tin bài tập (assignmentInfo)
    const assignmentInfo = [
      `Tiêu đề bài tập: ${auditData.submission.assignment_title || 'N/A'}`,
      `Mô tả yêu cầu kỹ thuật: ${auditData.submission.assignment_description || 'Không có mô tả chi tiết'}`,
      `Hướng dẫn thực hiện: ${auditData.submission.assignment_instructions || 'Tuân thủ các yêu cầu kiến trúc và chuẩn coding convention'}`,
      `Điểm tối đa bài tập: ${auditData.submission.assignment_max_score || 10} điểm`
    ].join('\n');

    // 3. Chuẩn bị thông tin mã nguồn và tập tin bài nộp (sourceCode)
    let filesList = [];
    if (auditData.latestVersion && auditData.latestVersion.files) {
      try {
        const rawFiles = typeof auditData.latestVersion.files === 'string'
          ? JSON.parse(auditData.latestVersion.files)
          : auditData.latestVersion.files;
        filesList = Array.isArray(rawFiles) ? rawFiles : [];
      } catch (err) {
        filesList = [];
      }
    }

    // Trích xuất mã nguồn và Git history thực tế từ gói bài nộp
    const extractedData = await extractSubmissionFiles(filesList);

    let sourceCode = '';
    let gitHistoryStr = '';

    if (extractedData && extractedData.fileTree.length > 0) {
      const filesOverview = extractedData.fileTree
        .map(f => `- ${f.path} (${f.size} bytes)`)
        .join('\n');

      const codeSnippets = extractedData.codeContents
        .map(c => {
          return [
            `\n--- TỆP TIN: ${c.path} (${c.size} bytes) ---`,
            c.imports.length > 0 ? `• Thư viện import: ${c.imports.join(', ')}` : '',
            c.classes.length > 0 ? `• Các Class định nghĩa: ${c.classes.join(', ')}` : '',
            c.functions.length > 0 ? `• Các Hàm chính: ${c.functions.join(', ')}` : '',
            `• Đoạn mã nguồn trích xuất:\n${c.sampleContent}`
          ].filter(Boolean).join('\n');
        })
        .join('\n\n');

      sourceCode = [
        `[DANH SÁCH TẬP TIN NỘP BÀI TRONG GÓI DỰ ÁN (${extractedData.fileTree.length} tệp)]:`,
        filesOverview,
        '',
        `[CHI TIẾT MÃ NGUỒN VÀ AST SUMMARY]:`,
        codeSnippets
      ].join('\n');

      if (extractedData.gitHistory && extractedData.gitHistory.commits.length > 0) {
        const commitsText = extractedData.gitHistory.commits
          .map(c => `• [${c.commitHash}] ${c.date} | ${c.author}: ${c.message}`)
          .join('\n');

        let intervalNote = '';
        if (extractedData.gitHistory.commits.length >= 2) {
          const first = extractedData.gitHistory.commits[0];
          const second = extractedData.gitHistory.commits[1];
          if (first.timestamp && second.timestamp) {
            const diffMin = Math.round(Math.abs(second.timestamp - first.timestamp) / 60);
            intervalNote = `\n• Lưu ý kiểm toán: Khoảng cách giữa commit khởi tạo và commit code chính là ${diffMin} phút. Nếu commit thêm hơn 1000 dòng trong vòng vài phút mà không có lịch sử phát triển từng bước, đây là dấu hiệu dump code AI hoặc copy dự án có sẵn.`;
          }
        }

        gitHistoryStr = [
          `Tổng số commit ghi nhận: ${extractedData.gitHistory.totalCommits}`,
          commitsText,
          intervalNote
        ].join('\n');
      }
    } else {
      const filesDescription = filesList.length > 0
        ? filesList.map((f, i) => `- Tệp ${i + 1}: ${f.name || f.filename || 'Tập tin'} (${f.size || 0} bytes)`).join('\n')
        : 'Không tìm thấy tệp đính kèm.';

      sourceCode = [
        `[DANH SÁCH TẬP TIN]:`,
        filesDescription,
        '',
        `[MÃ NGUỒN]:`,
        clientContext.codeSnippet || 'Mã nguồn đã được gửi qua client editor.'
      ].join('\n');

      gitHistoryStr = 'Không tìm thấy thư mục .git trong bài nộp.';
    }

    // 4. Phân tích ghi chú phiên bản và Khai báo AI của sinh viên
    let parsedNote = null;
    if (auditData.latestVersion?.note) {
      try {
        parsedNote = typeof auditData.latestVersion.note === 'string'
          ? JSON.parse(auditData.latestVersion.note)
          : auditData.latestVersion.note;
      } catch (e) {
        parsedNote = null;
      }
    }

    // 5. Chuẩn bị AI Audit Declarations
    let aiAuditSummary = '';
    const declarationsMap = parsedNote?.declarations || clientContext.aiDeclarations || {};
    const decKeys = Object.keys(declarationsMap);

    if (decKeys.length > 0) {
      aiAuditSummary += '[CHI TIẾT LỜI KHAI BÁO CỦA SINH VIÊN TRONG HỆ THỐNG]:\n';
      const prompts = [];

      decKeys.forEach((key) => {
        const d = declarationsMap[key];
        const promptText = (d.prompt || '').trim();
        if (promptText) prompts.push(promptText);

        aiAuditSummary += `\n* Giai đoạn [${(d.title || d.phaseName || key).toUpperCase()}]:
  - Tool AI khai báo: ${d.aiTool || 'N/A'}
  - Quyết định: ${d.decision || 'N/A'}
  - Prompt: ${d.prompt || 'Không có'}
  - AI Response Summary: ${d.responseSummary || d.aiResponseSummary || 'Không có'}
  - Phản tư / Tự đánh giá: ${d.reflection || d.studentReflection || 'Không có'}`;
      });

      const uniquePrompts = new Set(prompts);
      if (prompts.length >= 3 && uniquePrompts.size === 1) {
        aiAuditSummary += `\n\n[CẢNH BÁO KIỂM TOÁN TỰ ĐỘNG]: Tất cả ${prompts.length} giai đoạn khai báo AI đều chứa nội dung copy-paste giống hệt nhau ('${prompts[0].slice(0, 80)}...'). Đây là hành vi khai báo đối phó, sơ sài, không có giá trị học thuật. Cần kiểm tra xem nội dung khai báo có khớp với công nghệ của mã nguồn thực tế hay hoàn toàn lạc đề.`;
      }
    } else {
      aiAuditSummary = 'Sinh viên KHÔNG thực hiện khai báo sử dụng AI (Không nộp Audit Log).';
    }

    // 6. Oral Exam / Viva Logs nếu client đã cung cấp từ trước
    let oralExamLogs = '';
    if (Array.isArray(clientContext.oralExamLogs) && clientContext.oralExamLogs.length > 0) {
      // Bỏ qua nếu là mock data cũ
      const isLegacyMock = clientContext.oralExamLogs.some(l => 
        (l.question && (l.question.includes('MongoDB') || l.question.includes('HttpOnly') || l.question.includes('SeaweedFS')))
      );
      if (!isLegacyMock) {
        oralExamLogs = clientContext.oralExamLogs.map((item, idx) => {
          return [
            `[CÂU HỎI VẤN ĐÁP #${idx + 1}]`,
            `• Câu hỏi của Giảng viên: ${item.question}`,
            `• Sinh viên trả lời: ${item.studentResponse || item.answer || 'Chưa có câu trả lời'}`,
            `• Đánh giá: ${item.evaluation || item.assessment || 'Hiểu rõ'}`
          ].join('\n');
        }).join('\n\n');
      }
    }

    // 7. Gọi hàm evaluateRubricWithGemini thẩm định đối soát chéo thực tế qua Gemini
    const result = await evaluateRubricWithGemini({
      assignmentInfo,
      sourceCode,
      gitHistory: gitHistoryStr,
      aiAuditSummary,
      oralExamLogs,
    });

    return result;
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