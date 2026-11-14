const express = require('express');
const router = express.Router();

const dashboardController = require('./dashboard.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireSchoolContext } = require('../../middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../../middlewares/authorizeSchoolRoles');

// Tất cả các route School Dashboard đều yêu cầu authenticate, requireSchoolContext và role hợp lệ trong trường
router.use(authenticate);
router.use(requireSchoolContext);
router.use(authorizeSchoolRoles('student', 'lecturer', 'school_admin'));

// GET /api/dashboards/notifications — 5 thông báo mới nhất + unreadCount trong Tenant Context
router.get('/notifications', dashboardController.getNotifications);

// GET /api/dashboards — Dashboard tổng quan theo Tenant Context và vai trò trong trường
router.get('/', dashboardController.getDashboard);

module.exports = router;