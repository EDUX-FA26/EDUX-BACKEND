const ClassMaterialService = require('./classMaterial.service');

const ClassMaterialController = {
  /**
   * UC17 — GET /api/classes/:classId/materials
   * Lấy danh sách tài liệu của lớp
   */
  async listMaterials(req, res, next) {
    try {
      const { classId } = req.params;
      const result = await ClassMaterialService.listMaterials(classId, req.query, req.user);

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
      const material = await ClassMaterialService.uploadMaterial(classId, req.body, req.file, req.user);
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
   * UC17 — GET /api/materials/classes/:id
   * Lấy chi tiết 1 tài liệu lớp
   */
  async getMaterialById(req, res, next) {
    try {
      const material = await ClassMaterialService.getMaterialById(req.params.id, req.user);
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
      const updated = await ClassMaterialService.updateMaterial(req.params.id, req.body, req.user);
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
      const deleted = await ClassMaterialService.deleteMaterial(req.params.id, req.user);
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
   * Tải xuống tài liệu lớp (trả về presigned URL)
   */
  async downloadMaterial(req, res, next) {
    try {
      const result = await ClassMaterialService.downloadMaterial(req.params.id, req.user);
      res.status(200).json({ success: true, data: result });
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

