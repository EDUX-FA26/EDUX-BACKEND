const NotificationsRepository = require('./notifications.repository');

class NotificationsService {
  /**
   * Lấy danh sách tất cả thông báo của user hiện tại (có phân trang)
   */
  async getNotifications({ page, limit }, userId) {
    const result = await NotificationsRepository.findByUserId({ userId, page, limit });
    return result;
  }

  /**
   * Lấy danh sách thông báo CHƯA ĐỌC của user kèm số lượng tổng
   */
  async getUnreadNotifications({ page, limit }, userId) {
    const result = await NotificationsRepository.findByUserId({ userId, page, limit, is_read: false });
    return result;
  }

  /**
   * Lấy chi tiết một thông báo (chỉ cho phép xem thông báo của chính mình)
   */
  async getNotificationById(id, userId) {
    const notification = await NotificationsRepository.findById(id);
    if (!notification) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }
    if (notification.user_id !== userId) {
      throw new Error('FORBIDDEN');
    }
    return notification;
  }

  /**
   * Đánh dấu một thông báo là đã đọc
   */
  async markAsRead(id, userId) {
    // Kiểm tra tồn tại và quyền truy cập trước
    const notification = await NotificationsRepository.findById(id);
    if (!notification) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }
    if (notification.user_id !== userId) {
      throw new Error('FORBIDDEN');
    }

    // Nếu đã đọc rồi thì trả về luôn không cần UPDATE
    if (notification.is_read) {
      return notification;
    }

    const updated = await NotificationsRepository.markAsRead(id, userId);
    return updated;
  }

  /**
   * Đánh dấu tất cả thông báo chưa đọc là đã đọc
   */
  async markAllAsRead(userId) {
    const updatedCount = await NotificationsRepository.markAllAsRead(userId);
    return { updated: updatedCount };
  }
}

module.exports = new NotificationsService();