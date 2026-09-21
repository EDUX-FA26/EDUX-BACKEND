const express = require('express');
const multer = require('multer');

const classMaterialController = require('./classMaterial.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const {
  createClassMaterial,
  updateClassMaterial,
  listClassMaterialsQuery,
} = require('./classMaterial.validation');

const upload = multer({ storage: multer.memoryStorage() });

// -----------------------------------------------------------------------
// authorize helper — kiểm tra role, dùng chung trong file này
// -----------------------------------------------------------------------
const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
  }
  next();
};

// -----------------------------------------------------------------------
// Router A: routes gắn vào /api/classes/:classId/materials
// Dùng mergeParams: true để kế thừa :classId từ parent router
// -----------------------------------------------------------------------
const classIdRouter = express.Router({ mergeParams: true });
classIdRouter.use(authenticate);

// GET  /api/classes/:classId/materials   (UC17 — danh sách)
classIdRouter.get(
  '/',
  validate(listClassMaterialsQuery, 'query'),
  classMaterialController.listMaterials
);

// POST /api/classes/:classId/materials   (UC19 — upload, chỉ lecturer)
classIdRouter.post(
  '/',
  authorize('lecturer', 'admin'),
  upload.single('file'),
  validate(createClassMaterial),
  classMaterialController.uploadMaterial
);

// -----------------------------------------------------------------------
// Router B: routes gắn vào /api/materials/classes
// Tất cả đều cần xác thực
// -----------------------------------------------------------------------
const materialIdRouter = express.Router();
materialIdRouter.use(authenticate);

// GET    /api/materials/classes/:id           (UC17 — chi tiết)
materialIdRouter.get(
  '/:id',
  classMaterialController.getMaterialById
);

// GET    /api/materials/classes/:id/download  (UC18 — presigned URL)
materialIdRouter.get(
  '/:id/download',
  classMaterialController.downloadMaterial
);

// PATCH  /api/materials/classes/:id           (UC20 — update metadata, chỉ lecturer)
materialIdRouter.patch(
  '/:id',
  authorize('lecturer', 'admin'),
  validate(updateClassMaterial),
  classMaterialController.updateMaterial
);

// DELETE /api/materials/classes/:id           (UC21 — xóa, chỉ lecturer)
materialIdRouter.delete(
  '/:id',
  authorize('lecturer', 'admin'),
  classMaterialController.deleteMaterial
);

module.exports = { classIdRouter, materialIdRouter };

