const express = require('express');
const multer = require('multer');

const classMaterialController = require('./classMaterial.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireSchoolContext } = require('../../middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../../middlewares/authorizeSchoolRoles');
const { validate } = require('../../middlewares/validate.middleware');
const {
  createClassMaterial,
  updateClassMaterial,
  listClassMaterialsQuery,
} = require('./classMaterial.validation');

const upload = multer({ storage: multer.memoryStorage() });

// -----------------------------------------------------------------------
// Router A: routes gắn vào /api/classes/:classId/materials
// Dùng mergeParams: true để kế thừa :classId từ parent router
// -----------------------------------------------------------------------
const classIdRouter = express.Router({ mergeParams: true });
classIdRouter.use(authenticate, requireSchoolContext);

// GET  /api/classes/:classId/materials   (UC17 — danh sách)
classIdRouter.get(
  '/',
  authorizeSchoolRoles('school_admin', 'lecturer', 'student'),
  validate(listClassMaterialsQuery, 'query'),
  classMaterialController.listMaterials
);

// POST /api/classes/:classId/materials   (UC19 — upload, chỉ lecturer / school_admin)
classIdRouter.post(
  '/',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  upload.single('file'),
  validate(createClassMaterial),
  classMaterialController.uploadMaterial
);

// -----------------------------------------------------------------------
// Router B: routes gắn vào /api/materials/classes
// Tất cả đều cần xác thực và ngữ cảnh trường
// -----------------------------------------------------------------------
const materialIdRouter = express.Router();
materialIdRouter.use(authenticate, requireSchoolContext);

// GET    /api/materials/classes/:id           (UC17 — chi tiết)
materialIdRouter.get(
  '/:id',
  authorizeSchoolRoles('school_admin', 'lecturer', 'student'),
  classMaterialController.getMaterialById
);

// GET    /api/materials/classes/:id/download  (UC18 — presigned URL)
materialIdRouter.get(
  '/:id/download',
  authorizeSchoolRoles('school_admin', 'lecturer', 'student'),
  classMaterialController.downloadMaterial
);

// PATCH  /api/materials/classes/:id           (UC20 — update metadata, chỉ lecturer / school_admin)
materialIdRouter.patch(
  '/:id',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  validate(updateClassMaterial),
  classMaterialController.updateMaterial
);

// DELETE /api/materials/classes/:id           (UC21 — xóa, chỉ lecturer / school_admin)
materialIdRouter.delete(
  '/:id',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  classMaterialController.deleteMaterial
);

module.exports = { classIdRouter, materialIdRouter };

