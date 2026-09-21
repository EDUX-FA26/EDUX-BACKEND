const DashboardService = require('./dashboard.service');

const DashboardController = {
  /**
   * GET /api/dashboard
   * Trả về dashboard theo role của user đang đăng nhập (từ JWT)
   */
  async getDashboard(req, res, next) {
    try {
      const data = await DashboardService.getDashboard(req.user);
      res.status(200).json({ success: true, data });
    } catch (error) {
      if (error.message === 'UNKNOWN_ROLE') {
        return res.status(403).json({ success: false, message: 'Forbidden: Unknown role' });
      }
      next(error);
    }
  },
};

module.exports = DashboardController;