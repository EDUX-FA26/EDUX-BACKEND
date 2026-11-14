
const router = require('express').Router();

const { authenticate } = require('../../middlewares/auth.middleware');
const { requireSchoolContext } = require('../../middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../../middlewares/authorizeSchoolRoles');
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

router.use(
  authenticate,
  requireSchoolContext,
  authorizeSchoolRoles('school_admin', 'lecturer', 'student')
);

// Get all semesters
router.get(
  '/',
  validateQuery(listSemesters),
  controller.list
);

// Get semester details
router.get(
  '/:id',
  validateUuidParam,
  controller.get
);

// ==========================================
// 2. ADMIN ONLY
// ==========================================

router.use(authorizeSchoolRoles('school_admin'));

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
