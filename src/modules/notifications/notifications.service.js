const NotificationsRepository = require('./notifications.repository');

class NotificationsService {
  /**
   * Trích xuất userId và schoolId từ tenant object hoặc userId đơn thuần (hỗ trợ backward compatibility)
   */
  _resolveContext(tenantOrUserId) {
    if (tenantOrUserId && typeof tenantOrUserId === 'object') {
      return {
        userId: tenantOrUserId.userId,
        schoolId: tenantOrUserId.schoolId,
        role: tenantOrUserId.role,
      };
    }
    return {
      userId: tenantOrUserId,
      schoolId: null,
      role: null,
    };
  }

  /**
   * Lấy danh sách tất cả thông báo của user hiện tại theo Tenant Context (có phân trang)
   */
  async getNotifications({ page, limit }, tenantOrUserId) {
    const { userId, schoolId } = this._resolveContext(tenantOrUserId);
    const result = await NotificationsRepository.findByUserId({
      userId,
      schoolId,
      page,
      limit,
    });
    return result;
  }

  /**
   * Lấy danh sách thông báo CHƯA ĐỌC của user kèm số lượng tổng theo Tenant Context
   */
  async getUnreadNotifications({ page, limit }, tenantOrUserId) {
    const { userId, schoolId } = this._resolveContext(tenantOrUserId);
    const result = await NotificationsRepository.findByUserId({
      userId,
      schoolId,
      page,
      limit,
      is_read: false,
    });
    return result;
  }

  /**
   * Lấy chi tiết một thông báo (chỉ cho phép xem thông báo của chính mình trong phạm vi School/Platform)
   */
  async getNotificationById(id, tenantOrUserId) {
    const { userId, schoolId } = this._resolveContext(tenantOrUserId);
    const notification = await NotificationsRepository.findById(id, schoolId);
    if (!notification) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }
    if (notification.user_id !== userId) {
      throw new Error('FORBIDDEN');
    }
    // Defense-in-depth: nếu là thông báo thuộc trường khác thì chặn
    if (notification.notification_scope === 'school' && schoolId && notification.school_id !== schoolId) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }
    return notification;
  }

  /**
   * Đánh dấu một thông báo là đã đọc trong Tenant Context
   */
  async markAsRead(id, tenantOrUserId) {
    const { userId, schoolId } = this._resolveContext(tenantOrUserId);
    // Kiểm tra tồn tại và quyền truy cập trước
    const notification = await NotificationsRepository.findById(id, schoolId);
    if (!notification) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }
    if (notification.user_id !== userId) {
      throw new Error('FORBIDDEN');
    }
    if (notification.notification_scope === 'school' && schoolId && notification.school_id !== schoolId) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }

    // Nếu đã đọc rồi thì trả về luôn không cần UPDATE
    if (notification.is_read) {
      return notification;
    }

    const updated = await NotificationsRepository.markAsRead(id, userId, schoolId);
    return updated;
  }

  /**
   * Đánh dấu tất cả thông báo chưa đọc là đã đọc trong Tenant Context
   */
  async markAllAsRead(tenantOrUserId) {
    const { userId, schoolId } = this._resolveContext(tenantOrUserId);
    const updatedCount = await NotificationsRepository.markAllAsRead(userId, schoolId);
    return { updated: updatedCount };
  }
}

module.exports = new NotificationsService();