const AssignmentMaterialService = require('./assignmentMaterial.service');

const AssignmentMaterialController = {
  /**
   * GET /api/assignments/:assignmentId/materials
   * Lấy danh sách tài liệu của assignment
   */
  async listMaterials(req, res, next) {
    try {
      const { assignmentId } = req.params;
      const result = await AssignmentMaterialService.listMaterials(assignmentId, req.query, req.tenant);

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
      const material = await AssignmentMaterialService.uploadMaterial(assignmentId, req.body, req.file, req.tenant);
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
      const material = await AssignmentMaterialService.getMaterialById(assignmentId, materialId, req.tenant);
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
      const updated = await AssignmentMaterialService.updateMaterial(assignmentId, materialId, req.body, req.tenant);
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
      const deleted = await AssignmentMaterialService.deleteMaterial(assignmentId, materialId, req.tenant);
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
   * Tải xuống / xem trước tài liệu assignment (hỗ trợ ?disposition=inline / attachment)
   */
  async downloadMaterial(req, res, next) {
    try {
      const { assignmentId, materialId } = req.params;
      const disposition = (req.query.disposition || 'attachment').toLowerCase();
      const result = await AssignmentMaterialService.downloadMaterial(assignmentId, materialId, req.tenant);

      const targetUrl = disposition === 'inline' ? (result.preview_url || result.url) : (result.download_url || result.url);

      // Nếu client yêu cầu redirect hoặc truy cập trực tiếp từ trình duyệt / thẻ iframe
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

