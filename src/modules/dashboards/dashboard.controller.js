const DashboardService = require('./dashboard.service');

const DashboardController = {
  /**
   * GET /api/dashboards
   * Trả về dashboard theo Tenant Context (schoolId, userId, role)
   */
  async getDashboard(req, res, next) {
    try {
      const data = await DashboardService.getDashboard(req.tenant);
      res.status(200).json({ success: true, data });
    } catch (error) {
      if (error.message === 'UNKNOWN_ROLE') {
        return res.status(403).json({ success: false, message: 'Forbidden: Unknown role' });
      }
      if (error.message === 'SCHOOL_CONTEXT_REQUIRED') {
        return res.status(400).json({ success: false, message: 'School context required' });
      }
      next(error);
    }
  },

  /**
   * GET /api/dashboards/notifications
   * Trả về danh sách 5 thông báo mới nhất + unreadCount theo Tenant Context
   */
  async getNotifications(req, res, next) {
    try {
      const data = await DashboardService.getDashboardNotifications(req.tenant);
      res.status(200).json({ success: true, data });
    } catch (error) {
      if (error.message === 'SCHOOL_CONTEXT_REQUIRED') {
        return res.status(400).json({ success: false, message: 'School context required' });
      }
      next(error);
    }
  },
};

module.exports = DashboardController;