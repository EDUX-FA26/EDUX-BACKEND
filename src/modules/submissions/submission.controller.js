const SubmissionService = require('./submission.service');

const SubmissionController = {
  async submitAssignment(req, res, next) {
    try {
      const { assignmentId } = req.params;
      const files = req.files || [];
      const result = await SubmissionService.submitAssignment(assignmentId, req.user, files, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      if (['ONLY_STUDENT_CAN_SUBMIT', 'NOT_ENROLLED_IN_CLASS', 'DEADLINE_PASSED_AND_LATE_SUBMISSION_NOT_ALLOWED'].includes(error.message)) {
        return res.status(403).json({ success: false, message: error.message });
      }
      if (['ASSIGNMENT_NOT_FOUND', 'ASSIGNMENT_NOT_PUBLISHED'].includes(error.message)) {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  async deleteSubmissionFile(req, res, next) {
    try {
      const { id, fileId } = req.params;
      const result = await SubmissionService.deleteSubmissionFile(id, fileId, req.user);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (['ONLY_STUDENT_CAN_DELETE', 'FORBIDDEN', 'SUBMISSION_LOCKED'].includes(error.message)) {
        return res.status(403).json({ success: false, message: error.message });
      }
      if (['SUBMISSION_NOT_FOUND', 'VERSION_NOT_FOUND', 'FILE_NOT_FOUND'].includes(error.message)) {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  async getSubmissionById(req, res, next) {
    try {
      const { id } = req.params;
      const includeHistory = req.query.include_history === 'true';
      const submission = await SubmissionService.getSubmissionById(id, includeHistory, req.user);
      res.status(200).json({ success: true, data: submission });
    } catch (error) {
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      if (error.message === 'SUBMISSION_NOT_FOUND') return res.status(404).json({ success: false, message: 'Submission not found' });
      next(error);
    }
  },

  async reviewSubmission(req, res, next) {
    try {
      const { id } = req.params;
      const result = await SubmissionService.reviewSubmission(id, req.body, req.user);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      if (error.message === 'SUBMISSION_NOT_FOUND') return res.status(404).json({ success: false, message: 'Submission not found' });
      next(error);
    }
  },

  async getSubmissionFile(req, res, next) {
    try {
      const { id, fileId } = req.params;
      const fileInfo = await SubmissionService.getSubmissionFile(id, fileId, req.user);
      res.status(200).json({ success: true, data: fileInfo });
    } catch (error) {
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      if (['SUBMISSION_NOT_FOUND', 'FILE_NOT_FOUND'].includes(error.message)) {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  async getAssignmentSubmissions(req, res, next) {
    try {
      const { assignmentId } = req.params;
      const result = await SubmissionService.getAssignmentSubmissions(assignmentId, req.query, req.user);
      
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
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      if (error.message === 'ASSIGNMENT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Assignment not found' });
      next(error);
    }
  },

  async getMySubmissions(req, res, next) {
    try {
      const result = await SubmissionService.getMySubmissions(req.user.id, req.query);
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

module.exports = SubmissionController;