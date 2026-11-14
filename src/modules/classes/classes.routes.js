const express = require('express');
const router = express.Router();
const multer = require('multer');

const classesController = require('./classes.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireSchoolContext } = require('../../middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../../middlewares/authorizeSchoolRoles');
const { validate } = require('../../middlewares/validate.middleware');
const { getClassesQuery, getMembersQuery } = require('./classes.validation');
const {
  createClassSchema,
  updateClassSchema,
} = require('../admin/admin.validation');
const adminController = require('../admin/admin.controller');
const classHealthController = require(
  '../class-health/classHealth.controller'
);
const classAiAdvisorController = require('./classAiAdvisor.controller');
const upload = multer({ storage: multer.memoryStorage() });

router.use(authenticate, requireSchoolContext);
// ==========================================
// CLASS HEALTH DASHBOARD
// Admin / Lecturer only
// ==========================================

router.get(
  '/:id/health/snapshot',
  authorizeSchoolRoles('school_admin', 'lecturer'),
  classHealthController.getSnapshot
);

router.post(
  '/:id/health/notify',
  authorizeSchoolRoles('school_admin', 'lecturer'),
  classHealthController.sendBulkNotification
);

// ==========================================
// AI CLASS ADVISOR (UC-LEC-AI-ADVISOR)
// Admin / Lecturer only
// ==========================================

router.get(
  '/:id/ai-advisor',
  authorizeSchoolRoles('school_admin', 'lecturer'),
  classAiAdvisorController.getAiAdvisor
);

router.post(
  '/:id/ai-advisor/refresh',
  authorizeSchoolRoles('school_admin', 'lecturer'),
  classAiAdvisorController.refreshAiAdvisor
);

const AssignmentService = require('../assignments/assignment.service');

// Classes CRUD
router.get('/', validate(getClassesQuery, 'query'), classesController.getClasses);
router.get('/:id', classesController.getClassById);
router.get('/:id/slots', classesController.getSlots);
router.post(
  '/',
  authorizeSchoolRoles('school_admin'),
  validate(createClassSchema),
  adminController.createClass
);
router.patch(
  '/:id',
  authorizeSchoolRoles('school_admin'),
  validate(updateClassSchema),
  adminController.updateClass
);
router.delete(
  '/:id',
  authorizeSchoolRoles('school_admin'),
  adminController.deleteClass
);

// Members
router.get('/:id/members', validate(getMembersQuery, 'query'), classesController.getMembers);
router.post(
  '/:id/members/import',
  authorizeSchoolRoles('school_admin'),
  upload.single('file'),
  classesController.importMembers
);
router.get(
  '/:id/members/export',
  authorizeSchoolRoles('school_admin', 'lecturer'),
  classesController.exportMembers
);
router.delete(
  '/:id/members/:userId',
  authorizeSchoolRoles('school_admin'),
  (req, res, next) => {
    req.params.studentId = req.params.userId;
    return adminController.removeClassStudent(req, res, next);
  }
);

module.exports = router;
