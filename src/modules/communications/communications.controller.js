const communicationsService = require("./communications.service");

const CommunicationsController = {
  /**
   * UC 97: POST /api/communications/assignment-deadline
   */
  async sendAssignmentDeadline(req, res, next) {
    try {
      const { assignmentId, studentId, title, message } = req.body;
      
      if (!assignmentId || !studentId) {
        return res.status(400).json({ success: false, message: "Thiếu assignmentId hoặc studentId" });
      }

      const data = await communicationsService.sendAssignmentDeadlineNotification({
        assignmentId, studentId, title, message
      });

      res.status(200).json({
        success: true,
        message: "Gửi thông báo nhắc nhở deadline thành công",
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * UC 98: POST /api/communications/submission-confirmation
   */
  async sendSubmissionConfirmation(req, res, next) {
    try {
      const { submissionId, studentId, title, message } = req.body;

      if (!submissionId || !studentId) {
        return res.status(400).json({ success: false, message: "Thiếu submissionId hoặc studentId" });
      }

      const data = await communicationsService.sendSubmissionConfirmationEmail({
        submissionId, studentId, title, message
      });

      res.status(200).json({
        success: true,
        message: "Gửi email xác nhận nộp bài thành công",
        data,
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = CommunicationsController;
