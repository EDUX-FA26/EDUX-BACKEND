const DashboardRepository = require('./dashboard.repository');
const { redis } = require('../../config/redis.config');

class DashboardService {

  async getDashboard(user) {
    const { id: userId, role } = user;
    const cacheKey = `dashboard:${userId}`;

    // 1. Check Redis cache
    try {
      if (redis.isOpen) {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }
    } catch (err) {
      // Ignore cache error, fallback to DB
    }

    // 2. Fetch from database
    let data;
    switch (role) {
      case 'student':
        data = await this._buildStudentDashboard(userId);
        break;

      case 'lecturer':
        data = await this._buildLecturerDashboard(userId);
        break;

      case 'admin':
        data = await this._buildAdminDashboard(userId);
        break;

      default: {
        const error = new Error('UNKNOWN_ROLE');
        error.status = 403;
        throw error;
      }
    }

    // 3. Save to Redis cache (15 seconds TTL)
    try {
      if (redis.isOpen) {
        await redis.setEx(cacheKey, 15, JSON.stringify(data));
      }
    } catch (err) {
      // Ignore cache write error
    }

    return data;
  }

  async getDashboardNotifications(userId) {
    const [notifications, unreadCount] = await Promise.all([
      DashboardRepository.getRecentNotifications(userId),
      DashboardRepository.getUnreadCount(userId),
    ]);

    return {
      notifications,
      unreadCount,
    };
  }

  // ─────────────────────────────────────────────
  // STUDENT
  // ─────────────────────────────────────────────

  async _buildStudentDashboard(userId) {
    const [statistics, recentAssignments] = await Promise.all([
      DashboardRepository.getStudentStatistics(userId),
      DashboardRepository.getStudentRecentAssignments(userId),
    ]);

    return {
      role: 'student',
      statistics,
      recentAssignments,
    };
  }

  // ─────────────────────────────────────────────
  // LECTURER
  // ─────────────────────────────────────────────

  async _buildLecturerDashboard(userId) {
    const [statistics, recentSubmissions] = await Promise.all([
      DashboardRepository.getLecturerStatistics(userId),
      DashboardRepository.getLecturerRecentSubmissions(userId),
    ]);

    return {
      role: 'lecturer',
      statistics,
      recentSubmissions,
    };
  }

  // ─────────────────────────────────────────────
  // ADMIN
  // ─────────────────────────────────────────────

  async _buildAdminDashboard(userId) {
    const [statistics, recentUsers] = await Promise.all([
      DashboardRepository.getAdminStatistics(),
      DashboardRepository.getAdminRecentUsers(),
    ]);

    return {
      role: 'admin',
      statistics,
      recentUsers,
    };
  }
}

module.exports = new DashboardService();