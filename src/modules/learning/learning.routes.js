const express = require('express');
const router = express.Router();

const ctrl = require('./learning.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const {
  subjectIdParam,
  getActivitiesQuery,
  getHeatmapQuery,
  postActivity,
} = require('./learning.validation');

// Toàn bộ route yêu cầu đăng nhập
router.use(authenticate);

// ─────────────────────────────────────────────
// STREAK ROUTES
// ─────────────────────────────────────────────

// GET  /api/learning/streak              — Trả về tất cả streak của user theo từng subject
router.get('/streak', ctrl.getAllSubjectStreaks);

// GET  /api/learning/streak/:subjectId   — Trả về streak của 1 subject
router.get('/streak/:subjectId', validate(subjectIdParam, 'params'), ctrl.getSubjectStreak);

// POST /api/learning/streak/:subjectId/recover — Khôi phục streak cho 1 subject
router.post('/streak/:subjectId/recover', validate(subjectIdParam, 'params'), ctrl.recoverSubjectStreak);

// ─────────────────────────────────────────────
// ACTIVITY & HEATMAP ROUTES
// ─────────────────────────────────────────────

// GET  /api/learning/activity           — Lịch sử learning activity của user
router.get('/activity', validate(getActivitiesQuery, 'query'), ctrl.getActivityHistory);

// GET  /api/learning/heatmap            — Dữ liệu Heatmap
router.get('/heatmap', validate(getHeatmapQuery, 'query'), ctrl.getHeatmap);

// POST /api/learning/activity           — Generic activity endpoint xác thực qua flashcard deck
router.post('/activity', validate(postActivity), ctrl.recordActivity);

module.exports = router;
