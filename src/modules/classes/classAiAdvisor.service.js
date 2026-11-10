const ClassAiAdvisorRepository = require('./classAiAdvisor.repository');
const ClassesService = require('./classes.service');
const { generateClassAiAdvisoryWithGemini } = require('../../config/gemini.config');

const ClassAiAdvisorService = {
  /**
   * Lấy dữ liệu tư vấn sư phạm AI (AI Class Advisor) và danh sách lịch sử của một lớp học
   * @param {string} classId
   * @param {Object} user
   */
  async getAiAdvisor(classId, user) {
    // 1. Kiểm tra quyền truy cập lớp học (Lecturer chỉ xem lớp của mình, Admin xem tất cả)
    await ClassesService.getClassById(classId, user);

    // Bước 1: Lấy toàn bộ danh sách snapshot đã lưu trong bảng class_ai_advisories của classId, sắp xếp theo generated_at DESC
    let snapshots = await ClassAiAdvisorRepository.getAdvisoriesByClassId(classId);

    // Bước 2: Kiểm tra bài tập quá hạn nộp gần nhất (deadline < NOW())
    const latestExpired = await ClassAiAdvisorRepository.getLatestExpiredAssignment(classId);

    if (latestExpired) {
      const hasSnapshot = snapshots.some((s) => s.assignment_id === latestExpired.id);

      // Nếu chưa có snapshot cho bài tập này trong DB:
      // Tổng hợp dữ liệu bài nộp & audit, gọi Gemini AI phân tích, lưu snapshot mới
      if (!hasSnapshot) {
        const newSnapshot = await this.generateAndSaveAdvisory(classId, latestExpired);
        snapshots = [newSnapshot, ...snapshots];
      }
    }

    // Bước 3: Trả về payload cấu trúc gồm bài mới nhất và toàn bộ danh sách lịch sử
    if (!snapshots || snapshots.length === 0) {
      return {
        has_data: false,
        latest_advisory_id: null,
        advisories: []
      };
    }

    const advisories = snapshots.map((row, index) => ({
      id: row.id,
      assignment_id: row.assignment_id,
      assignment_title: row.assignment_title || 'Bài tập',
      is_latest: index === 0,
      generated_at: row.generated_at ? new Date(row.generated_at).toISOString() : new Date().toISOString(),
      class_overview: {
        submission_rate_text: row.submission_rate_text || 'Chưa có thông tin nộp bài',
        avg_ai_transparency: row.avg_ai_transparency || 'N/A'
      },
      common_error_clusters: Array.isArray(row.common_error_clusters)
        ? row.common_error_clusters
        : (typeof row.common_error_clusters === 'string'
          ? JSON.parse(row.common_error_clusters)
          : []),
      next_slot_recommendation: row.next_slot_recommendation || ''
    }));

    return {
      has_data: true,
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

    // Lấy lại danh sách snapshot cập nhật mới nhất
    const snapshots = await ClassAiAdvisorRepository.getAdvisoriesByClassId(classId);

    const advisories = snapshots.map((row, index) => ({
      id: row.id,
      assignment_id: row.assignment_id,
      assignment_title: row.assignment_title || 'Bài tập',
      is_latest: index === 0,
      generated_at: row.generated_at ? new Date(row.generated_at).toISOString() : new Date().toISOString(),
      class_overview: {
        submission_rate_text: row.submission_rate_text || 'Chưa có thông tin nộp bài',
        avg_ai_transparency: row.avg_ai_transparency || 'N/A'
      },
      common_error_clusters: Array.isArray(row.common_error_clusters)
        ? row.common_error_clusters
        : (typeof row.common_error_clusters === 'string'
          ? JSON.parse(row.common_error_clusters)
          : []),
      next_slot_recommendation: row.next_slot_recommendation || ''
    }));

    return {
      has_data: true,
      latest_advisory_id: advisories[0]?.id || null,
      advisories
    };
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
    const submissionRatePercent = totalStudents > 0
      ? ((submittedCount / totalStudents) * 100).toFixed(1)
      : '0.0';
    const defaultRateText = `${submittedCount}/${totalStudents} sinh viên đã nộp bài (${submissionRatePercent}%)`;

    // 4. Tính toán độ minh bạch AI trung bình từ kết quả audit
    const validScores = submissions
      .map((s) => (s.transparency_score != null ? Number(s.transparency_score) : null))
      .filter((val) => val !== null && !isNaN(val) && val >= 0);

    let defaultAvgTransparency = 'N/A (Chưa có dữ liệu audit)';
    if (validScores.length > 0) {
      const avgScore = Math.round(validScores.reduce((acc, cur) => acc + cur, 0) / validScores.length);
      let transparencyLabel = 'Mức độ minh bạch khá tốt';
      if (avgScore >= 80) transparencyLabel = 'Mức độ minh bạch rất tốt';
      else if (avgScore >= 65) transparencyLabel = 'Mức độ minh bạch khá tốt';
      else if (avgScore >= 50) transparencyLabel = 'Mức độ minh bạch trung bình';
      else transparencyLabel = 'Mức độ minh bạch cần cải thiện';

      defaultAvgTransparency = `${avgScore}% (${transparencyLabel})`;
    }

    // 5. Chuẩn bị danh sách audit summaries tóm tắt
    const auditSummaries = submissions.map((s, idx) => ({
      student_name: s.student_name || `Sinh viên ${idx + 1}`,
      transparency: s.transparency_score != null ? `${s.transparency_score}%` : 'N/A',
      risk_level: s.risk_level || 'Chưa đánh giá',
      pattern: s.pattern || 'N/A',
      summary: s.audit_summary || s.overall_verdict || (s.status === 'submitted' ? 'Đã nộp bài, chưa hoàn tất audit' : s.status)
    }));

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
      aiOutput = {
        class_overview: {
          submission_rate_text: defaultRateText,
          avg_ai_transparency: defaultAvgTransparency
        },
        common_error_clusters: [
          `Sinh viên còn lúng túng khi xử lý các ràng buộc và luồng xử lý trong bài tập "${assignment.title}"`,
          'Thiếu cơ chế xử lý ngoại lệ tập trung và kiểm tra tính toàn vẹn dữ liệu đầu vào'
        ],
        next_slot_recommendation: `Giảng viên nên dành 15-20 phút đầu giờ buổi học tiếp theo để demo lại cấu trúc chuẩn của bài tập "${assignment.title}", đồng thời giải đáp trực tiếp các vướng mắc của sinh viên.`
      };
    }

    // 7. Lưu snapshot vào database
    const saved = await ClassAiAdvisorRepository.upsertAdvisory({
      class_id: classId,
      assignment_id: assignment.id,
      assignment_title: assignment.title,
      submission_rate_text: aiOutput.class_overview?.submission_rate_text || defaultRateText,
      avg_ai_transparency: aiOutput.class_overview?.avg_ai_transparency || defaultAvgTransparency,
      common_error_clusters: aiOutput.common_error_clusters || [],
      next_slot_recommendation: aiOutput.next_slot_recommendation || '',
      raw_payload: aiOutput
    });

    return saved;
  }
};

module.exports = ClassAiAdvisorService;

