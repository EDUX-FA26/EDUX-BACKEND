const ClassAiAdvisorService = require('./classAiAdvisor.service');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ClassAiAdvisorController = {
  /**
   * GET /api/classes/:classId/ai-advisor
   * Luôn trả về HTTP 200 với định dạng chuẩn { has_data: boolean, advisories: [...] }
   * Tuyệt đối không throw 500 hoặc 404 làm gián đoạn luồng Frontend.
   */
  async getAiAdvisor(req, res, next) {
    try {
      const classId = req.params.classId || req.params.id;
      if (!classId || !UUID_REGEX.test(classId)) {
        return res.status(200).json({
          success: true,
          has_data: false,
          latest_advisory_id: null,
          advisories: [],
          data: {
            has_data: false,
            latest_advisory_id: null,
            advisories: []
          }
        });
      }

      const result = await ClassAiAdvisorService.getAiAdvisor(classId, req.tenant);
      return res.status(200).json({
        success: true,
        has_data: result?.has_data ?? false,
        latest_advisory_id: result?.latest_advisory_id ?? null,
        advisories: result?.advisories || [],
        data: result
      });
    } catch (error) {
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
      }

      console.warn(`[ClassAiAdvisorController.getAiAdvisor] Handled fallback for class ${req.params.classId || req.params.id}:`, error.message);
      return res.status(200).json({
        success: true,
        has_data: false,
        latest_advisory_id: null,
        advisories: [],
        data: {
          has_data: false,
          latest_advisory_id: null,
          advisories: []
        }
      });
    }
  },

  /**
   * POST /api/classes/:classId/ai-advisor/refresh
   */
  async refreshAiAdvisor(req, res, next) {
    try {
      const classId = req.params.classId || req.params.id;
      if (!classId || !UUID_REGEX.test(classId)) {
        return res.status(200).json({
          success: true,
          message: 'Mã lớp không hợp lệ',
          has_data: false,
          latest_advisory_id: null,
          advisories: [],
          data: {
            has_data: false,
            latest_advisory_id: null,
            advisories: []
          }
        });
      }

      const result = await ClassAiAdvisorService.refreshAiAdvisor(classId, req.tenant);
      return res.status(200).json({
        success: true,
        message: 'Làm mới phân tích AI thành công',
        has_data: result?.has_data ?? false,
        latest_advisory_id: result?.latest_advisory_id ?? null,
        advisories: result?.advisories || [],
        data: result
      });
    } catch (error) {
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
      }
      if (error.message === 'NO_EXPIRED_ASSIGNMENT' || error.statusCode === 400 || error.message === 'CLASS_NOT_FOUND') {
        return res.status(200).json({
          success: true,
          message: 'Lớp học chưa có bài tập nào kết thúc hạn nộp để phân tích lại.',
          has_data: false,
          latest_advisory_id: null,
          advisories: [],
          data: {
            has_data: false,
            latest_advisory_id: null,
            advisories: []
          }
        });
      }
      console.warn(`[ClassAiAdvisorController.refreshAiAdvisor] Handled fallback for class ${req.params.classId || req.params.id}:`, error.message);
      return res.status(200).json({
        success: true,
        message: 'Chưa thể làm mới khuyến nghị lúc này',
        has_data: false,
        latest_advisory_id: null,
        advisories: [],
        data: {
          has_data: false,
          latest_advisory_id: null,
          advisories: []
        }
      });
    }
  }
};

module.exports = ClassAiAdvisorController;

