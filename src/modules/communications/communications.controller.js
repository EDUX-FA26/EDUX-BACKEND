"use strict";

const communicationsService = require("./communications.service");

function handleError(error, res, next) {
  const statusCodes = {
    INVALID_COMMUNICATION_DATA: 400,
    NOT_CLASS_MEMBER: 403,
    FORBIDDEN: 403,
    ASSIGNMENT_NOT_FOUND: 404,
    SUBMISSION_NOT_FOUND: 404,
    STUDENT_NOT_FOUND: 404,
  };

  if (statusCodes[error.message]) {
    return res.status(statusCodes[error.message]).json({
      success: false,
      message: error.message,
    });
  }

  next(error);
}

const CommunicationsController = {
  /**
   * UC 97: POST /api/communications/assignment-deadline
   */
  async sendAssignmentDeadline(req, res, next) {
    try {
      const { assignmentId, studentId, title, message } = req.body || {};

      if (!assignmentId || !studentId) {
        return res.status(400).json({
          success: false,
          message: "Thiếu assignmentId hoặc studentId",
        });
      }

      const data = await communicationsService.sendAssignmentDeadlineNotification(
        { assignmentId, studentId, title, message },
        req.tenant
      );

      return res.status(200).json({
        success: true,
        message: "Gửi thông báo nhắc nhở deadline thành công",
        data,
      });
    } catch (error) {
      return handleError(error, res, next);
    }
  },

  /**
   * UC 98: POST /api/communications/submission-confirmation
   */
  async sendSubmissionConfirmation(req, res, next) {
    try {
      const { submissionId, studentId, title, message } = req.body || {};

      if (!submissionId || !studentId) {
        return res.status(400).json({
          success: false,
          message: "Thiếu submissionId hoặc studentId",
        });
      }

      const data = await communicationsService.sendSubmissionConfirmationEmail(
        { submissionId, studentId, title, message },
        req.tenant
      );

      return res.status(200).json({
        success: true,
        message: "Gửi email xác nhận nộp bài thành công",
        data,
      });
    } catch (error) {
      return handleError(error, res, next);
    }
  },
};

module.exports = CommunicationsController;
