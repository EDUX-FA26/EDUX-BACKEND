const express = require('express');
const { upload } = require('../../middlewares/upload.middleware');

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

// -----------------------------------------------------------------------
// Router C: routes gắn vào /api/slots và /api/classes/:classId/slots
// -----------------------------------------------------------------------
const slotMaterialsRouter = express.Router({ mergeParams: true });
slotMaterialsRouter.use(authenticate, requireSchoolContext);

// GET  /api/slots/:slotId/materials (hoặc /api/classes/:classId/slots/:slotId/materials)
slotMaterialsRouter.get(
  '/:slotId/materials',
  authorizeSchoolRoles('school_admin', 'lecturer', 'student'),
  classMaterialController.listSlotMaterials
);

// POST /api/slots/:slotId/materials (hoặc /api/classes/:classId/slots/:slotId/materials)
slotMaterialsRouter.post(
  '/:slotId/materials',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  upload.single('file'),
  classMaterialController.uploadSlotMaterial
);

// -----------------------------------------------------------------------
// Router D: routes gắn vào /api/lecturer/slots
// -----------------------------------------------------------------------
const lecturerSlotsRouter = express.Router({ mergeParams: true });
lecturerSlotsRouter.use(authenticate, requireSchoolContext);

// POST /api/lecturer/slots/:slotId/materials
lecturerSlotsRouter.post(
  '/:slotId/materials',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  upload.single('file'),
  classMaterialController.uploadSlotMaterial
);

// GET  /api/lecturer/slots/:slotId/materials
lecturerSlotsRouter.get(
  '/:slotId/materials',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  classMaterialController.listSlotMaterials
);

// -----------------------------------------------------------------------
// Router E: routes gắn vào /api/lecturer/materials
// -----------------------------------------------------------------------
const lecturerMaterialsRouter = express.Router();
lecturerMaterialsRouter.use(authenticate, requireSchoolContext);

// DELETE /api/lecturer/materials/:materialId
lecturerMaterialsRouter.delete(
  '/:materialId',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  classMaterialController.deleteMaterial
);

// GET    /api/lecturer/materials/:materialId/download
lecturerMaterialsRouter.get(
  '/:materialId/download',
  authorizeSchoolRoles('lecturer', 'school_admin'),
  classMaterialController.downloadMaterial
);

module.exports = {
  classIdRouter,
  materialIdRouter,
  slotMaterialsRouter,
  lecturerSlotsRouter,
  lecturerMaterialsRouter,
};

