const DashboardRepository = require("./dashboard.repository");

const { redis } = require("../../config/redis.config");

class DashboardService {
  async getDashboard(user, tenant) {
    const userId = user?.id;

    const schoolId = tenant?.schoolId;
    const schoolRole = tenant?.role;

    if (!userId || !schoolId || !schoolRole) {
      const error = new Error("SCHOOL_CONTEXT_REQUIRED");
      error.status = 400;
      throw error;
    }

    // Cache riêng theo user, school và role.
    const cacheKey =
      `dashboard:${schoolId}:${schoolRole}:${userId}`;

    // =========================================
    // READ CACHE
    // =========================================

    try {
      if (redis.isOpen) {
        const cached = await redis.get(cacheKey);

        if (cached) {
          return JSON.parse(cached);
        }
      }
    } catch (error) {
      console.warn(
        "Dashboard cache read failed:",
        error.message
      );
    }

    // =========================================
    // BUILD DASHBOARD
    // =========================================

    let data;

    switch (schoolRole) {
      case "student":
        data = await this._buildStudentDashboard(
          userId,
          schoolId
        );
        break;

      case "lecturer":
        data = await this._buildLecturerDashboard(
          userId,
          schoolId
        );
        break;

      case "school_admin":
        data = await this._buildAdminDashboard(
          schoolId
        );
        break;

      default: {
        const error = new Error("UNKNOWN_SCHOOL_ROLE");
        error.status = 403;
        throw error;
      }
    }

    // =========================================
    // SAVE CACHE
    // =========================================

    try {
      if (redis.isOpen) {
        await redis.setEx(
          cacheKey,
          60,
          JSON.stringify(data)
        );
      }
    } catch (error) {
      console.warn(
        "Dashboard cache write failed:",
        error.message
      );
    }

    return data;
  }

  // =========================================
  // NOTIFICATIONS
  // =========================================

  async getDashboardNotifications(userId, schoolId) {
    if (!userId || !schoolId) {
      const error = new Error("SCHOOL_CONTEXT_REQUIRED");
      error.status = 400;
      throw error;
    }

    const [notifications, unreadCount] =
      await Promise.all([
        DashboardRepository.getRecentNotifications(
          userId,
          schoolId
        ),

        DashboardRepository.getUnreadCount(
          userId,
          schoolId
        ),
      ]);

    return {
      notifications,
      unreadCount,
    };
  }

  // =========================================
  // STUDENT
  // =========================================

  async _buildStudentDashboard(userId, schoolId) {
    const [statistics, recentAssignments] =
      await Promise.all([
        DashboardRepository.getStudentStatistics(
          userId,
          schoolId
        ),

        DashboardRepository.getStudentRecentAssignments(
          userId,
          schoolId
        ),
      ]);

    return {
      role: "student",
      statistics,
      recentAssignments,
    };
  }

  // =========================================
  // LECTURER
  // =========================================

  async _buildLecturerDashboard(userId, schoolId) {
    const [statistics, recentSubmissions] =
      await Promise.all([
        DashboardRepository.getLecturerStatistics(
          userId,
          schoolId
        ),

        DashboardRepository.getLecturerRecentSubmissions(
          userId,
          schoolId
        ),
      ]);

    return {
      role: "lecturer",
      statistics,
      recentSubmissions,
    };
  }

  // =========================================
  // SCHOOL ADMIN
  // =========================================

  async _buildAdminDashboard(schoolId) {
    const [statistics, recentUsers] =
      await Promise.all([
        DashboardRepository.getAdminStatistics(
          schoolId
        ),

        DashboardRepository.getAdminRecentUsers(
          schoolId
        ),
      ]);

    return {
      role: "school_admin",
      statistics,
      recentUsers,
    };
  }
}

module.exports = new DashboardService();