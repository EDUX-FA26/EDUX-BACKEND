const express = require('express');
const router = express.Router();

const dashboardController = require('./dashboard.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// GET /api/dashboards/notifications — 5 thông báo mới nhất + unreadCount
router.get('/notifications', authenticate, dashboardController.getNotifications);

// GET /api/dashboards — yêu cầu đăng nhập, role xác định từ JWT
router.get('/', authenticate, dashboardController.getDashboard);

module.exports = router;