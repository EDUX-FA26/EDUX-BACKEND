const router = require('express').Router();
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireSchoolContext } = require('../../middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../../middlewares/authorizeSchoolRoles');
const { validate } = require('../../middlewares/validate.middleware');
const { validateQuery, validateUuidParam } = require('../../middlewares/queryValidation.middleware');
const { createSubject, updateSubject, listSubjects } = require('./subjects.validation');
const controller = require('./subjects.controller');

router.use(
  authenticate,
  requireSchoolContext,
  authorizeSchoolRoles('school_admin', 'lecturer', 'student')
);
router.get('/', validateQuery(listSubjects), controller.list);
router.get('/:id', validateUuidParam, controller.get);

router.use(authorizeSchoolRoles('school_admin'));
router.post('/', validate(createSubject), controller.create);
router.patch('/:id', validateUuidParam, validate(updateSubject), controller.update);
router.delete('/:id', validateUuidParam, controller.remove);
router.post('/:id/restore', validateUuidParam, controller.restore);

module.exports = router;
