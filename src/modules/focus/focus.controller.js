const FocusService = require('./focus.service');

const ok = (res, data, message = 'OK', status = 200) =>
  res.status(status).json({ success: true, message, data });

const FocusController = {
  startSession: async (req, res) =>
    ok(res, await FocusService.start(req.user.id, req.valid.body), 'Focus session started', 201),

  getCurrent: async (req, res) =>
    ok(res, await FocusService.getCurrent(req.user.id), 'Current focus session'),

  listSessions: async (req, res) =>
    ok(res, await FocusService.list(req.user.id, req.valid.query), 'Focus sessions'),

  history: async (req, res) =>
    ok(res, await FocusService.history(req.user.id, req.valid.query), 'Focus history'),

  getSession: async (req, res) =>
    ok(res, await FocusService.getById(req.user.id, req.valid.params.id), 'Focus session'),

  patchSession: async (req, res) =>
    ok(res, await FocusService.patch(req.user.id, req.valid.params.id, req.valid.body), 'Focus session updated'),

  pause: async (req, res) =>
    ok(res, await FocusService.pause(req.user.id, req.valid.params.id), 'Focus session paused'),

  resume: async (req, res) =>
    ok(res, await FocusService.resume(req.user.id, req.valid.params.id), 'Focus session resumed'),

  adjust: async (req, res) =>
    ok(res, await FocusService.adjust(req.user.id, req.valid.params.id, req.valid.body), 'Focus session adjusted'),

  finish: async (req, res) =>
    ok(res, await FocusService.finish(req.user.id, req.valid.params.id, req.valid.body), 'Focus session finished'),

  summary: async (req, res) =>
    ok(res, await FocusService.summary(req.user.id, req.valid.query), 'Focus summary'),

  daily: async (req, res) =>
    ok(res, await FocusService.daily(req.user.id, req.valid.query), 'Daily focus stats'),

  weekly: async (req, res) =>
    ok(res, await FocusService.weekly(req.user.id, req.valid.query), 'Weekly focus stats'),

  overview: async (req, res) =>
    ok(res, await FocusService.overview(req.user.id, req.valid.query), 'Focus stats overview'),

  statsDaily: async (req, res) =>
    ok(res, await FocusService.dailyStats(req.user.id, req.valid.query), 'Focus stats daily'),

  heatmap: async (req, res) =>
    ok(res, await FocusService.heatmap(req.user.id, req.valid.query), 'Focus stats heatmap'),

  distribution: async (req, res) =>
    ok(res, await FocusService.distribution(req.user.id, req.valid.query), 'Focus stats distribution'),

  todos: async (req, res) =>
    ok(res, await FocusService.todosStats(req.user.id, req.valid.query), 'Focus stats todos'),

  insights: async (req, res) =>
    ok(res, await FocusService.insights(req.user.id, req.valid.query), 'Focus stats insights'),

  getPreferences: async (req, res) =>
    ok(res, await FocusService.getPreferences(req.user.id), 'Focus preferences'),

  putPreferences: async (req, res) =>
    ok(res, await FocusService.savePreferences(req.user.id, req.valid.body), 'Focus preferences saved'),
};

module.exports = FocusController;
