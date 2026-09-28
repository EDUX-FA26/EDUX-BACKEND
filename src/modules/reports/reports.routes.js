const express = require("express");
const router = express.Router();
const reportsController = require("./reports.controller");
const { authenticate } = require("../../middlewares/auth.middleware");
const { authorize } = require("../../middlewares/role.middleware");

// Tất cả APIs báo cáo đều yêu cầu đăng nhập và có role admin (hoặc bổ sung lecturer tuỳ yêu cầu)
router.use(authenticate, authorize(["admin"]));

// UC 91: View System Reports
router.get("/system", reportsController.getSystemReports);

// UC 92: View AI Usage Statistics
router.get("/ai-usage", reportsController.getAiUsageStats);

// UC 93: View Audit Logs
router.get("/audit-logs", reportsController.getAuditLogs);

// UC 94: Export Learning Activity
router.get("/learning-activity/export", reportsController.exportLearningActivity);

// UC 95: Export AI Transparency
router.get("/ai-transparency/export", reportsController.exportAiTransparency);

module.exports = router;
