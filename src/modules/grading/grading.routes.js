const express = require('express');

const gradingController = require('./grading.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireSchoolContext } = require('../../middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../../middlewares/authorizeSchoolRoles');
const { validate } = require('../../middlewares/validate.middleware');
const { createGrade, updateGrade } = require('./grading.validation');

// ─── Router: /api/grades ─────────────────────────────────────────────────────
const gradesRouter = express.Router();
gradesRouter.use(authenticate, requireSchoolContext);

// UC 37 – Create Grade + Feedback  (chỉ lecturer / school_admin)
// POST	/api/grades
gradesRouter.post(
  '/',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  validate(createGrade),
  gradingController.createGrade
);

// UC 38 – Update Grade + Feedback  (chỉ lecturer / school_admin)
// PATCH	/api/grades/:id
gradesRouter.patch(
  '/:id',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  validate(updateGrade),
  gradingController.updateGrade
);

// UC 39 – View Grade  (lecturer + school_admin + student xem của mình)
// GET	/api/grades/:id
gradesRouter.get(
  '/:id',
  authorizeSchoolRoles('lecturer', 'school_admin', 'student'),
  gradingController.getGrade
);

// ─── Router: /api/gradebooks ──────────────────────────────────────────────────
const gradebooksRouter = express.Router();
gradebooksRouter.use(authenticate, requireSchoolContext);

// UC 41 – View Gradebook  (chỉ lecturer / school_admin)
// GET	/api/gradebooks/:classId
gradebooksRouter.get(
  '/:classId',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  gradingController.getGradebook
);

// UC 42 – Export Gradebook  (chỉ lecturer / school_admin)
// GET /api/gradebooks/:classId/export?format=xlsx|csv
gradebooksRouter.get(
  '/:classId/export',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  gradingController.exportGradebook
);

// ─── Router: AI Rubric Grading ───────────────────────────────────────────────
// Lưu ý: gradingRouter được mount tại "/api" trong app.js nên KHÔNG dùng gradingRouter.use(...)
// để tránh chặn các route "/api/*" khác chưa bật schoolScoped.
const gradingRouter = express.Router();

// POST /submissions/:submissionId/ai-rubric (chỉ lecturer / school_admin)
gradingRouter.post(
  '/submissions/:submissionId/ai-rubric',
  authenticate,
  requireSchoolContext,
  authorizeSchoolRoles('lecturer', 'school_admin'),
  gradingController.handleAuditRubric
);

// Alias on gradesRouter: POST /api/grades/submissions/:submissionId/ai-rubric
gradesRouter.post(
  '/submissions/:submissionId/ai-rubric',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  gradingController.handleAuditRubric
);

module.exports = { gradesRouter, gradebooksRouter, gradingRouter };