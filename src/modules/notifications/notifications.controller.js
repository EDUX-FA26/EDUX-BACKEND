const NotificationsService = require('./notifications.service');

const NotificationsController = {
  /**
   * GET /api/notifications
   * Lấy tất cả thông báo của user hiện tại (có phân trang)
   */
  async getNotifications(req, res, next) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const result = await NotificationsService.getNotifications({ page, limit }, req.user.id);

      res.status(200).json({
        success: true,
        data: result.data,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.total,
          totalPages: Math.ceil(result.total / Number(limit)) || 1
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/notifications/unread
   * Lấy thông báo chưa đọc (có phân trang + trả về unread_count)
   */
  async getUnreadNotifications(req, res, next) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const result = await NotificationsService.getUnreadNotifications({ page, limit }, req.user.id);

      res.status(200).json({
        success: true,
        data: result.data,
        unread_count: result.total,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.total,
          totalPages: Math.ceil(result.total / Number(limit)) || 1
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/notifications/:id
   * Lấy chi tiết một thông báo
   */
  async getNotificationById(req, res, next) {
    try {
      const notification = await NotificationsService.getNotificationById(req.params.id, req.user.id);
      res.status(200).json({ success: true, data: notification });
    } catch (error) {
      if (error.message === 'NOTIFICATION_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },

  /**
   * PATCH /api/notifications/:id/read
   * Đánh dấu một thông báo là đã đọc
   */
  async markAsRead(req, res, next) {
    try {
      const notification = await NotificationsService.markAsRead(req.params.id, req.user.id);
      res.status(200).json({ success: true, data: notification });
    } catch (error) {
      if (error.message === 'NOTIFICATION_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },

  /**
   * PATCH /api/notifications/read-all
   * Đánh dấu tất cả thông báo chưa đọc là đã đọc
   */
  async markAllAsRead(req, res, next) {
    try {
      const result = await NotificationsService.markAllAsRead(req.user.id);
      res.status(200).json({
        success: true,
        message: `Marked ${result.updated} notification(s) as read`,
        updated: result.updated
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = NotificationsController;
