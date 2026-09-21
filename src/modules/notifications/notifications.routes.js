const express = require('express');
const router = express.Router();

const notificationsController = require('./notifications.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const { getNotificationsQuery } = require('./notifications.validation');

// Tất cả các route đều yêu cầu đăng nhập
router.use(authenticate);

// GET  /api/notifications              - Lấy tất cả thông báo (có phân trang)
router.get('/', validate(getNotificationsQuery, 'query'), notificationsController.getNotifications);

// GET  /api/notifications/unread       - Lấy thông báo chưa đọc
router.get('/unread', validate(getNotificationsQuery, 'query'), notificationsController.getUnreadNotifications);

// PATCH /api/notifications/read-all   - Đánh dấu tất cả là đã đọc
router.put('/read-all', notificationsController.markAllAsRead);

// GET  /api/notifications/:id          - Lấy chi tiết một thông báo
router.get('/:id', notificationsController.getNotificationById);

// PATCH /api/notifications/:id/read   - Đánh dấu một thông báo là đã đọc
router.put('/:id/read', notificationsController.markAsRead);

module.exports = router;
