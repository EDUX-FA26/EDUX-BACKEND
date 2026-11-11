
const router = require('express').Router();

const { authenticate } = require('../../middlewares/auth.middleware');
const { authorizeRoles } = require('../../middlewares/rbac.middleware');
const { validate } = require('../../middlewares/validate.middleware');

const {
  validateQuery,
  validateUuidParam
} = require('../../middlewares/queryValidation.middleware');

const {
  createSemester,
  updateSemester,
  listSemesters
} = require('./semesters.validation');

const controller = require('./semesters.controller');

// ==========================================
// 1. ALL AUTHENTICATED USERS
// Admin, Lecturer, Student
// ==========================================

router.use(authenticate);

// Get all semesters
router.get(
  '/',
  authorizeRoles('admin', 'lecturer', 'student'),
  validateQuery(listSemesters),
  controller.list
);

// Get semester details
router.get(
  '/:id',
  authorizeRoles('admin', 'lecturer', 'student'),
  validateUuidParam,
  controller.get
);

// ==========================================
// 2. ADMIN ONLY
// ==========================================

router.use(authorizeRoles('admin'));

// Create semester
router.post(
  '/',
  validate(createSemester),
  controller.create
);

// Update semester
router.patch(
  '/:id',
  validateUuidParam,
  validate(updateSemester),
  controller.update
);

// Activate semester
router.post(
  '/:id/activate',
  validateUuidParam,
  controller.activate
);

// Close semester
router.post(
  '/:id/close',
  validateUuidParam,
  controller.close
);

// Reopen semester
router.post(
  '/:id/reopen',
  validateUuidParam,
  controller.reopen
);

// Lock semester
router.post(
  '/:id/lock',
  validateUuidParam,
  controller.lock
);

module.exports = router;
