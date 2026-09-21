const express = require('express');

const gradingController = require('./grading.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const { createGrade, updateGrade } = require('./grading.validation');

// ─── authorize helper (inline, consistent với các module khác) ───────────────
const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
  }
  next();
};

// ─── Router: /api/grades ─────────────────────────────────────────────────────
const gradesRouter = express.Router();
gradesRouter.use(authenticate);

// UC 37 – Create Grade + Feedback  (chỉ lecturer / admin)
// POST	/api/grades
gradesRouter.post(
  '/',
  authorize('lecturer', 'admin'),
  validate(createGrade),
  gradingController.createGrade
);

// UC 38 – Update Grade + Feedback  (chỉ lecturer / admin)
// PATCH	/api/grades/:id

gradesRouter.patch(
  '/:id',
  authorize('lecturer', 'admin'),
  validate(updateGrade),
  gradingController.updateGrade
);

// UC 39 – View Grade  (lecturer + student xem của mình)
// GET	/api/grades/:id

gradesRouter.get(
  '/:id',
  gradingController.getGrade
);

// ─── Router: /api/gradebooks ──────────────────────────────────────────────────
const gradebooksRouter = express.Router();
gradebooksRouter.use(authenticate);

// UC 41 – View Gradebook  (chỉ lecturer / admin)
// GET	/api/gradebooks/:classId
gradebooksRouter.get(
  '/:classId',
  authorize('lecturer', 'admin'),
  gradingController.getGradebook
);

// UC 42 – Export Gradebook  (chỉ lecturer / admin)
// GET /api/gradebooks/:classId/export?format=xlsx|csv
gradebooksRouter.get(
  '/:classId/export',
  authorize('lecturer', 'admin'),
  gradingController.exportGradebook
);

module.exports = { gradesRouter, gradebooksRouter };