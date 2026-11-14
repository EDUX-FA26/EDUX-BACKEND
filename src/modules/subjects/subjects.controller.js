const service = require('./subjects.service');

const wrap = handler => async (req, res, next) => {
  try { await handler(req, res); } catch (error) { next(error); }
};

module.exports = {
  list: wrap(async (req, res) => {
    const result = await service.list(req.validatedQuery, req.tenant);
    res.json({ success: true, ...result, pagination: { page: req.validatedQuery.page, limit: req.validatedQuery.limit, total: result.total } });
  }),
  get: wrap(async (req, res) => res.json({ success: true, data: await service.get(req.params.id, req.tenant) })),
  create: wrap(async (req, res) => res.status(201).json({ success: true, data: await service.create(req.body, req.tenant) })),
  update: wrap(async (req, res) => res.json({ success: true, data: await service.update(req.params.id, req.body, req.tenant) })),
  remove: wrap(async (req, res) => res.json({ success: true, data: await service.remove(req.params.id, req.tenant) })),
  restore: wrap(async (req, res) => res.json({ success: true, data: await service.restore(req.params.id, req.tenant) })),
};
