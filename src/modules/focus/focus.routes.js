const express = require('express');
const ctrl = require('./focus.controller');
const v = require('./focus.validation');
const { authenticate } = require('../../middlewares/auth.middleware');
const { parseRequest, appErrorHandler } = require('../../middlewares/zodRequest.middleware');

const router = express.Router();

router.use(authenticate);

// ── Nhóm A — Focus Session ───────────────────────────────
router.post('/sessions', parseRequest({ body: v.startSession }), ctrl.startSession);
router.get('/sessions', parseRequest({ query: v.listSessionsQuery }), ctrl.listSessions);

// Các route tĩnh phải khai báo TRƯỚC '/sessions/:id'
router.get('/sessions/current', ctrl.getCurrent);
router.get('/sessions/history', parseRequest({ query: v.historyQuery }), ctrl.history);

router.get('/sessions/:id', parseRequest({ params: v.idParams }), ctrl.getSession);
router.patch('/sessions/:id', parseRequest({ params: v.idParams, body: v.patchSession }), ctrl.patchSession);
router.post('/sessions/:id/pause', parseRequest({ params: v.idParams, body: v.emptyBody }), ctrl.pause);
router.post('/sessions/:id/resume', parseRequest({ params: v.idParams, body: v.emptyBody }), ctrl.resume);
router.post('/sessions/:id/finish', parseRequest({ params: v.idParams, body: v.finishSession }), ctrl.finish);

// ── Nhóm D — Thống kê ────────────────────────────────────
router.get('/stats/summary', parseRequest({ query: v.summaryQuery }), ctrl.summary);
router.get('/stats/daily', parseRequest({ query: v.dailyQuery }), ctrl.daily);
router.get('/stats/weekly', parseRequest({ query: v.weeklyQuery }), ctrl.weekly);

// ── Nhóm E — Cấu hình phòng học ──────────────────────────
router.get('/preferences', ctrl.getPreferences);
router.put('/preferences', parseRequest({ body: v.putPreferences }), ctrl.putPreferences);

router.use(appErrorHandler);

module.exports = router;

