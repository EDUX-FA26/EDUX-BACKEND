const service = require('./semesters.service');

const wrap = handler => async (req, res, next) => {
  try { await handler(req, res); } catch (error) { next(error); }
};

module.exports = {
  list: wrap(async (req, res) => {
    const result = await service.list(req.validatedQuery);
    res.json({ success: true, ...result, pagination: { page: req.validatedQuery.page, limit: req.validatedQuery.limit, total: result.total } });
  }),
  get: wrap(async (req, res) => res.json({ success: true, data: await service.get(req.params.id) })),
  create: wrap(async (req, res) => res.status(201).json({ success: true, data: await service.create(req.body) })),
  update: wrap(async (req, res) => res.json({ success: true, data: await service.update(req.params.id, req.body) })),
  activate: wrap(async (req, res) => res.json({ success: true, data: await service.transition(req.params.id, 'activate') })),
  close: wrap(async (req, res) => res.json({ success: true, data: await service.transition(req.params.id, 'close') })),
  lock: wrap(async (req, res) => res.json({ success: true, data: await service.transition(req.params.id, 'lock') })),
};
