const DashboardRepository = require('./dashboard.repository');

class DashboardService {

  async getDashboard(user) {
    const { id: userId, role } = user;

    // Notifications luôn lấy cho mọi role
    const [notifications, unreadCount] = await Promise.all([
      DashboardRepository.getRecentNotifications(userId),
      DashboardRepository.getUnreadCount(userId),
    ]);

    switch (role) {
      case 'student':
        return this._buildStudentDashboard(userId, notifications, unreadCount);

      case 'lecturer':
        return this._buildLecturerDashboard(userId, notifications, unreadCount);

      case 'admin':
        return this._buildAdminDashboard(userId, notifications, unreadCount);

      default: {
        const error = new Error('UNKNOWN_ROLE');
        error.status = 403;
        throw error;
      }
    }
  }

  // ─────────────────────────────────────────────
  // STUDENT
  // ─────────────────────────────────────────────

  async _buildStudentDashboard(userId, notifications, unreadCount) {
    const [statistics, recentAssignments] = await Promise.all([
      DashboardRepository.getStudentStatistics(userId),
      DashboardRepository.getStudentRecentAssignments(userId),
    ]);

    return {
      role: 'student',
      statistics,
      recentAssignments,
      notifications,
      unreadCount,
    };
  }

  // ─────────────────────────────────────────────
  // LECTURER
  // ─────────────────────────────────────────────

  async _buildLecturerDashboard(userId, notifications, unreadCount) {
    const [statistics, recentSubmissions] = await Promise.all([
      DashboardRepository.getLecturerStatistics(userId),
      DashboardRepository.getLecturerRecentSubmissions(userId),
    ]);

    return {
      role: 'lecturer',
      statistics,
      recentSubmissions,
      notifications,
      unreadCount,
    };
  }

  // ─────────────────────────────────────────────
  // ADMIN
  // ─────────────────────────────────────────────

  async _buildAdminDashboard(userId, notifications, unreadCount) {
    const [statistics, recentUsers] = await Promise.all([
      DashboardRepository.getAdminStatistics(),
      DashboardRepository.getAdminRecentUsers(),
    ]);

    return {
      role: 'admin',
      statistics,
      recentUsers,
      notifications,
      unreadCount,
    };
  }
}

module.exports = new DashboardService();