const express = require('express');
const router = express.Router();

const dashboardController = require('./dashboard.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// GET /api/dashboard — yêu cầu đăng nhập, role xác định từ JWT
router.get('/', authenticate, dashboardController.getDashboard);

module.exports = router;