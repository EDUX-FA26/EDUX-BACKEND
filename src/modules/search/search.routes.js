const router = require('express').Router();
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireSchoolContext } = require('../../middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../../middlewares/authorizeSchoolRoles');
const { validateQuery } = require('../../middlewares/queryValidation.middleware');
const { searchQuery } = require('./search.validation');
const controller = require('./search.controller');

router.get(
  '/',
  authenticate,
  requireSchoolContext,
  authorizeSchoolRoles('student', 'lecturer', 'school_admin'),
  validateQuery(searchQuery),
  controller.search
);

module.exports = router;
