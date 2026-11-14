const express = require('express');
const multer = require('multer');

const assignmentMaterialController = require('./assignmentMaterial.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireSchoolContext } = require('../../middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../../middlewares/authorizeSchoolRoles');
const { validate } = require('../../middlewares/validate.middleware');
const {
  createAssignmentMaterial,
  updateAssignmentMaterial,
  listAssignmentMaterialsQuery,
} = require('./assignmentMaterial.validation');

const upload = multer({ storage: multer.memoryStorage() });

// -----------------------------------------------------------------------
// Router: gắn vào /api/assignments/:assignmentId/materials
// mergeParams: true để kế thừa :assignmentId từ parent router
// -----------------------------------------------------------------------
const router = express.Router({ mergeParams: true });
router.use(authenticate, requireSchoolContext);

// GET  /api/assignments/:assignmentId/materials
// (lecturer + student enrolled + school_admin đều có thể xem)
router.get(
  '/',
  authorizeSchoolRoles('school_admin', 'lecturer', 'student'),
  validate(listAssignmentMaterialsQuery, 'query'),
  assignmentMaterialController.listMaterials
);

// POST /api/assignments/:assignmentId/materials  (chỉ lecturer / school_admin)
router.post(
  '/',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  upload.single('file'),
  validate(createAssignmentMaterial),
  assignmentMaterialController.uploadMaterial
);

// GET  /api/assignments/:assignmentId/materials/:materialId
router.get(
  '/:materialId',
  authorizeSchoolRoles('school_admin', 'lecturer', 'student'),
  assignmentMaterialController.getMaterialById
);

// GET  /api/assignments/:assignmentId/materials/:materialId/download
router.get(
  '/:materialId/download',
  authorizeSchoolRoles('school_admin', 'lecturer', 'student'),
  assignmentMaterialController.downloadMaterial
);

// PATCH /api/assignments/:assignmentId/materials/:materialId  (chỉ lecturer / school_admin)
router.patch(
  '/:materialId',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  validate(updateAssignmentMaterial),
  assignmentMaterialController.updateMaterial
);

// DELETE /api/assignments/:assignmentId/materials/:materialId  (chỉ lecturer / school_admin)
router.delete(
  '/:materialId',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  assignmentMaterialController.deleteMaterial
);

module.exports = router;

