const ClassAiAdvisorService = require('./classAiAdvisor.service');

const ClassAiAdvisorController = {
  /**
   * GET /api/classes/:classId/ai-advisor
   */
  async getAiAdvisor(req, res, next) {
    try {
      const classId = req.params.classId || req.params.id;
      const result = await ClassAiAdvisorService.getAiAdvisor(classId, req.user);
      return res.status(200).json({
        success: true,
        ...result,
        data: result
      });
    } catch (error) {
      if (error.message === 'CLASS_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Class not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
      }
      next(error);
    }
  },

  /**
   * POST /api/classes/:classId/ai-advisor/refresh
   */
  async refreshAiAdvisor(req, res, next) {
    try {
      const classId = req.params.classId || req.params.id;
      const result = await ClassAiAdvisorService.refreshAiAdvisor(classId, req.user);
      return res.status(200).json({
        success: true,
        message: 'Làm mới phân tích AI thành công',
        ...result,
        data: result
      });
    } catch (error) {
      if (error.message === 'CLASS_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Class not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
      }
      if (error.message === 'NO_EXPIRED_ASSIGNMENT' || error.statusCode === 400) {
        return res.status(400).json({
          success: false,
          message: 'Lớp học chưa có bài tập nào kết thúc hạn nộp để phân tích lại.'
        });
      }
      next(error);
    }
  }
};

module.exports = ClassAiAdvisorController;

