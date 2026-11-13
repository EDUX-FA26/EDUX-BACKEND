const AssignmentService = require('./assignment.service');

const AssignmentController = {
  async createAssignment(req, res, next) {
    try {
      const files = req.files || [];
      const assignment = await AssignmentService.createAssignment(req.body, files, req.user);
      res.status(201).json({ success: true, data: assignment });
    } catch (error) {
      if (error.message && error.message.startsWith('INVALID_RUBRIC_WEIGHTS')) {
        return res.status(400).json({ success: false, message: error.message.replace(/^INVALID_RUBRIC_WEIGHTS:\s*/, '') });
      }
      if (error.message === 'CLASS_NOT_FOUND') return res.status(404).json({ success: false, message: 'Class not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async updateAssignment(req, res, next) {
    try {
      const { id } = req.params;
      const files = req.files || [];
      const assignment = await AssignmentService.updateAssignment(id, req.body, files, req.user);
      res.status(200).json({ success: true, data: assignment });
    } catch (error) {
      if (error.message && error.message.startsWith('INVALID_RUBRIC_WEIGHTS')) {
        return res.status(400).json({ success: false, message: error.message.replace(/^INVALID_RUBRIC_WEIGHTS:\s*/, '') });
      }
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
      const id = req.params.assignmentId || req.params.id;
      const force = req.query.force === 'true' || req.query.force === true;
      await AssignmentService.deleteAssignment(id, req.user, { force });
      res.status(200).json({ success: true, message: 'Assignment deleted successfully' });
    } catch (error) {
      if (error.code === 'SUBMISSIONS_EXIST') {
        return res.status(400).json({
          success: false,
          code: 'SUBMISSIONS_EXIST',
          message: error.message,
          submission_count: error.submissionCount
        });
      }
      if (error.message === 'ASSIGNMENT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Assignment not found' });
      if (error.message === 'CLASS_NOT_FOUND') return res.status(404).json({ success: false, message: 'Class not found' });
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
      res.status(200).json({ 
        success: true, 
        data: result.data,
        pagination: {
          page: req.query.page,
          limit: req.query.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / req.query.limit)
        }
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = AssignmentController;
