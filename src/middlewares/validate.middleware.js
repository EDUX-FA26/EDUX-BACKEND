const validate = (schema) => {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      console.error("Zod Validation Error Caught:", error);
      if (error.name === "ZodError") {
        const issues = error.errors || error.issues || [];
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: issues.map(err => ({
            field: err.path ? err.path.join('.') : '',
            message: err.message
          }))
        });
      }
      next(error);
    }
  };
};

module.exports = { validate };
