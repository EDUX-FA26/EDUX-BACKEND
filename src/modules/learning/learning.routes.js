const express = require('express');
const router = express.Router();
const { z } = require('zod');
const ctrl = require('./learning.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const {
  subjectIdParam,
  getActivitiesQuery,
  getHeatmapQuery,
  getLearningProfileQuery,
  getTopicPerformanceQuery,
  postActivity,
} = require('./learning.validation');


const studyPlanDayParams = z.object({
  planDayId: z.string().uuid()
}).strict();

const submitStudyPlanDayBody = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().uuid(),
      selectedAnswer: z.enum(['A', 'B', 'C', 'D'])
    }).strict()
  ).min(1).max(20)
}).strict();

// Toàn bộ route yêu cầu đăng nhập
router.use(authenticate);

// GET /api/learning/profile?subjectId=... — Profile học tập của chính student
router.get('/profile', validate(getLearningProfileQuery, 'query'), ctrl.getLearningProfile);
router.get('/topics/performance', validate(getTopicPerformanceQuery, 'query'), ctrl.getTopicPerformance);

// Phase 3A - Personalized Study Plan Preview
router.get(
  '/study-plan/preview',
  validate(getTopicPerformanceQuery, 'query'),
  ctrl.getStudyPlanPreview
);

// Phase 3B - Flashcards sinh viên còn làm sai
router.get(
  '/study-plan/mistakes',
  validate(getTopicPerformanceQuery, 'query'),
  ctrl.getStudyPlanMistakes
);

// Phase 3C - Tạo và lưu lịch học cá nhân hóa
router.post(
  '/study-plan/generate',
  validate(getTopicPerformanceQuery, 'query'),
  ctrl.generateStudyPlan
);

// Phase 3C - Tạo bài ôn tập AI cho một ngày học
router.post(
  '/study-plan/days/:planDayId/generate',
  ctrl.generateStudyPlanDay
);


// Phase 3D - Lấy bài ôn tập của một ngày
router.get(
  '/study-plan/days/:planDayId',
  validate(studyPlanDayParams, 'params'),
  ctrl.getStudyPlanDay
);

// Phase 3D - Sinh viên nộp bài và nhận kết quả
router.post(
  '/study-plan/days/:planDayId/submit',
  validate(studyPlanDayParams, 'params'),
  validate(submitStudyPlanDayBody),
  ctrl.submitStudyPlanDay
);


// Phase 3D - Xem lại bài đã nộp
router.get(
  '/study-plan/days/:planDayId/result',
  validate(studyPlanDayParams, 'params'),
  ctrl.getStudyPlanDayResult
);
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

