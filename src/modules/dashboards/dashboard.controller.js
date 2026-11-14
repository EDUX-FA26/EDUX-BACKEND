const DashboardService = require("./dashboard.service");

const DashboardController = {
  /**
   * GET /api/dashboards
   */
  async getDashboard(req, res, next) {
    try {
      const data = await DashboardService.getDashboard(
        req.user,
        req.tenant
      );

      return res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      if (
        error.message === "UNKNOWN_SCHOOL_ROLE" ||
        error.message === "UNKNOWN_ROLE"
      ) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: Invalid school role",
        });
      }

      if (error.message === "SCHOOL_CONTEXT_REQUIRED") {
        return res.status(400).json({
          success: false,
          message: "School context is required",
        });
      }

      next(error);
    }
  },

  /**
   * GET /api/dashboards/notifications
   */
  async getNotifications(req, res, next) {
    try {
      const data =
        await DashboardService.getDashboardNotifications(
          req.user.id,
          req.tenant.schoolId
        );

      return res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  },
};

module.exports = DashboardController;