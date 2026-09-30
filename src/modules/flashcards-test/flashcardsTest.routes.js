const express = require('express');
const router = express.Router();

const ctrl = require('./flashcardsTest.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// Tất cả endpoints yêu cầu authenticated user
router.use(authenticate);

// POST /api/flashcards/decks/:deckId/tests — Tạo bài kiểm tra mới cho deck
router.post('/decks/:deckId/tests', ctrl.createTest);

// GET  /api/flashcards/tests/:testId       — Lấy thông tin bài kiểm tra đang làm
router.get('/tests/:testId', ctrl.getTest);

// POST /api/flashcards/tests/:testId/submit — Nộp bài kiểm tra & chấm điểm
router.post('/tests/:testId/submit', ctrl.submitTest);

// GET  /api/flashcards/tests/:testId/result — Xem kết quả chi tiết bài kiểm tra đã nộp
router.get('/tests/:testId/result', ctrl.getTestResult);

module.exports = router;
