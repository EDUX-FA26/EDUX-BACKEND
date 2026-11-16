const router = require('express').Router();

const { authenticate } = require('../../middlewares/auth.middleware');
const { requireSchoolContext } = require('../../middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../../middlewares/authorizeSchoolRoles');
const { validate } = require('../../middlewares/validate.middleware');

const ctrl = require('./topics.controller');
const schema = require('./topics.validation');

const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.use(
  authenticate,
  requireSchoolContext,
  authorizeSchoolRoles('lecturer', 'school_admin')
);

// ─────────────────────────────────────────────
// Phase 2B - AI Classification & Generation
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// Lecturer & School Admin Shared
// ─────────────────────────────────────────────

// Catalog list: Lecturer gets approved active topics; Admin with includeAll=true gets full list
router.get(
  '/',
  validate(schema.listQuery, 'query'),
  ctrl.list
);

// Lecturer proposal endpoint
router.post(
  '/proposals',
  validate(schema.createProposal),
  ctrl.createProposal
);

// ─────────────────────────────────────────────
// School Admin Management Endpoints
// ─────────────────────────────────────────────

// Excel Template download
router.get(
  '/template/excel',
  authorizeSchoolRoles('school_admin', 'lecturer'),
  ctrl.downloadTemplate
);

// Import Canonical Topics via Excel / CSV file
router.post(
  '/import-excel',
  authorizeSchoolRoles('school_admin'),
  upload.single('file'),
  ctrl.importExcel
);

// Batch Import Canonical Topics (JSON)
router.post(
  '/batch',
  authorizeSchoolRoles('school_admin'),
  validate(schema.batchImportTopics),
  ctrl.importBatch
);

// Topic Detail (aliases, references, audit)
router.get(
  '/:topicId',
  authorizeSchoolRoles('school_admin'),
  validate(schema.topicIdParam, 'params'),
  ctrl.getDetail
);

// Create Canonical Topic
router.post(
  '/',
  authorizeSchoolRoles('school_admin'),
  validate(schema.createTopic),
  ctrl.create
);

// Edit Canonical Topic
router.patch(
  '/:topicId',
  authorizeSchoolRoles('school_admin'),
  validate(schema.topicIdParam, 'params'),
  validate(schema.updateTopic),
  ctrl.update
);

// Deactivate / Activate Topic (Soft status)
router.patch(
  '/:topicId/status',
  authorizeSchoolRoles('school_admin'),
  validate(schema.topicIdParam, 'params'),
  validate(schema.updateStatus),
  ctrl.setStatus
);

// Confirm Legacy Topic
router.post(
  '/:topicId/confirm-legacy',
  authorizeSchoolRoles('school_admin'),
  validate(schema.topicIdParam, 'params'),
  validate(schema.confirmLegacy),
  ctrl.confirmLegacy
);

// Review Proposal (Approve / Reject)
router.put(
  '/:topicId/review',
  authorizeSchoolRoles('school_admin'),
  validate(schema.topicIdParam, 'params'),
  validate(schema.reviewProposal),
  ctrl.reviewProposal
);

// ─────────────────────────────────────────────
// Alias Management
// ─────────────────────────────────────────────

router.get(
  '/:topicId/aliases',
  authorizeSchoolRoles('school_admin'),
  validate(schema.topicIdParam, 'params'),
  ctrl.listAliases
);

router.post(
  '/:topicId/aliases',
  authorizeSchoolRoles('school_admin'),
  validate(schema.topicIdParam, 'params'),
  validate(schema.createAlias),
  ctrl.addAlias
);

router.delete(
  '/:topicId/aliases/:aliasId',
  authorizeSchoolRoles('school_admin'),
  validate(schema.aliasParams, 'params'),
  ctrl.removeAlias
);

// ─────────────────────────────────────────────
// Phase 2A - Manual Mapping
// ─────────────────────────────────────────────
router.put(
  '/:topicId/flashcards/:flashcardId',
  validate(schema.mappingParams, 'params'),
  validate(schema.mappingBody),
  ctrl.mapFlashcard
);

module.exports = router;
