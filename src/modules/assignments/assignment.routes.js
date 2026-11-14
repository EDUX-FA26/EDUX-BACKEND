const express = require('express');
const multer = require('multer');

const AssignmentController = {
  ...require('./assignment.controller')
};
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireSchoolContext } = require('../../middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../../middlewares/authorizeSchoolRoles');
const { validate } = require('../../middlewares/validate.middleware');
const {
  createAssignmentSchema,
  updateAssignmentSchema,
  updateStatusSchema,
  queryAssignmentsSchema
} = require('./assignment.validation');
const assignmentMaterialRoutes = require('../assignment-materials/assignmentMaterial.routes');
const SubmissionController = require('../submissions/submission.controller');
const { queryAssignmentSubmissionsSchema } = require('../submissions/submission.validation');

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();
router.use(authenticate, requireSchoolContext);

// CRUD cho assignments
router.post(
  '/', 
  authorizeSchoolRoles('school_admin', 'lecturer'), 
  upload.array('materials'), 
  validate(createAssignmentSchema), 
  AssignmentController.createAssignment
);

router.get(
  '/', 
  authorizeSchoolRoles('school_admin', 'lecturer', 'student'),
  validate(queryAssignmentsSchema, 'query'), 
  AssignmentController.getAssignments
);

// Danh sách bài nộp của 1 assignment (cho lecturer/admin/student)
router.get(
  '/:assignmentId/submissions',
  authorize('admin', 'lecturer', 'student'),
  validate(queryAssignmentSubmissionsSchema, 'query'),
  SubmissionController.getAssignmentSubmissions
);

router.get(
  '/:id', 
  authorizeSchoolRoles('school_admin', 'lecturer', 'student'),
  AssignmentController.getAssignmentById
);

router.patch(
  '/:id', 
  authorizeSchoolRoles('school_admin', 'lecturer'), 
  upload.array('materials'),
  validate(updateAssignmentSchema), 
  AssignmentController.updateAssignment
);

router.put(
  '/:id', 
  authorize('admin', 'lecturer'), 
  upload.array('materials'),
  validate(updateAssignmentSchema), 
  AssignmentController.updateAssignment
);

router.patch(
  '/:id/publish-status', 
  authorizeSchoolRoles('school_admin', 'lecturer'), 
  validate(updateStatusSchema), 
  AssignmentController.updatePublishStatus
);

router.delete(
  '/:id', 
  authorizeSchoolRoles('school_admin', 'lecturer'), 
  AssignmentController.deleteAssignment
);

// Khai báo sub-router cho assignment-materials
router.use('/:assignmentId/materials', assignmentMaterialRoutes);

module.exports = router;
