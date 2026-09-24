const router = require('express').Router();
const { authenticate } = require('../../middlewares/auth.middleware');
const { authorizeRoles } = require('../../middlewares/rbac.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const { validateQuery, validateUuidParam } = require('../../middlewares/queryValidation.middleware');
const { createSemester, updateSemester, listSemesters } = require('./semesters.validation');
const controller = require('./semesters.controller');

router.use(authenticate, authorizeRoles('admin'));
router.get('/', validateQuery(listSemesters), controller.list);
router.get('/:id', validateUuidParam, controller.get);
router.post('/', validate(createSemester), controller.create);
router.patch('/:id', validateUuidParam, validate(updateSemester), controller.update);
router.post('/:id/activate', validateUuidParam, controller.activate);
router.post('/:id/close', validateUuidParam, controller.close);
router.post('/:id/lock', validateUuidParam, controller.lock);

module.exports = router;
