const router = require('express').Router();
const { authenticate } = require('../../middlewares/auth.middleware');
const { authorizeRoles } = require('../../middlewares/rbac.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const ctrl = require('./topics.controller');
const schema = require('./topics.validation');

router.use(authenticate, authorizeRoles('admin', 'lecturer'));
router.get('/', validate(schema.listQuery, 'query'), ctrl.list);
router.post('/', validate(schema.createTopic), ctrl.create);
router.patch('/:topicId', validate(schema.topicIdParam, 'params'), validate(schema.updateTopic), ctrl.update);
router.put('/:topicId/flashcards/:flashcardId', validate(schema.mappingParams, 'params'), validate(schema.mappingBody), ctrl.mapFlashcard);
module.exports = router;
