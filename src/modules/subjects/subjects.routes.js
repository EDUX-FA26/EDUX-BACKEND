const router = require('express').Router();
const { authenticate } = require('../../middlewares/auth.middleware');
const { authorizeRoles } = require('../../middlewares/rbac.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const { validateQuery, validateUuidParam } = require('../../middlewares/queryValidation.middleware');
const { createSubject, updateSubject, listSubjects } = require('./subjects.validation');
const controller = require('./subjects.controller');

router.use(authenticate, authorizeRoles('admin'));
router.get('/', validateQuery(listSubjects), controller.list);
router.get('/:id', validateUuidParam, controller.get);
router.post('/', validate(createSubject), controller.create);
router.patch('/:id', validateUuidParam, validate(updateSubject), controller.update);
router.delete('/:id', validateUuidParam, controller.remove);

module.exports = router;
