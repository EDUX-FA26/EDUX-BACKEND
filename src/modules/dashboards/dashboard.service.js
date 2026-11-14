const DashboardRepository = require('./dashboard.repository');
const { redis } = require('../../config/redis.config');

class DashboardService {

  async getDashboard(tenant) {
    const userId = tenant?.userId || tenant?.id;
    const schoolId = tenant?.schoolId;
    const role = tenant?.role;

    // Nguyên tắc Fail-Closed: Bắt buộc phải có schoolId và userId hợp lệ
    if (!userId || !schoolId || !role) {
      const error = new Error('SCHOOL_CONTEXT_REQUIRED');
      error.status = 400;
      throw error;
    }

    // Cache key phân vùng theo Tenant Scope: dashboard:${schoolId}:${userId}:${role}
    const cacheKey = `dashboard:${schoolId}:${userId}:${role}`;

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

    // 2. Fetch from database with Tenant Scope
    let data;
    switch (role) {
      case 'student':
        data = await this._buildStudentDashboard(userId, schoolId);
        break;

      case 'lecturer':
        data = await this._buildLecturerDashboard(userId, schoolId);
        break;

      case 'school_admin':
      case 'admin': // Hỗ trợ vai trò quản trị trường
        data = await this._buildSchoolAdminDashboard(userId, schoolId);
        break;

      default: {
        const error = new Error('UNKNOWN_ROLE');
        error.status = 403;
        throw error;
      }
    }

    // 3. Save to Redis cache (60 seconds TTL)
    try {
      if (redis.isOpen) {
        await redis.setEx(cacheKey, 60, JSON.stringify(data));
      }
    } catch (err) {
      // Ignore cache write error
    }

    return data;
  }

  async getDashboardNotifications(tenant) {
    const userId = tenant?.userId || tenant?.id;
    const schoolId = tenant?.schoolId;

    if (!userId || !schoolId) {
      const error = new Error('SCHOOL_CONTEXT_REQUIRED');
      error.status = 400;
      throw error;
    }

    const [notifications, unreadCount] = await Promise.all([
      DashboardRepository.getRecentNotifications(userId, schoolId),
      DashboardRepository.getUnreadCount(userId, schoolId),
    ]);

    return {
      notifications,
      unreadCount,
    };
  }

  // ─────────────────────────────────────────────
  // STUDENT
  // ─────────────────────────────────────────────

  async _buildStudentDashboard(userId, schoolId) {
    const [statistics, recentAssignments] = await Promise.all([
      DashboardRepository.getStudentStatistics(userId, schoolId),
      DashboardRepository.getStudentRecentAssignments(userId, schoolId),
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

  async _buildLecturerDashboard(userId, schoolId) {
    const [statistics, recentSubmissions] = await Promise.all([
      DashboardRepository.getLecturerStatistics(userId, schoolId),
      DashboardRepository.getLecturerRecentSubmissions(userId, schoolId),
    ]);

    return {
      role: 'lecturer',
      statistics,
      recentSubmissions,
    };
  }

  // ─────────────────────────────────────────────
  // SCHOOL ADMIN
  // ─────────────────────────────────────────────

  async _buildSchoolAdminDashboard(userId, schoolId) {
    const [statistics, recentUsers] = await Promise.all([
      DashboardRepository.getAdminStatistics(schoolId),
      DashboardRepository.getAdminRecentUsers(schoolId),
    ]);

    return {
      role: 'school_admin',
      statistics,
      recentUsers,
    };
  }
}

module.exports = new DashboardService();