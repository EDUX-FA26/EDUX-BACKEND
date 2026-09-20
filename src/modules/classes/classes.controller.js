const ClassesService = require('./classes.service');

const ClassesController = {
  async getClasses(req, res, next) {
    try {
      // Assuming validation middleware attaches validated query to req.validatedQuery or we use req.query directly
      // However, we should validate it here or assume route middleware does it.
      // Usually validation middleware passes data to req.body / req.query but Zod needs explicit parse.
      // Assuming a generic validate middleware was used, or we do it here if missing. 
      // We will assume route handles validation and data is in req.query.
      
      const { page, limit, search, include_inactive } = req.query;
      
      const result = await ClassesService.getClasses({ page, limit, search, include_inactive }, req.user);
      
      const totalPages = Math.ceil(result.total / limit);

      res.status(200).json({
        success: true,
        data: result.data,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.total,
          totalPages: totalPages || 1
        }
      });
    } catch (error) {
      next(error);
    }
  },

  async getClassById(req, res, next) {
    try {
      const classId = req.params.id;
      const classData = await ClassesService.getClassById(classId, req.user);
      res.status(200).json({ success: true, data: classData });
    } catch (error) {
      if (error.message === 'CLASS_NOT_FOUND') return res.status(404).json({ success: false, message: 'Class not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async createClass(req, res, next) {
    try {
      // Admin only, should be enforced by middleware
      const data = await ClassesService.createClass(req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      if (error.code === '23505') { // Postgres unique violation
        return res.status(400).json({ success: false, message: 'Class code already exists for this semester and subject' });
      }
      next(error);
    }
  },

  async updateClass(req, res, next) {
    try {
      const classId = req.params.id;
      const data = await ClassesService.updateClass(classId, req.body);
      res.status(200).json({ success: true, data });
    } catch (error) {
      if (error.message === 'CLASS_NOT_FOUND') return res.status(404).json({ success: false, message: 'Class not found' });
      if (error.code === '23505') return res.status(400).json({ success: false, message: 'Class code already exists' });
      next(error);
    }
  },

  async deleteClass(req, res, next) {
    try {
      const classId = req.params.id;
      const data = await ClassesService.deleteClass(classId);
      res.status(200).json({ success: true, message: 'Class deleted successfully', data });
    } catch (error) {
      if (error.message === 'CLASS_NOT_FOUND') return res.status(404).json({ success: false, message: 'Class not found' });
      next(error);
    }
  },

  async getMembers(req, res, next) {
    try {
      const classId = req.params.id;
      const members = await ClassesService.getMembers(classId, req.user);
      res.status(200).json({ success: true, data: members });
    } catch (error) {
      if (error.message === 'CLASS_NOT_FOUND') return res.status(404).json({ success: false, message: 'Class not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async removeMember(req, res, next) {
    try {
      const { id: classId, userId: studentId } = req.params;
      await ClassesService.removeMember(classId, studentId, req.user);
      res.status(200).json({ success: true, message: 'Member removed/dropped successfully' });
    } catch (error) {
      if (error.message === 'CLASS_NOT_FOUND') return res.status(404).json({ success: false, message: 'Class not found' });
      if (error.message === 'MEMBER_NOT_FOUND') return res.status(404).json({ success: false, message: 'Member not found in class' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async importMembers(req, res, next) {
    try {
      const classId = req.params.id;
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }

      const result = await ClassesService.importMembers(classId, req.file.buffer, req.user);
      res.status(200).json({ success: true, ...result });
    } catch (error) {
      if (error.message === 'CLASS_NOT_FOUND') return res.status(404).json({ success: false, message: 'Class not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      if (error.message === 'INVALID_EXCEL_FORMAT') return res.status(400).json({ success: false, message: 'Invalid Excel format' });
      if (error.message === 'HEADER_STUDENT_CODE_NOT_FOUND') return res.status(400).json({ success: false, message: 'Header for student code not found (e.g., student_code, mã sinh viên)' });
      next(error);
    }
  },

  async exportMembers(req, res, next) {
    try {
      const classId = req.params.id;
      const { workbook, classData } = await ClassesService.exportMembers(classId, req.user);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Class_${classData.class_code}_Members.xlsx"`);
      
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      if (error.message === 'CLASS_NOT_FOUND') return res.status(404).json({ success: false, message: 'Class not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  }
};

module.exports = ClassesController;
