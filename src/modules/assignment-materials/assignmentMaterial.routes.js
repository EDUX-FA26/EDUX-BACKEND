const express = require('express');
const multer = require('multer');

const assignmentMaterialController = require('./assignmentMaterial.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const {
  createAssignmentMaterial,
  updateAssignmentMaterial,
  listAssignmentMaterialsQuery,
} = require('./assignmentMaterial.validation');

const upload = multer({ storage: multer.memoryStorage() });

// -----------------------------------------------------------------------
// authorize helper
// -----------------------------------------------------------------------
const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
  }
  next();
};

// -----------------------------------------------------------------------
// Router: gắn vào /api/assignments/:assignmentId/materials
// mergeParams: true để kế thừa :assignmentId từ parent router
// -----------------------------------------------------------------------
const router = express.Router({ mergeParams: true });
router.use(authenticate);

// GET  /api/assignments/:assignmentId/materials
// (lecturer + student enrolled đều có thể xem)
router.get(
  '/',
  validate(listAssignmentMaterialsQuery, 'query'),
  assignmentMaterialController.listMaterials
);

// POST /api/assignments/:assignmentId/materials  (chỉ lecturer)
router.post(
  '/',
  authorize('lecturer', 'admin'),
  upload.single('file'),
  validate(createAssignmentMaterial),
  assignmentMaterialController.uploadMaterial
);

// GET  /api/assignments/:assignmentId/materials/:materialId
router.get(
  '/:materialId',
  assignmentMaterialController.getMaterialById
);

// GET  /api/assignments/:assignmentId/materials/:materialId/download
router.get(
  '/:materialId/download',
  assignmentMaterialController.downloadMaterial
);

// PATCH /api/assignments/:assignmentId/materials/:materialId  (chỉ lecturer)
router.patch(
  '/:materialId',
  authorize('lecturer', 'admin'),
  validate(updateAssignmentMaterial),
  assignmentMaterialController.updateMaterial
);

// DELETE /api/assignments/:assignmentId/materials/:materialId  (chỉ lecturer)
router.delete(
  '/:materialId',
  authorize('lecturer', 'admin'),
  assignmentMaterialController.deleteMaterial
);

module.exports = router;

