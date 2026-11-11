const ClassAiAdvisorRepository = require('./classAiAdvisor.repository');
const ClassesService = require('./classes.service');
const { generateClassAiAdvisoryWithGemini } = require('../../config/gemini.config');

const ClassAiAdvisorService = {
  /**
   * Lấy dữ liệu tư vấn sư phạm AI (AI Class Advisor) và danh sách lịch sử của một lớp học.
   * Dữ liệu danh sách (droplist) đồng bộ 100% với các bài tập/lab đã quá hạn nộp trong bảng assignments.
   * @param {string} classId
   * @param {Object} user
   */
  async getAiAdvisor(classId, user) {
    // 1. Kiểm tra quyền truy cập lớp học (Lecturer chỉ xem lớp của mình, Admin xem tất cả)
    await ClassesService.getClassById(classId, user);

    // Bước 1: Lấy toàn bộ danh sách bài tập/lab đã hết hạn nộp (deadline < NOW()) của lớp từ bảng assignments
    const expiredAssignments = await ClassAiAdvisorRepository.getExpiredAssignmentsByClassId(classId);

    if (!expiredAssignments || expiredAssignments.length === 0) {
      return {
        has_data: false,
        latest_advisory_id: null,
        advisories: []
      };
    }

    // Bước 2: Lấy toàn bộ danh sách snapshot đã có trong bảng class_ai_advisories
    const snapshots = await ClassAiAdvisorRepository.getAdvisoriesByClassId(classId);
    const snapshotMap = new Map(snapshots.map((s) => [s.assignment_id, s]));

    // Bước 3: Đảm bảo bài tập quá hạn mới nhất (index 0) bắt buộc phải có snapshot
    const latestExpired = expiredAssignments[0];
    if (!snapshotMap.has(latestExpired.id)) {
      const newSnapshot = await this.generateAndSaveAdvisory(classId, latestExpired);
      snapshotMap.set(latestExpired.id, newSnapshot);
    }

    // Bước 4: Kiểm tra các bài tập đã hết hạn khác. Nếu bài nào chưa có snapshot trong DB,
    // tự động tổng hợp bài nộp và gọi phân tích để lưu snapshot mới
    for (const assignment of expiredAssignments) {
      if (!snapshotMap.has(assignment.id)) {
        try {
          const generated = await this.generateAndSaveAdvisory(classId, assignment);
          snapshotMap.set(assignment.id, generated);
        } catch (err) {
          console.warn(`[ClassAiAdvisorService] Failed generating advisory for assignment ${assignment.id}:`, err.message);
        }
      }
    }

    // Bước 5: Ghép danh sách advisories theo đúng thứ tự bài tập hết hạn (deadline DESC)
    const advisories = [];
    for (let i = 0; i < expiredAssignments.length; i++) {
      const assignment = expiredAssignments[i];
      const row = snapshotMap.get(assignment.id);
      if (!row) continue;

      const mode = row.mode || row.raw_payload?.mode || 'DEEP_TECHNICAL';
      const rawTransparency = row.avg_ai_transparency || row.raw_payload?.class_overview?.avg_ai_transparency;
      const cleanTransparency = (
        rawTransparency &&
        rawTransparency !== 'null' &&
        rawTransparency !== 'N/A' &&
        !String(rawTransparency).includes('Đang cập nhật') &&
        !String(rawTransparency).includes('Chưa có dữ liệu')
      ) ? rawTransparency : null;

      const deadlineDate = assignment.deadline ? new Date(assignment.deadline) : (row.deadline ? new Date(row.deadline) : null);
      const deadlineFormatted = deadlineDate
        ? deadlineDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '';

      const isLab = (assignment.title || row.assignment_title || '').toLowerCase().includes('lab');
      const typeLabel = isLab ? 'Lab' : 'Bài tập';
      const assignmentTitle = assignment.title || row.assignment_title || 'Bài tập';
      const dropdownLabel = deadlineFormatted
        ? `[${typeLabel}] ${assignmentTitle} - Hạn: ${deadlineFormatted}`
        : `[${typeLabel}] ${assignmentTitle}`;

      advisories.push({
        id: row.id,
        assignment_id: assignment.id,
        assignment_title: assignmentTitle,
        type: isLab ? 'lab' : 'assignment',
        deadline: deadlineDate ? deadlineDate.toISOString() : null,
        deadline_formatted: deadlineFormatted,
        dropdown_label: dropdownLabel,
        is_latest: advisories.length === 0,
        mode,
        generated_at: row.generated_at ? new Date(row.generated_at).toISOString() : new Date().toISOString(),
        class_overview: {
          submission_rate_text: row.submission_rate_text || 'Chưa có thông tin nộp bài',
          avg_ai_transparency: cleanTransparency
        },
        common_error_clusters: Array.isArray(row.common_error_clusters)
          ? row.common_error_clusters
          : (typeof row.common_error_clusters === 'string'
            ? JSON.parse(row.common_error_clusters)
            : []),
        next_slot_recommendation: row.next_slot_recommendation || ''
      });
    }

    return {
      has_data: advisories.length > 0,
      latest_advisory_id: advisories[0]?.id || null,
      advisories
    };
  },

  /**
   * Buộc phân tích lại bài tập quá hạn nộp gần nhất và cập nhật snapshot tương ứng trong DB
   * @param {string} classId
   * @param {Object} user
   */
  async refreshAiAdvisor(classId, user) {
    // 1. Kiểm tra quyền truy cập lớp học
    await ClassesService.getClassById(classId, user);

    // Kiểm tra bài tập quá hạn gần nhất
    const latestExpired = await ClassAiAdvisorRepository.getLatestExpiredAssignment(classId);

    if (!latestExpired) {
      const error = new Error('NO_EXPIRED_ASSIGNMENT');
      error.statusCode = 400;
      throw error;
    }

    // Buộc gọi lại Gemini AI và cập nhật snapshot tương ứng
    await this.generateAndSaveAdvisory(classId, latestExpired);

    // Trả về danh sách advisories đã cập nhật
    return await this.getAiAdvisor(classId, user);
  },

  /**
   * Phân tích và lưu snapshot báo cáo sư phạm AI cho một bài tập
   */
  async generateAndSaveAdvisory(classId, assignment) {
    // 1. Lấy thông tin lớp học và số lượng sinh viên
    const classStats = await ClassAiAdvisorRepository.getClassAndMemberStats(classId);
    let totalStudents = classStats?.total_students || 0;

    // 2. Lấy danh sách bài nộp và báo cáo audit AI của bài tập
    const submissions = await ClassAiAdvisorRepository.getSubmissionsAndAuditForAssignment(classId, assignment.id);
    const submittedCount = submissions.length;

    if (totalStudents < submittedCount) {
      totalStudents = submittedCount;
    }

    // 3. Tính toán tỷ lệ nộp bài
    const numericRate = totalStudents > 0
      ? (submittedCount / totalStudents) * 100
      : 0;
    const submissionRatePercent = numericRate.toFixed(1);
    const defaultRateText = `${submittedCount}/${totalStudents} sinh viên đã nộp bài (${submissionRatePercent}%)`;
    const isLowSubmission = numericRate < 50 || submittedCount < 5;
    const expectedMode = isLowSubmission ? 'PROGRESS_REMINDER' : 'DEEP_TECHNICAL';

    // 4. Tính toán độ minh bạch AI trung bình từ kết quả audit thực tế
    const validScores = submissions
      .map((s) => (s.transparency_score != null ? Number(s.transparency_score) : null))
      .filter((val) => val !== null && !isNaN(val) && val >= 0);

    let defaultAvgTransparency = null;
    if (validScores.length > 0) {
      const avgScore = Math.round(validScores.reduce((acc, cur) => acc + cur, 0) / validScores.length);
      let transparencyLabel = 'Mức độ minh bạch khá tốt';
      if (avgScore >= 80) transparencyLabel = 'Mức độ minh bạch rất tốt';
      else if (avgScore >= 65) transparencyLabel = 'Mức độ minh bạch khá tốt';
      else if (avgScore >= 50) transparencyLabel = 'Mức độ minh bạch trung bình';
      else transparencyLabel = 'Mức độ minh bạch cần cải thiện';

      defaultAvgTransparency = `${avgScore}% (${transparencyLabel})`;
    }

    // 5. Chuẩn bị danh sách audit summaries tóm tắt từ dữ liệu thật
    const auditSummaries = submissions.map((s, idx) => {
      let declarationsSummary = '';
      if (s.ai_declarations_note) {
        try {
          const parsed = typeof s.ai_declarations_note === 'string'
            ? JSON.parse(s.ai_declarations_note)
            : s.ai_declarations_note;
          if (parsed?.declarations) {
            const tools = Object.values(parsed.declarations)
              .map(d => d.aiTool)
              .filter(Boolean);
            if (tools.length) {
              declarationsSummary = `Đã khai báo AI (${[...new Set(tools)].join(', ')}).`;
            }
          }
        } catch (e) {}
      }

      const issueDesc = s.audit_summary || s.overall_verdict || declarationsSummary || (s.status === 'submitted' ? 'Đã nộp bài, chưa hoàn tất audit' : `Trạng thái nộp: ${s.status}`);

      return {
        student_name: s.student_name || `Sinh viên ${idx + 1}`,
        transparency: s.transparency_score != null ? `${s.transparency_score}%` : null,
        risk_level: s.risk_level || null,
        pattern: s.pattern || null,
        summary: issueDesc
      };
    });

    // 6. Gọi Gemini AI
    let aiOutput;
    try {
      aiOutput = await generateClassAiAdvisoryWithGemini({
        assignmentTitle: assignment.title,
        assignmentDescription: assignment.description || assignment.instructions || '',
        classCode: classStats?.class_code || '',
        subjectName: classStats?.subject_name || '',
        totalStudents,
        submittedCount,
        submissionRateText: defaultRateText,
        avgTransparency: defaultAvgTransparency,
        auditSummaries
      });
    } catch (aiErr) {
      console.warn(`[ClassAiAdvisorService] Gemini AI failed for assignment ${assignment.id}, using heuristic fallback:`, aiErr.message);
      if (isLowSubmission) {
        aiOutput = {
          mode: 'PROGRESS_REMINDER',
          class_overview: {
            submission_rate_text: defaultRateText,
            avg_ai_transparency: defaultAvgTransparency
          },
          common_error_clusters: [
            'Tiến độ nộp bài còn chậm; chưa đủ mẫu dữ liệu audit để tổng hợp cụm lỗi kỹ thuật sâu.'
          ],
          next_slot_recommendation: 'Giảng viên nên dành 10-15 phút đầu giờ để rà soát khó khăn, nhắc nhở hạn chót và hướng dẫn lại sinh viên quy trình khai báo AI Audit log trước khi nộp.'
        };
      } else {
        const foundErrors = submissions
          .map(s => s.audit_summary || s.overall_verdict)
          .filter(Boolean);

        let errorClusters = [
          `Sinh viên còn lúng túng khi xử lý các ràng buộc và luồng xử lý trong bài tập "${assignment.title}"`,
          'Thiếu cơ chế xử lý ngoại lệ tập trung và kiểm tra tính toàn vẹn dữ liệu đầu vào'
        ];

        let remedyRecommendation = `Giảng viên nên dành 15-20 phút đầu giờ demo lại kiến thức trọng tâm của bài tập "${assignment.title}" và live-code giải pháp để củng cố kiến thức cho sinh viên.`;

        if (foundErrors.length > 0) {
          const sample = foundErrors[0];
          if (sample.toLowerCase().includes('mật khẩu') || sample.toLowerCase().includes('bcrypt') || sample.toLowerCase().includes('plain-text')) {
            errorClusters = [
              'Lỗi lưu mật khẩu dạng plain-text, chưa tích hợp mã hóa BCrypt/Argon2 an toàn',
              'Thiếu cơ chế xử lý ngoại lệ trùng lặp dữ liệu (Data Integrity Exception)'
            ];
            remedyRecommendation = 'Giảng viên nên dành 15-20 phút đầu giờ demo trực tiếp live-coding giải pháp mã hóa mật khẩu bằng BCrypt và cấu hình Global Exception Handler để chữa dứt điểm lỗi chung cho sinh viên.';
          }
        }

        aiOutput = {
          mode: 'DEEP_TECHNICAL',
          class_overview: {
            submission_rate_text: defaultRateText,
            avg_ai_transparency: defaultAvgTransparency
          },
          common_error_clusters: errorClusters,
          next_slot_recommendation: remedyRecommendation
        };
      }
    }

    const finalMode = aiOutput.mode || expectedMode;
    const finalRawTrans = aiOutput.class_overview?.avg_ai_transparency;
    const finalAvgTransparency = (
      finalRawTrans &&
      finalRawTrans !== 'null' &&
      finalRawTrans !== 'N/A' &&
      !String(finalRawTrans).includes('Đang cập nhật') &&
      !String(finalRawTrans).includes('Chưa có dữ liệu')
    ) ? finalRawTrans : (defaultAvgTransparency || null);

    // 7. Lưu snapshot vào database
    const saved = await ClassAiAdvisorRepository.upsertAdvisory({
      class_id: classId,
      assignment_id: assignment.id,
      assignment_title: assignment.title,
      mode: finalMode,
      submission_rate_text: aiOutput.class_overview?.submission_rate_text || defaultRateText,
      avg_ai_transparency: finalAvgTransparency,
      common_error_clusters: aiOutput.common_error_clusters || [],
      next_slot_recommendation: aiOutput.next_slot_recommendation || '',
      raw_payload: { ...aiOutput, mode: finalMode, class_overview: { ...aiOutput.class_overview, avg_ai_transparency: finalAvgTransparency } }
    });

    return saved;
  }
};

module.exports = ClassAiAdvisorService;

