const ClassAiAdvisorRepository = require('./classAiAdvisor.repository');
const ClassesService = require('./classes.service');
const { generateClassAiAdvisoryWithGemini } = require('../../config/gemini.config');

function formatAdvisories(snapshots) {
  if (!snapshots || snapshots.length === 0) {
    return {
      has_data: false,
      latest_advisory_id: null,
      advisories: []
    };
  }

  const advisories = snapshots.map((row, idx) => {
    const mode = row.mode || row.raw_payload?.mode || 'DEEP_TECHNICAL';

    const deadlineDate = row.deadline ? new Date(row.deadline) : null;
    const deadlineFormatted = deadlineDate
      ? deadlineDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '';

    const isLab = (row.assignment_title || '').toLowerCase().includes('lab');
    const typeLabel = isLab ? 'Lab' : 'Bài tập';
    const assignmentTitle = row.assignment_title || 'Bài tập';
    const dropdownLabel = deadlineFormatted
      ? `[${typeLabel}] ${assignmentTitle} - Hạn: ${deadlineFormatted}`
      : `[${typeLabel}] ${assignmentTitle}`;

    let errorClusters = [];
    if (Array.isArray(row.common_error_clusters)) {
      errorClusters = row.common_error_clusters;
    } else if (typeof row.common_error_clusters === 'string') {
      try {
        errorClusters = JSON.parse(row.common_error_clusters);
      } catch (e) {
        errorClusters = [row.common_error_clusters];
      }
    }

    return {
      id: row.id,
      assignment_id: row.assignment_id,
      assignment_title: assignmentTitle,
      type: isLab ? 'lab' : 'assignment',
      deadline: deadlineDate ? deadlineDate.toISOString() : null,
      deadline_formatted: deadlineFormatted,
      dropdown_label: dropdownLabel,
      is_latest: idx === 0,
      mode,
      generated_at: row.generated_at ? new Date(row.generated_at).toISOString() : new Date().toISOString(),
      class_overview: {
        submission_rate_text: row.submission_rate_text || 'Chưa có thông tin nộp bài',
        avg_ai_transparency: null
      },
      common_error_clusters: errorClusters,
      next_slot_recommendation: row.next_slot_recommendation || ''
    };
  });

  return {
    has_data: advisories.length > 0,
    latest_advisory_id: advisories[0]?.id || null,
    advisories
  };
}

const ClassAiAdvisorService = {
  /**
   * Lấy dữ liệu tư vấn sư phạm AI (AI Class Advisor) của lớp học.
   * Quy trình Cache-First:
   * 1. Kiểm tra snapshot đã lưu trong bảng class_ai_advisories.
   * 2. Nếu ĐÃ CÓ trong DB: Trả về NGAY LẬP TỨC từ cache, không gọi lại Gemini.
   * 3. Nếu CHƯA CÓ: Tự động tổng hợp dữ liệu bài tập gần nhất có bài nộp/hết hạn và chạy phân tích lưu vào DB.
   * @param {string} classId
   * @param {Object} user
   */
  async getAiAdvisor(classId, user) {
    // 1. Kiểm tra quyền truy cập lớp học (Lecturer chỉ xem lớp của mình, Admin xem tất cả)
    await ClassesService.getClassById(classId, user);

    // 2. KIỂM TRA SNAPSHOT ĐÃ LƯU TRONG DATABASE (CACHE-FIRST)
    const cachedSnapshots = await ClassAiAdvisorRepository.getAdvisoriesByClassId(classId);

    if (cachedSnapshots && cachedSnapshots.length > 0) {
      return formatAdvisories(cachedSnapshots);
    }

    // 3. NẾU CHƯA CÓ TRONG DB: TỰ ĐỘNG CHẠY LẦN ĐẦU (Automatic First Run)
    // Tìm bài tập gần nhất của lớp có bài nộp hoặc đã kết thúc deadline
    const targetAssignment = await ClassAiAdvisorRepository.getLatestAssignmentForAdvisory(classId);

    if (!targetAssignment) {
      return {
        has_data: false,
        latest_advisory_id: null,
        advisories: []
      };
    }

    // Gom dữ liệu bài nộp thật từ DB, gọi Gemini phân tích và INSERT CỨNG vào class_ai_advisories
    let savedSnapshot = null;
    try {
      savedSnapshot = await this.generateAndSaveAdvisory(classId, targetAssignment);
    } catch (err) {
      console.warn(`[ClassAiAdvisorService] Automatic initial run failed for assignment ${targetAssignment.id}:`, err.message);
    }

    // Lấy lại danh sách sau khi đã lưu snapshot
    let updatedSnapshots = await ClassAiAdvisorRepository.getAdvisoriesByClassId(classId);
    if ((!updatedSnapshots || updatedSnapshots.length === 0) && savedSnapshot) {
      updatedSnapshots = [savedSnapshot];
    }
    return formatAdvisories(updatedSnapshots);
  },

  /**
   * Buộc phân tích lại bài tập và cập nhật snapshot tương ứng trong DB khi Giảng viên nhấn nút "Chạy lại"
   * @param {string} classId
   * @param {Object} user
   */
  async refreshAiAdvisor(classId, user) {
    // 1. Kiểm tra quyền truy cập lớp học
    await ClassesService.getClassById(classId, user);

    // Kiểm tra bài tập phù hợp nhất để phân tích lại
    const targetAssignment = await ClassAiAdvisorRepository.getLatestAssignmentForAdvisory(classId);

    if (!targetAssignment) {
      return {
        has_data: false,
        latest_advisory_id: null,
        advisories: []
      };
    }

    // Buộc gọi lại Gemini AI và cập nhật snapshot tương ứng
    await this.generateAndSaveAdvisory(classId, targetAssignment);

    // Trả về danh sách advisories đã cập nhật từ DB snapshot
    const updatedSnapshots = await ClassAiAdvisorRepository.getAdvisoriesByClassId(classId);
    return formatAdvisories(updatedSnapshots);
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

    // 4. Bỏ qua tính toán độ minh bạch AI trung bình thừa (tập trung 100% vào Tỷ lệ nộp bài & Cụm lỗi kỹ thuật)
    const defaultAvgTransparency = null;

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

    // 7. Lưu snapshot vào database
    const saved = await ClassAiAdvisorRepository.upsertAdvisory({
      class_id: classId,
      assignment_id: assignment.id,
      assignment_title: assignment.title,
      mode: finalMode,
      submission_rate_text: aiOutput.class_overview?.submission_rate_text || defaultRateText,
      avg_ai_transparency: null,
      common_error_clusters: aiOutput.common_error_clusters || [],
      next_slot_recommendation: aiOutput.next_slot_recommendation || '',
      raw_payload: { ...aiOutput, mode: finalMode, class_overview: { ...aiOutput.class_overview, avg_ai_transparency: null } }
    });

    return saved;
  }
};

module.exports = ClassAiAdvisorService;

