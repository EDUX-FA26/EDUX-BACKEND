const reportsService = require("./reports.service");

const ReportsController = {
  /**
   * UC 91: GET /api/reports/system
   */
  async getSystemReports(req, res, next) {
    try {
      const data = await reportsService.getSystemReports();
      res.status(200).json({
        success: true,
        message: "Lấy báo cáo hệ thống thành công",
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * UC 92: GET /api/reports/ai-usage
   */
  async getAiUsageStats(req, res, next) {
    try {
      const data = await reportsService.getAiUsageStatistics();
      res.status(200).json({
        success: true,
        message: "Lấy thống kê AI thành công",
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * UC 93: GET /api/reports/audit-logs
   */
  async getAuditLogs(req, res, next) {
    try {
      const data = await reportsService.getAuditLogs();
      res.status(200).json({
        success: true,
        message: "Lấy lịch sử hoạt động thành công",
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * UC 94: GET /api/reports/learning-activity/export
   */
  async exportLearningActivity(req, res, next) {
    try {
      const data = await reportsService.exportLearningActivity();
      res.status(200).json({
        success: true,
        message: "Export dữ liệu học tập thành công",
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * UC 95: GET /api/reports/ai-transparency/export
   */
  async exportAiTransparency(req, res, next) {
    try {
      const data = await reportsService.exportAiTransparency();
      res.status(200).json({
        success: true,
        message: "Export dữ liệu minh bạch AI thành công",
        data,
      });
    } catch (error) {
      next(error);
    }
  },
};

module.exports = ReportsController;
