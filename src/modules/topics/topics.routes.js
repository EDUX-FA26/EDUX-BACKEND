
const router = require('express').Router();

const { authenticate } = require('../../middlewares/auth.middleware');
const { authorizeRoles } = require('../../middlewares/rbac.middleware');
const { validate } = require('../../middlewares/validate.middleware');

const ctrl = require('./topics.controller');
const schema = require('./topics.validation');

router.use(
  authenticate,
  authorizeRoles('admin', 'lecturer')
);

// Phase 2B - AI Classification
router.post(
  '/ai/classify',
  validate(schema.classifyFlashcard),
  ctrl.classifyFlashcard
);

router.post(
  '/ai/classifications/:flashcardId/review',
  validate(schema.classificationFlashcardParam, 'params'),
  validate(schema.reviewClassification),
  ctrl.reviewClassification
);

router.post(
  '/ai/generate-similar',
  validate(schema.generateSimilar),
  ctrl.generateSimilar
);

// Phase 2A - Topic Management
router.get(
  '/',
  validate(schema.listQuery, 'query'),
  ctrl.list
);

router.post(
  '/',
  validate(schema.createTopic),
  ctrl.create
);

router.patch(
  '/:topicId',
  validate(schema.topicIdParam, 'params'),
  validate(schema.updateTopic),
  ctrl.update
);

router.put(
  '/:topicId/flashcards/:flashcardId',
  validate(schema.mappingParams, 'params'),
  validate(schema.mappingBody),
  ctrl.mapFlashcard
);

module.exports = router;
