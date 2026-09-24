const { z } = require('zod');

const validateQuery = schema => (req, res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: result.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })),
    });
  }
  req.validatedQuery = result.data;
  next();
};

const validateUuidParam = (req, res, next) => {
  if (!z.uuid().safeParse(req.params.id).success) {
    return res.status(400).json({ success: false, message: 'Invalid ID' });
  }
  next();
};

module.exports = { validateQuery, validateUuidParam };
