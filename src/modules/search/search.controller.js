const service = require('./search.service');

module.exports = {
  async search(req, res, next) {
    try {
      const result = await service.search(req.validatedQuery, req.user);
      res.json({
        success: true,
        ...result,
        pagination: { page: req.validatedQuery.page, limit: req.validatedQuery.limit, total: result.total },
      });
    } catch (error) { next(error); }
  },
};
