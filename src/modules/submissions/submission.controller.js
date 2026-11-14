const SubmissionService = require('./submission.service');

const SubmissionController = {
  async saveDraftFile(req, res, next) {
    try {
      const { assignmentId } = req.params;
      const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : (req.file ? [req.file] : []);
      const result = await SubmissionService.saveDraftFile(assignmentId, req.tenant, files, req.body);
      res.status(200).json({ success: true, data: result, message: 'Draft file saved successfully' });
    } catch (error) {
      if (['ONLY_STUDENT_CAN_SUBMIT', 'NOT_ENROLLED_IN_CLASS', 'SUBMISSION_LOCKED', 'FORBIDDEN'].includes(error.message)) {
        return res.status(403).json({ success: false, message: error.message });
      }
      if (['ASSIGNMENT_NOT_FOUND', 'ASSIGNMENT_NOT_PUBLISHED'].includes(error.message)) {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  async saveDraftDeclarations(req, res, next) {
    try {
      const { assignmentId } = req.params;
      const result = await SubmissionService.saveDraftDeclarations(assignmentId, req.tenant, req.body);
      res.status(200).json({ success: true, data: result, message: 'Draft declarations saved successfully' });
    } catch (error) {
      if (['ONLY_STUDENT_CAN_SUBMIT', 'NOT_ENROLLED_IN_CLASS', 'SUBMISSION_LOCKED', 'FORBIDDEN'].includes(error.message)) {
        return res.status(403).json({ success: false, message: error.message });
      }
      if (['ASSIGNMENT_NOT_FOUND', 'ASSIGNMENT_NOT_PUBLISHED'].includes(error.message)) {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  async removeDraftFile(req, res, next) {
    try {
      const { assignmentId } = req.params;
      const result = await SubmissionService.removeDraftFile(assignmentId, req.tenant);
      res.status(200).json({ success: true, data: result, message: 'Draft file removed successfully' });
    } catch (error) {
      if (['ONLY_STUDENT_CAN_DELETE', 'FORBIDDEN', 'SUBMISSION_LOCKED'].includes(error.message)) {
        return res.status(403).json({ success: false, message: error.message });
      }
      if (['SUBMISSION_NOT_FOUND', 'VERSION_NOT_FOUND'].includes(error.message)) {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  async sanityCheck(req, res, next) {
    try {
      const { assignmentId } = req.params;
      const result = await SubmissionService.sanityCheck(assignmentId, req.tenant, req.body);
      res.status(200).json({ success: true, data: result, message: 'Sanity check completed successfully' });
    } catch (error) {
      if (['ONLY_STUDENT_CAN_SUBMIT', 'NOT_ENROLLED_IN_CLASS', 'FORBIDDEN'].includes(error.message)) {
        return res.status(403).json({ success: false, message: error.message });
      }
      if (['ASSIGNMENT_NOT_FOUND', 'ASSIGNMENT_NOT_PUBLISHED'].includes(error.message)) {
        return res.status(404).json({ success: false, message: error.message });
      }
      if (error.message === 'NO_SUBMISSION_FILE') {
        return res.status(400).json({ success: false, message: 'Vui lòng tải lên tệp bài làm trước khi kiểm tra nhanh bằng AI.' });
      }
      next(error);
    }
  },

  async saveDraft(req, res, next) {
    try {
      const { assignmentId } = req.params;
      const files = req.files || [];
      const result = await SubmissionService.saveDraft(assignmentId, req.tenant, files, req.body);
      res.status(200).json({ success: true, data: result, message: 'Draft saved successfully' });
    } catch (error) {
      if (['ONLY_STUDENT_CAN_SUBMIT', 'NOT_ENROLLED_IN_CLASS', 'SUBMISSION_LOCKED', 'FORBIDDEN'].includes(error.message)) {
        return res.status(403).json({ success: false, message: error.message });
      }
      if (['ASSIGNMENT_NOT_FOUND', 'ASSIGNMENT_NOT_PUBLISHED'].includes(error.message)) {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  async submitFinal(req, res, next) {
    try {
      const { assignmentId } = req.params;
      const files = req.files || [];
      const result = await SubmissionService.submitFinal(assignmentId, req.tenant, files, req.body);
      res.status(201).json({ success: true, data: result, message: 'Submitted successfully' });
    } catch (error) {
      if (error.message.startsWith('AI_DECLARATION_REQUIRED') || error.message === 'SUBMISSION_EMPTY_CONTENT') {
        return res.status(400).json({ success: false, message: error.message });
      }
      if (['ONLY_STUDENT_CAN_SUBMIT', 'NOT_ENROLLED_IN_CLASS', 'DEADLINE_PASSED_AND_LATE_SUBMISSION_NOT_ALLOWED', 'FORBIDDEN'].includes(error.message)) {
        return res.status(403).json({ success: false, message: error.message });
      }
      if (['ASSIGNMENT_NOT_FOUND', 'ASSIGNMENT_NOT_PUBLISHED'].includes(error.message)) {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  async submitFinalById(req, res, next) {
    try {
      const { id } = req.params;
      const submission = await SubmissionService.getSubmissionById(id, false, req.tenant);
      const files = req.files || [];
      const result = await SubmissionService.submitFinal(submission.assignment_id, req.tenant, files, req.body);
      res.status(200).json({ success: true, data: result, message: 'Submitted successfully' });
    } catch (error) {
      if (error.message.startsWith('AI_DECLARATION_REQUIRED') || error.message === 'SUBMISSION_EMPTY_CONTENT') {
        return res.status(400).json({ success: false, message: error.message });
      }
      if (['ONLY_STUDENT_CAN_SUBMIT', 'NOT_ENROLLED_IN_CLASS', 'DEADLINE_PASSED_AND_LATE_SUBMISSION_NOT_ALLOWED', 'FORBIDDEN'].includes(error.message)) {
        return res.status(403).json({ success: false, message: error.message });
      }
      if (['SUBMISSION_NOT_FOUND', 'ASSIGNMENT_NOT_FOUND', 'ASSIGNMENT_NOT_PUBLISHED'].includes(error.message)) {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  async submitAssignment(req, res, next) {
    try {
      const { assignmentId } = req.params;
      const files = req.files || [];
      const isDraft = req.query.is_draft === 'true' || req.body?.is_draft === 'true' || req.body?.is_draft === true;
      const result = isDraft
        ? await SubmissionService.saveDraft(assignmentId, req.tenant, files, req.body)
        : await SubmissionService.submitFinal(assignmentId, req.tenant, files, req.body);
      res.status(isDraft ? 200 : 201).json({ success: true, data: result });
    } catch (error) {
      if (error.message.startsWith('AI_DECLARATION_REQUIRED') || error.message === 'SUBMISSION_EMPTY_CONTENT') {
        return res.status(400).json({ success: false, message: error.message });
      }
      if (['ONLY_STUDENT_CAN_SUBMIT', 'NOT_ENROLLED_IN_CLASS', 'DEADLINE_PASSED_AND_LATE_SUBMISSION_NOT_ALLOWED', 'SUBMISSION_LOCKED', 'FORBIDDEN'].includes(error.message)) {
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
      const result = await SubmissionService.deleteSubmissionFile(id, fileId, req.tenant);
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
      const submission = await SubmissionService.getSubmissionById(id, includeHistory, req.tenant);
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
      const result = await SubmissionService.reviewSubmission(id, req.body, req.tenant);
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
      const fileInfo = await SubmissionService.getSubmissionFile(id, fileId, req.tenant);
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

      // Nếu là sinh viên, trả về bài nộp của chính sinh viên đó (bao gồm cả draft)
      if (req.tenant.role === 'student') {
        const studentSubmission = await SubmissionService.getStudentSubmissionForAssignment(assignmentId, req.tenant);
        return res.status(200).json({
          success: true,
          data: studentSubmission ? [studentSubmission] : [],
          submission: studentSubmission,
          pagination: {
            page: 1,
            limit: 1,
            total: studentSubmission ? 1 : 0,
            totalPages: 1
          }
        });
      }

      const result = await SubmissionService.getAssignmentSubmissions(assignmentId, req.query, req.tenant);
      
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
      if (['FORBIDDEN', 'NOT_ENROLLED_IN_CLASS'].includes(error.message)) return res.status(403).json({ success: false, message: 'Access denied' });
      if (['ASSIGNMENT_NOT_FOUND', 'ASSIGNMENT_NOT_PUBLISHED'].includes(error.message)) return res.status(404).json({ success: false, message: 'Assignment not found' });
      next(error);
    }
  },

  async getMySubmissionByAssignment(req, res, next) {
    try {
      const { assignmentId } = req.params;
      const submission = await SubmissionService.getStudentSubmissionForAssignment(assignmentId, req.tenant);
      res.status(200).json({
        success: true,
        data: submission
      });
    } catch (error) {
      if (['FORBIDDEN', 'NOT_ENROLLED_IN_CLASS'].includes(error.message)) return res.status(403).json({ success: false, message: 'Access denied' });
      if (['ASSIGNMENT_NOT_FOUND', 'ASSIGNMENT_NOT_PUBLISHED'].includes(error.message)) return res.status(404).json({ success: false, message: 'Assignment not found' });
      next(error);
    }
  },

  async getMySubmissions(req, res, next) {
    try {
      const result = await SubmissionService.getMySubmissions(req.tenant, req.query);
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
