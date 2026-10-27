const { AppError } = require('../utils/appError');

/**
 * Validate params/query/body bằng Zod và lưu kết quả vào `req.valid`.
 * (Express 5: `req.query` là getter, không gán lại được nên không ghi đè.)
 */
const parseRequest = (schemas) => (req, res, next) => {
  const valid = {};

  for (const key of ['params', 'query', 'body']) {
    if (!schemas[key]) continue;

    const result = schemas[key].safeParse(req[key] ?? {});
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    valid[key] = result.data;
  }

  req.valid = valid;
  next();
};

/** Error handler dùng ở cuối router: map AppError và lỗi unique của PostgreSQL. */
// eslint-disable-next-line no-unused-vars
const appErrorHandler = (err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      message: err.message,
      ...(err.data !== undefined ? { data: err.data } : {}),
    });
  }
  return next(err);
};

module.exports = { parseRequest, appErrorHandler };

