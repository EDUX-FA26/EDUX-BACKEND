const express = require("express");
const router = express.Router();

const dashboardController = require("./dashboard.controller");

const {
  authenticate,
} = require("../../middlewares/auth.middleware");

const {
  requireSchoolContext,
} = require("../../middlewares/requireSchoolContext");

// =========================================
// GLOBAL MIDDLEWARE
// =========================================

// 1. Xác thực JWT
// 2. Xác minh trường và membership đang hoạt động
router.use(authenticate);
router.use(requireSchoolContext);

// =========================================
// DASHBOARD
// =========================================

// GET /api/dashboards
// Dashboard theo role của trường hiện tại
router.get(
  "/",
  dashboardController.getDashboard
);

// =========================================
// NOTIFICATIONS
// =========================================

// GET /api/dashboards/notifications
// 5 thông báo mới nhất + unreadCount
router.get(
  "/notifications",
  dashboardController.getNotifications
);

module.exports = router;