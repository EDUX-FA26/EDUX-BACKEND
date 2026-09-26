const reportsRepository = require("./reports.repository");

const ReportsService = {
  /**
   * UC 91: Lấy báo cáo tổng quan hệ thống
   */
  async getSystemReports() {
    return await reportsRepository.getSystemStats();
  },

  /**
   * UC 92: Lấy thống kê sử dụng AI
   */
  async getAiUsageStatistics() {
    return await reportsRepository.getAiUsageStats();
  },

  /**
   * UC 93: Lấy Audit Logs
   */
  async getAuditLogs() {
    return await reportsRepository.getAuditLogs();
  },

  /**
   * UC 94: Lấy dữ liệu Export Learning Activity
   */
  async exportLearningActivity() {
    const data = await reportsRepository.getLearningActivityExportData();
    // Ở đây ta có thể parse sang định dạng CSV nếu muốn trả về dạng file, 
    // nhưng để linh hoạt cho FE xử lý (hoặc dùng thư viện ExcelJS),
    // ta trả về raw JSON array.
    return data;
  },

  /**
   * UC 95: Lấy dữ liệu Export AI Transparency
   */
  async exportAiTransparency() {
    const data = await reportsRepository.getAiTransparencyExportData();
    return data;
  }
};

module.exports = ReportsService;
