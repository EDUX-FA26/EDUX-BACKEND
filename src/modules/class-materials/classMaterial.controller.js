const ClassMaterialService = require('./classMaterial.service');

const ClassMaterialController = {
  /**
   * UC17 — GET /api/classes/:classId/materials
   * Lấy danh sách tài liệu của lớp
   */
  async listMaterials(req, res, next) {
    try {
      const { classId } = req.params;
      const result = await ClassMaterialService.listMaterials(classId, req.query, req.tenant);

      const { page = 1, limit = 20 } = req.query;
      res.status(200).json({
        success: true,
        data: result.data,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.total,
          totalPages: Math.ceil(result.total / Number(limit)) || 1,
        },
      });
    } catch (error) {
      if (error.message === 'CLASS_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Class not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },

  /**
   * UC19 — POST /api/classes/:classId/materials
   * Upload tài liệu mới cho lớp (chỉ lecturer)
   */
  async uploadMaterial(req, res, next) {
    try {
      const { classId } = req.params;
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }
      const material = await ClassMaterialService.uploadMaterial(classId, req.body, req.file, req.tenant);
      res.status(201).json({ success: true, data: material });
    } catch (error) {
      if (error.message === 'CLASS_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Class not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },

  /**
   * UC-MATERIAL-UPLOAD-AND-PREVIEW — POST /api/lecturer/slots/:slotId/materials
   * Upload tài liệu gắn với Slot buổi học
   */
  async uploadSlotMaterial(req, res, next) {
    try {
      const { slotId } = req.params;
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }
      const material = await ClassMaterialService.uploadSlotMaterial(slotId, req.body, req.file, req.tenant);
      res.status(201).json({ success: true, data: material });
    } catch (error) {
      if (error.message === 'SLOT_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Slot not found' });
      }
      if (error.message === 'CLASS_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Class not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },

  /**
   * UC-MATERIAL-UPLOAD-AND-PREVIEW — GET /api/classes/:classId/slots/:slotId/materials hoặc GET /api/slots/:slotId/materials
   * Lấy danh sách tài liệu gắn với Slot
   */
  async listSlotMaterials(req, res, next) {
    try {
      const { slotId } = req.params;
      const materials = await ClassMaterialService.listSlotMaterials(slotId, req.tenant);
      res.status(200).json({ success: true, data: materials });
    } catch (error) {
      if (error.message === 'SLOT_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Slot not found' });
      }
      if (error.message === 'CLASS_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Class not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },

  /**
   * UC17 — GET /api/materials/classes/:id
   * Lấy chi tiết 1 tài liệu lớp
   */
  async getMaterialById(req, res, next) {
    try {
      const materialId = req.params.materialId || req.params.id;
      const material = await ClassMaterialService.getMaterialById(materialId, req.tenant);
      res.status(200).json({ success: true, data: material });
    } catch (error) {
      if (error.message === 'MATERIAL_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Material not found' });
      }
      if (error.message === 'CLASS_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Class not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },

  /**
   * UC20 — PATCH /api/materials/classes/:id
   * Cập nhật metadata tài liệu lớp (chỉ lecturer)
   */
  async updateMaterial(req, res, next) {
    try {
      const materialId = req.params.materialId || req.params.id;
      const updated = await ClassMaterialService.updateMaterial(materialId, req.body, req.tenant);
      res.status(200).json({ success: true, data: updated });
    } catch (error) {
      if (error.message === 'MATERIAL_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Material not found' });
      }
      if (error.message === 'CLASS_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Class not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },

  /**
   * UC21 — DELETE /api/materials/classes/:id
   * Xóa tài liệu lớp (chỉ lecturer)
   */
  async deleteMaterial(req, res, next) {
    try {
      const materialId = req.params.materialId || req.params.id;
      const deleted = await ClassMaterialService.deleteMaterial(materialId, req.tenant);
      res.status(200).json({ success: true, message: 'Material deleted successfully', data: deleted });
    } catch (error) {
      if (error.message === 'MATERIAL_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Material not found' });
      }
      if (error.message === 'CLASS_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Class not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },

  /**
   * UC18 — GET /api/materials/classes/:id/download
   * Tải xuống / xem trước tài liệu lớp (hỗ trợ ?disposition=inline / attachment)
   */
  async downloadMaterial(req, res, next) {
    try {
      const materialId = req.params.materialId || req.params.id;
      const disposition = (req.query.disposition || 'attachment').toLowerCase();
      const result = await ClassMaterialService.downloadMaterial(materialId, req.tenant);

      const targetUrl = disposition === 'inline' ? (result.preview_url || result.url) : (result.download_url || result.url);

      if (req.headers.accept?.includes('text/html') || req.query.redirect === 'true') {
        return res.redirect(targetUrl);
      }

      res.status(200).json({
        success: true,
        data: {
          ...result,
          url: targetUrl,
        },
        url: targetUrl,
        download_url: result.download_url || result.url,
        preview_url: result.preview_url || result.url,
      });
    } catch (error) {
      if (error.message === 'MATERIAL_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Material not found' });
      }
      if (error.message === 'CLASS_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Class not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },
};

module.exports = ClassMaterialController;

