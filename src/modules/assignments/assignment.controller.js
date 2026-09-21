const AssignmentService = require('./assignment.service');

const AssignmentController = {
  async createAssignment(req, res, next) {
    try {
      const files = req.files || [];
      const assignment = await AssignmentService.createAssignment(req.body, files, req.user);
      res.status(201).json({ success: true, data: assignment });
    } catch (error) {
      if (error.message === 'CLASS_NOT_FOUND') return res.status(404).json({ success: false, message: 'Class not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async updateAssignment(req, res, next) {
    try {
      const { id } = req.params;
      const assignment = await AssignmentService.updateAssignment(id, req.body, req.user);
      res.status(200).json({ success: true, data: assignment });
    } catch (error) {
      if (error.message === 'ASSIGNMENT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Assignment not found' });
      if (error.message === 'CLASS_NOT_FOUND') return res.status(404).json({ success: false, message: 'Class not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async updatePublishStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { publish_status } = req.body;
      const assignment = await AssignmentService.updatePublishStatus(id, publish_status, req.user);
      res.status(200).json({ success: true, data: assignment });
    } catch (error) {
      if (error.message === 'ASSIGNMENT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Assignment not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async deleteAssignment(req, res, next) {
    try {
      const { id } = req.params;
      await AssignmentService.deleteAssignment(id, req.user);
      res.status(200).json({ success: true, message: 'Assignment deleted successfully' });
    } catch (error) {
      if (error.message === 'ASSIGNMENT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Assignment not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async getAssignmentById(req, res, next) {
    try {
      const { id } = req.params;
      const assignment = await AssignmentService.getAssignmentById(id, req.user);
      res.status(200).json({ success: true, data: assignment });
    } catch (error) {
      if (error.message === 'ASSIGNMENT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Assignment not found' });
      if (error.message === 'ASSIGNMENT_NOT_PUBLISHED') return res.status(403).json({ success: false, message: 'Assignment is not published yet' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async getAssignments(req, res, next) {
    try {
      const result = await AssignmentService.getAssignments(req.query, req.user);
      
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      
      res.status(200).json({
        success: true,
        data: result.data,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit) || 1
        }
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = AssignmentController;