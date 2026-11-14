const ExcelJS = require('exceljs');
const GradingRepository = require('./grading.repository');
const { evaluateRubricWithGemini, generatePedagogicalFallbackResult, applyScoringGuardrails } = require('../../config/gemini.config');
const { normalizeAuditData } = require('../../utils/aiAuditHelper');
const AssignmentRepository = require('../assignments/assignment.repository');
const { DEFAULT_RUBRIC_CONFIGS } = require('../assignments/assignment.constants');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Kiểm tra lecturer có phải là giảng viên của class_id đó trong trường hiện tại không.
 */
function assertLecturer(tenant, lecturerId) {
  if (tenant.role === 'school_admin') return; // school_admin được phép trong phạm vi trường đã kiểm tra
  if (tenant.role !== 'lecturer') throw new Error('FORBIDDEN');
  if (tenant.userId !== lecturerId) throw new Error('FORBIDDEN');
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
   * từ DB thông qua submission JOIN theo school_id.
   */
  async createGrade({ submissionId, score, maxScore, feedback, rubrics }, tenant) {
    // 1. Lấy submission + context trong trường hiện tại
    const submission = await GradingRepository.findSubmissionById(submissionId, tenant.schoolId);
    if (!submission || submission.submission_status === 'draft') throw new Error('SUBMISSION_NOT_FOUND');

    // 2. Kiểm tra quyền (lecturer của class đó hoặc school_admin của trường)
    assertLecturer(tenant, submission.lecturer_id);

    // 3. Kiểm tra chưa có grade -> nếu đã có thì tự động update thay vì báo lỗi
    const existing = await GradingRepository.findBySubmissionId(submissionId, tenant.schoolId);
    if (existing) {
      return this.updateGrade(existing.id, { score, maxScore, feedback, rubrics }, tenant);
    }

    // 4. max_score: ưu tiên dùng giá trị gửi lên, fallback về assignment.max_score
    const resolvedMaxScore = maxScore ?? submission.assignment_max_score ?? 10;

    // 5. Validate score <= max_score
    if (score > resolvedMaxScore) throw new Error('SCORE_EXCEEDS_MAX');

    // 6. Tạo grade
    const grade = await GradingRepository.create({
      school_id: tenant.schoolId,
      submission_id: submissionId,
      assignment_id: submission.assignment_id,
      student_id: submission.student_id,
      class_id: submission.class_id,
      score,
      max_score: resolvedMaxScore,
      feedback: feedback ?? '',
      graded_by: tenant.userId,
      rubrics: rubrics ?? null,
    });

    // 7. Cập nhật submission status → 'graded'
    await GradingRepository.markSubmissionGraded(submissionId, tenant.schoolId);

    // 8. Tự động kích hoạt tổng hợp dữ liệu và sinh snapshot AI Advisor trong nền (non-blocking)
    try {
      const ClassAiAdvisorService = require('../classes/classAiAdvisor.service');
      ClassAiAdvisorService.generateAndSaveAdvisory(
        submission.class_id,
        {
          id: submission.assignment_id,
          title: submission.assignment_title || 'Bài tập'
        },
        tenant.schoolId
      ).catch(e => console.warn('[createGrade] Background advisor snapshot generation failed:', e.message));
    } catch (e) {}

    return grade;
  },

  // ── UC 38 – Update Grade ───────────────────────────────────────────────────
  async updateGrade(gradeId, { score, maxScore, feedback, rubrics }, tenant) {
    // 1. Lấy grade trong trường hiện tại
    const grade = await GradingRepository.findById(gradeId, tenant.schoolId);
    if (!grade) throw new Error('GRADE_NOT_FOUND');

    // 2. Kiểm tra quyền
    assertLecturer(tenant, grade.lecturer_id);

    // 3. Nếu đổi score, validate không vượt max_score
    const effectiveMax = maxScore ?? grade.max_score;
    const effectiveScore = score ?? grade.score;
    if (effectiveScore > effectiveMax) throw new Error('SCORE_EXCEEDS_MAX');

    // 4. Update
    const updated = await GradingRepository.update(gradeId, tenant.schoolId, {
      score: score,
      max_score: maxScore,
      feedback: feedback,
      rubrics: rubrics,
    });

    if (grade.submission_id) {
      await GradingRepository.markSubmissionGraded(grade.submission_id, tenant.schoolId);
    }

    // Tự động kích hoạt tổng hợp dữ liệu và sinh snapshot AI Advisor trong nền (non-blocking)
    try {
      const ClassAiAdvisorService = require('../classes/classAiAdvisor.service');
      ClassAiAdvisorService.generateAndSaveAdvisory(
        grade.class_id,
        {
          id: grade.assignment_id,
          title: grade.assignment_title || 'Bài tập'
        },
        tenant.schoolId
      ).catch(e => console.warn('[updateGrade] Background advisor snapshot generation failed:', e.message));
    } catch (e) {}

    return updated;
  },

  // ── UC 39 – View Grade ────────────────────────────────────────────────────
  async getGrade(gradeId, tenant) {
    const grade = await GradingRepository.findById(gradeId, tenant.schoolId);
    if (!grade) throw new Error('GRADE_NOT_FOUND');

    if (tenant.role === 'student') {
      // Student chỉ xem grade của mình
      if (grade.student_id !== tenant.userId) throw new Error('FORBIDDEN');
    } else if (tenant.role === 'lecturer') {
      // Lecturer chỉ xem grade thuộc class mình quản lý
      if (grade.lecturer_id !== tenant.userId) throw new Error('FORBIDDEN');
    } else if (tenant.role !== 'school_admin') {
      throw new Error('FORBIDDEN');
    }

    return grade;
  },

  // ── UC 41 – View Gradebook ────────────────────────────────────────────────
  async getGradebook(classId, tenant) {
    // Kiểm tra class tồn tại trong trường hiện tại
    const classData = await GradingRepository.findClassById(classId, tenant.schoolId);
    if (!classData) throw new Error('CLASS_NOT_FOUND');

    // Chỉ lecturer của class hoặc school_admin mới xem gradebook
    if (tenant.role === 'student') throw new Error('FORBIDDEN');
    assertLecturer(tenant, classData.lecturer_id);

    // Lấy dữ liệu song song trong phạm vi trường hiện tại
    const [assignments, students, grades] = await Promise.all([
      GradingRepository.findAssignmentsByClass(classId, tenant.schoolId),
      GradingRepository.findStudentsByClass(classId, tenant.schoolId),
      GradingRepository.findGradesByClass(classId, tenant.schoolId),
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
  async exportGradebook(classId, format = 'xlsx', tenant) {
    const gradebook = await this.getGradebook(classId, tenant);

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
   * @param {Object} tenant
   */
  async auditRubricForSubmission(submissionId, clientContext = {}, tenant) {
    const force = Boolean(clientContext.force);

    // 1. Lấy toàn bộ thông tin bài nộp, đề bài, version từ Database thực tế theo school_id
    const auditData = await GradingRepository.getSubmissionAuditData(submissionId, tenant.schoolId);
    if (!auditData || !auditData.submission || auditData.submission.submission_status === 'draft') {
      throw new Error('SUBMISSION_NOT_FOUND');
    }

    // 2. Kiểm tra quyền truy cập của giảng viên / school_admin trước khi đọc cache hoặc gọi AI
    assertLecturer(tenant, auditData.submission.lecturer_id);

    // 3. Nếu không force, kiểm tra Database xem đã có bản ghi snapshot evaluation chưa
    if (!force) {
      try {
        const existingEval = await GradingRepository.findAiEvaluationBySubmissionId(submissionId, tenant.schoolId);
        if (existingEval && existingEval.evaluation_data) {
          const cachedData = typeof existingEval.evaluation_data === 'string'
            ? JSON.parse(existingEval.evaluation_data)
            : existingEval.evaluation_data;

          if (cachedData && cachedData.audit_integrity) {
            const rLevel = normalizeRiskLevel(cachedData.audit_integrity.risk_level || cachedData.audit_integrity.riskLevel || existingEval.risk_level);
            cachedData.audit_integrity.riskLevel = rLevel;
            cachedData.audit_integrity.risk_level = rLevel === 'high' ? 'HIGH_RISK' : (rLevel === 'medium' ? 'MEDIUM_RISK' : 'LOW_RISK');
          }

          console.log(`[ART-AI] Returning locked evaluation snapshot from DB for submission ${submissionId}`);
          return cachedData;
        }
      } catch (err) {
        console.warn('[ART-AI] Failed to read cached evaluation snapshot:', err.message);
      }
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

    // 4. Phân tích ghi chú phiên bản và Khai báo AI của sinh viên qua helper normalizeAuditData (Backward Compatible)
    const normalizedAudit = normalizeAuditData(
      auditData.latestVersion?.note ||
      clientContext.aiAuditData ||
      clientContext.aiDeclarations
    );
    const scopes = normalizedAudit?.scopes || [];

    // 5. Chuẩn bị AI Audit Declarations theo mô hình Đa phân rã (Multi-Scope)
    let aiAuditSummary = '';

    if (scopes.length > 0) {
      aiAuditSummary += `[KIỂM TOÁN KHAI BÁO AI THEO MÔ HÌNH ĐA PHÂN RÃ (MULTI-SCOPE AI AUDIT) - TỔNG CỘNG ${scopes.length} PHẠM VI/MODULE]:\n`;
      aiAuditSummary += `Sinh viên đã phân rã bài toán thành ${scopes.length} phạm vi kỹ thuật độc lập để tương tác với AI:\n`;

      const allPrompts = [];

      scopes.forEach((scope, sIdx) => {
        const scopeTitle = scope.scope_title || scope.title || `Scope ${sIdx + 1}`;
        const scopeDesc = scope.scope_description || scope.description || 'Chưa cung cấp mô tả kỹ thuật chi tiết.';

        aiAuditSummary += `\n--- PHẠM VI ${sIdx + 1}: ${scopeTitle} ---\n`;
        aiAuditSummary += `Mô tả: ${scopeDesc}\n`;
        aiAuditSummary += `Chi tiết 5 tiêu chí:\n`;

        const decs = scope.declarations || {};
        const criteriaList = [
          { key: 'decomposition', name: 'Decomposition (Phân rã bài toán)' },
          { key: 'pattern_recognition', altKey: 'pattern', name: 'Pattern Recognition (Nhận diện mẫu)' },
          { key: 'abstraction', name: 'Abstraction (Trừu tượng hóa & Mô hình)' },
          { key: 'algorithmic_thinking', altKey: 'algorithmic', name: 'Algorithmic Thinking (Tư duy thuật toán)' },
          { key: 'reflection', name: 'Reflection (Phản tư & Đánh giá giải pháp)' },
        ];

        criteriaList.forEach((crit) => {
          const d = decs[crit.key] || (crit.altKey ? decs[crit.altKey] : null) || {};
          const promptText = (d.prompt || '').trim();
          if (promptText) allPrompts.push(promptText);

          aiAuditSummary += `  * [${crit.name}]:
    - Tool & Decision: ${d.tool || d.aiTool || 'Chưa khai báo'} | Quyết định: ${d.decision || 'Chưa khai báo'}
    - Prompt/Input Used: ${d.prompt || 'Không có câu lệnh'}
    - AI Respond Summary: ${d.response || d.responseSummary || d.aiResponseSummary || 'Không có tóm tắt'}
    - Student Self-Reflection: ${d.reflection || d.studentReflection || 'Không có phản tư'}\n`;
        });
      });

      const uniquePrompts = new Set(allPrompts);
      if (allPrompts.length >= 3 && uniquePrompts.size === 1) {
        aiAuditSummary += `\n\n[CẢNH BÁO KIỂM TOÁN TỰ ĐỘNG]: Tất cả ${allPrompts.length} câu lệnh (Prompt) qua các phạm vi đều copy-paste giống hệt nhau ('${allPrompts[0].slice(0, 80)}...'). Đây là hành vi khai báo đối phó, sơ sài, thiếu chiều sâu kỹ thuật. Cần kiểm tra xem nội dung khai báo có khớp với công nghệ của mã nguồn thực tế hay hoàn toàn lạc đề, và trừ điểm tiêu chí reflection.`;
      }
    } else {
      aiAuditSummary = 'Sinh viên KHÔNG thực hiện khai báo sử dụng AI trong ghi chú bài nộp.';
    }

    // Tích hợp dữ liệu từ bảng ai_interactions (nếu có)
    if (Array.isArray(auditData.aiInteractions) && auditData.aiInteractions.length > 0) {
      aiAuditSummary += '\n\n[LỊCH SỬ TƯƠNG TÁC AI TỪ DATABASE (AI INTERACTIONS)]:\n';
      auditData.aiInteractions.forEach((interaction, idx) => {
        aiAuditSummary += `\n* Lượt tương tác #${idx + 1}:
  - Công cụ: ${interaction.ai_tool} | Mục đích: ${interaction.usage_purpose}
  - Quyết định: ${interaction.student_decision}
  - Nội dung prompt: ${interaction.prompt_content}
  - Tóm tắt phản hồi AI: ${interaction.ai_response_summary}
  - Tự phản tư: ${interaction.reflection_text}`;
      });
    }

    // Tích hợp kết quả đánh giá AI từ bảng ai_evaluations (nếu có)
    if (auditData.aiEvaluation) {
      aiAuditSummary += `\n\n[KẾT QUẢ ĐÁNH GIÁ AI TỪ DATABASE (AI EVALUATION)]: Pattern: ${auditData.aiEvaluation.pattern}, Risk: ${auditData.aiEvaluation.risk_level}, Transparency Score: ${auditData.aiEvaluation.transparency_score}, Summary: ${auditData.aiEvaluation.summary}`;
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

    // 7. Lấy cấu hình Rubric của bài tập (hoặc mặc định) để nạp động vào AI Grading Engine
    let rawConfigs = null;
    try {
      if (auditData?.submission?.assignment_id) {
        rawConfigs = await AssignmentRepository.getRubricConfigs(auditData.submission.assignment_id);
      }
      if (!rawConfigs || rawConfigs.length === 0) {
        rawConfigs = DEFAULT_RUBRIC_CONFIGS;
      }
    } catch (rubricErr) {
      console.warn('[ART-AI] Failed to fetch assignment rubric configs, using default:', rubricErr?.message || rubricErr);
      rawConfigs = DEFAULT_RUBRIC_CONFIGS;
    }

    // BƯỚC 1: LỌC DANH SÁCH TIÊU CHÍ ACTIVE (is_enabled = true và weight_percent > 0)
    const activeRubrics = (rawConfigs || [])
      .filter((c) => c.is_enabled === true && Number(c.weight_percent) > 0)
      .map((c, idx) => ({
        index: idx + 1,
        criterion_key: c.criterion_key,
        criteria_name: c.criterion_name,
        weight_percent: Number(c.weight_percent),
        max_score: Number(((Number(c.weight_percent) / 100) * 10).toFixed(2)),
      }));

    // Đảm bảo luôn có ít nhất 1 rubric active
    const finalActiveRubrics = activeRubrics.length > 0
      ? activeRubrics
      : [
          { index: 1, criterion_key: 'PROBLEM_ABSTRACTION', criteria_name: 'Problem Abstraction & Solution Design', weight_percent: 20, max_score: 2.0 },
          { index: 2, criterion_key: 'IMPLEMENTATION_QUALITY', criteria_name: 'Implementation & Code Quality', weight_percent: 30, max_score: 3.0 },
          { index: 3, criterion_key: 'CRITICAL_EVALUATION', criteria_name: 'Critical Evaluation & Verification', weight_percent: 25, max_score: 2.5 },
          { index: 4, criterion_key: 'AI_INTERACTION', criteria_name: 'AI Interaction & Prompt Engineering', weight_percent: 15, max_score: 1.5 },
          { index: 5, criterion_key: 'METACOGNITIVE_REFLECTION', criteria_name: 'Metacognitive Reflection & Transparency', weight_percent: 10, max_score: 1.0 },
        ];

    // 8. Gọi hàm evaluateRubricWithGemini thẩm định đối soát chéo thực tế qua Gemini
    let result;
    try {
      result = await evaluateRubricWithGemini({
        assignmentInfo,
        sourceCode,
        gitHistory: gitHistoryStr,
        aiAuditSummary,
        oralExamLogs,
        activeRubrics: finalActiveRubrics,
        rubricConfigs: finalActiveRubrics,
      });
    } catch (evalErr) {
      console.warn(`[ART-AI] evaluateRubricWithGemini thất bại (${evalErr.status || evalErr.message}). Tự động kích hoạt Khung Thẩm Định Sư Phạm Dự Phòng...`);
      result = generatePedagogicalFallbackResult({
        assignmentInfo,
        sourceCode,
        aiAuditSummary,
        activeRubrics: finalActiveRubrics,
        rubricConfigs: finalActiveRubrics,
      });
    }

    // BƯỚC 3: CƠ CHẾ PHÒNG VỆ HẬU KỲ (BACKEND SCORING GUARDRAILS)
    result = applyScoringGuardrails(result, finalActiveRubrics);

    // 9. Lưu kết quả snapshot vào DB để cố định, không bị tự động thay đổi điểm số khi reload
    try {
      if (auditData.latestVersion && auditData.submission) {
        const safeRiskLevel = normalizeRiskLevel(
          result?.risk_level || result?.audit_integrity?.riskLevel || result?.audit_integrity?.risk_level || 'low'
        );
        const rawScore = Number(result?.audit_integrity?.match_percentage);
        const safeTransparencyScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 95.0;

        await GradingRepository.saveAiEvaluation({
          school_id: tenant.schoolId,
          submission_id: submissionId,
          submission_version_id: auditData.latestVersion.id,
          assignment_id: auditData.submission.assignment_id,
          student_id: auditData.submission.student_id,
          class_id: auditData.submission.class_id,
          pattern: normalizePattern(result?.pattern || 'collaborative_usage'),
          risk_level: safeRiskLevel,
          transparency_score: safeTransparencyScore,
          summary: result?.overall_verdict || result?.ai_verdict || '',
          evaluation_data: result,
          rubric_scores: result?.rubric_scores || null,
          viva_questions: result?.viva_questions || [],
          total_score: result?.total_score_10 ?? result?.total_score ?? null,
          overall_verdict: result?.overall_verdict || result?.ai_verdict || ''
        });
        console.log(`[ART-AI] Saved locked evaluation snapshot to DB for submission ${submissionId} (risk_level: "${safeRiskLevel}")`);
      }
    } catch (saveErr) {
      console.warn('[ART-AI] Failed to save evaluation snapshot to DB:', saveErr.message);
    }

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

/**
 * Chuẩn hóa giá trị risk_level để khớp chính xác check constraint của PostgreSQL:
 * CHECK (risk_level IN ('low', 'medium', 'high'))
 */
function normalizeRiskLevel(rawRisk) {
  if (!rawRisk || typeof rawRisk !== 'string') return 'low';
  const clean = rawRisk.trim().toLowerCase();
  if (clean === 'high' || clean === 'high_risk' || clean === 'danger' || clean === 'critical') {
    return 'high';
  }
  if (clean === 'medium' || clean === 'medium_risk' || clean === 'med' || clean === 'moderate') {
    return 'medium';
  }
  return 'low';
}

/**
 * Chuẩn hóa pattern khớp check constraint của PostgreSQL:
 * CHECK (pattern IN ('critical_engagement', 'collaborative_usage', 'passive_usage', 'high_dependency'))
 */
function normalizePattern(rawPattern) {
  const allowed = ['critical_engagement', 'collaborative_usage', 'passive_usage', 'high_dependency'];
  if (rawPattern && allowed.includes(rawPattern.trim().toLowerCase())) {
    return rawPattern.trim().toLowerCase();
  }
  return 'collaborative_usage';
}

module.exports = GradingService;