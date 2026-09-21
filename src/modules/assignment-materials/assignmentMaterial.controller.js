const AssignmentMaterialService = require('./assignmentMaterial.service');

const AssignmentMaterialController = {
  /**
   * GET /api/assignments/:assignmentId/materials
   * Lấy danh sách tài liệu của assignment
   */
  async listMaterials(req, res, next) {
    try {
      const { assignmentId } = req.params;
      const result = await AssignmentMaterialService.listMaterials(assignmentId, req.query, req.user);

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
      if (error.message === 'ASSIGNMENT_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Assignment not found' });
      }
      if (error.message === 'ASSIGNMENT_NOT_PUBLISHED') {
        return res.status(403).json({ success: false, message: 'Assignment is not published yet' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },

  /**
   * POST /api/assignments/:assignmentId/materials
   * Upload tài liệu cho assignment (chỉ lecturer)
   */
  async uploadMaterial(req, res, next) {
    try {
      const { assignmentId } = req.params;
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }
      const material = await AssignmentMaterialService.uploadMaterial(assignmentId, req.body, req.file, req.user);
      res.status(201).json({ success: true, data: material });
    } catch (error) {
      if (error.message === 'ASSIGNMENT_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Assignment not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },

  /**
   * GET /api/assignments/:assignmentId/materials/:materialId
   * Lấy chi tiết 1 tài liệu assignment
   */
  async getMaterialById(req, res, next) {
    try {
      const { assignmentId, materialId } = req.params;
      const material = await AssignmentMaterialService.getMaterialById(assignmentId, materialId, req.user);
      res.status(200).json({ success: true, data: material });
    } catch (error) {
      if (error.message === 'ASSIGNMENT_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Assignment not found' });
      }
      if (error.message === 'MATERIAL_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Material not found' });
      }
      if (error.message === 'ASSIGNMENT_NOT_PUBLISHED') {
        return res.status(403).json({ success: false, message: 'Assignment is not published yet' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },

  /**
   * PATCH /api/assignments/:assignmentId/materials/:materialId
   * Cập nhật metadata tài liệu assignment (chỉ lecturer)
   */
  async updateMaterial(req, res, next) {
    try {
      const { assignmentId, materialId } = req.params;
      const updated = await AssignmentMaterialService.updateMaterial(assignmentId, materialId, req.body, req.user);
      res.status(200).json({ success: true, data: updated });
    } catch (error) {
      if (error.message === 'ASSIGNMENT_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Assignment not found' });
      }
      if (error.message === 'MATERIAL_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Material not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },

  /**
   * DELETE /api/assignments/:assignmentId/materials/:materialId
   * Xóa tài liệu assignment (chỉ lecturer)
   */
  async deleteMaterial(req, res, next) {
    try {
      const { assignmentId, materialId } = req.params;
      const deleted = await AssignmentMaterialService.deleteMaterial(assignmentId, materialId, req.user);
      res.status(200).json({ success: true, message: 'Material deleted successfully', data: deleted });
    } catch (error) {
      if (error.message === 'ASSIGNMENT_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Assignment not found' });
      }
      if (error.message === 'MATERIAL_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Material not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },

  /**
   * GET /api/assignments/:assignmentId/materials/:materialId/download
   * Tải xuống tài liệu assignment (trả về presigned URL)
   */
  async downloadMaterial(req, res, next) {
    try {
      const { assignmentId, materialId } = req.params;
      const result = await AssignmentMaterialService.downloadMaterial(assignmentId, materialId, req.user);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error.message === 'ASSIGNMENT_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Assignment not found' });
      }
      if (error.message === 'MATERIAL_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Material not found' });
      }
      if (error.message === 'ASSIGNMENT_NOT_PUBLISHED') {
        return res.status(403).json({ success: false, message: 'Assignment is not published yet' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      next(error);
    }
  },
};

module.exports = AssignmentMaterialController;

