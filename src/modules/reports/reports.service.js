const reportsRepository = require("./reports.repository");

function validateTenantContext(tenant) {
  const schoolId = tenant?.schoolId;
  const userId = tenant?.userId || tenant?.id;
  const role = tenant?.role;

  if (!schoolId || !userId || !role) {
    const error = new Error("SCHOOL_CONTEXT_REQUIRED");
    error.status = 400;
    throw error;
  }
  return { schoolId, userId, role };
}

const ReportsService = {
  /**
   * UC 91: Lấy báo cáo tổng quan hệ thống trong phạm vi trường học
   */
  async getSystemReports(tenant) {
    const { schoolId, userId, role } = validateTenantContext(tenant);
    return await reportsRepository.getSystemStats(schoolId, userId, role);
  },

  /**
   * UC 92: Lấy thống kê sử dụng AI trong phạm vi trường học
   */
  async getAiUsageStatistics(tenant) {
    const { schoolId, userId, role } = validateTenantContext(tenant);
    return await reportsRepository.getAiUsageStats(schoolId, userId, role);
  },

  /**
   * UC 93: Lấy Audit Logs trong phạm vi trường học
   */
  async getAuditLogs(tenant) {
    const { schoolId, userId, role } = validateTenantContext(tenant);
    return await reportsRepository.getAuditLogs(schoolId, userId, role);
  },

  /**
   * UC 94: Lấy dữ liệu Export Learning Activity trong phạm vi trường học
   */
  async exportLearningActivity(tenant) {
    const { schoolId, userId, role } = validateTenantContext(tenant);
    return await reportsRepository.getLearningActivityExportData(schoolId, userId, role);
  },

  /**
   * UC 95: Lấy dữ liệu Export AI Transparency trong phạm vi trường học
   */
  async exportAiTransparency(tenant) {
    const { schoolId, userId, role } = validateTenantContext(tenant);
    return await reportsRepository.getAiTransparencyExportData(schoolId, userId, role);
  },
};

module.exports = ReportsService;
