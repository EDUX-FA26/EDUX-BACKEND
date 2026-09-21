const express = require('express');
const multer = require('multer');

const AssignmentController = {
  ...require('./assignment.controller')
};
const { authenticate } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const {
  createAssignmentSchema,
  updateAssignmentSchema,
  updateStatusSchema,
  queryAssignmentsSchema
} = require('./assignment.validation');
const assignmentMaterialRoutes = require('../assignment-materials/assignmentMaterial.routes');

const upload = multer({ storage: multer.memoryStorage() });

const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
  }
  next();
};

const router = express.Router();
router.use(authenticate);

// CRUD cho assignments
router.post(
  '/', 
  authorize('admin', 'lecturer'), 
  upload.array('materials'), 
  validate(createAssignmentSchema), 
  AssignmentController.createAssignment
);

router.get(
  '/', 
  validate(queryAssignmentsSchema, 'query'), 
  AssignmentController.getAssignments
);

router.get(
  '/:id', 
  AssignmentController.getAssignmentById
);

router.patch(
  '/:id', 
  authorize('admin', 'lecturer'), 
  validate(updateAssignmentSchema), 
  AssignmentController.updateAssignment
);

router.patch(
  '/:id/publish-status', 
  authorize('admin', 'lecturer'), 
  validate(updateStatusSchema), 
  AssignmentController.updatePublishStatus
);

router.delete(
  '/:id', 
  authorize('admin', 'lecturer'), 
  AssignmentController.deleteAssignment
);

// Khai báo sub-router cho assignment-materials
router.use('/:assignmentId/materials', assignmentMaterialRoutes);

module.exports = router;