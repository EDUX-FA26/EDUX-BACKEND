const TodosService = require('./todos.service');

const ok = (res, data, message = 'OK', status = 200) =>
  res.status(status).json({ success: true, message, data });

const TodosController = {
  create: async (req, res) =>
    ok(res, await TodosService.create(req.user, req.valid.body), 'Todo created', 201),

  createFromStudyPlan: async (req, res) => {
    const result = await TodosService.createFromStudyPlan(req.user, req.valid.body);
    return ok(res, result, result.created ? 'Todo created from study plan' : 'Todo already exists', result.created ? 201 : 200);
  },

  suggestions: async (req, res) =>
    ok(res, await TodosService.suggestions(req.user, req.valid.query), 'Study plan suggestions'),

  list: async (req, res) => ok(res, await TodosService.list(req.user, req.valid.query), 'Todos'),

  stats: async (req, res) => ok(res, await TodosService.stats(req.user), 'Todo stats'),

  getById: async (req, res) => ok(res, await TodosService.getById(req.user, req.valid.params.id), 'Todo'),

  update: async (req, res) =>
    ok(res, await TodosService.update(req.user, req.valid.params.id, req.valid.body), 'Todo updated'),

  changeStatus: async (req, res) =>
    ok(res, await TodosService.changeStatus(req.user, req.valid.params.id, req.valid.body), 'Todo status updated'),

  remove: async (req, res) =>
    ok(res, await TodosService.remove(req.user, req.valid.params.id), 'Todo deleted'),
};

module.exports = TodosController;

