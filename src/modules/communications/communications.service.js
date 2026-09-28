const { pool } = require("../../config/db.config");

const CommunicationsService = {
  /**
   * UC 97: Send Assignment Deadline Notification
   * Actor: Student (Theo nghiệp vụ gốc file) / System
   */
  async sendAssignmentDeadlineNotification({ assignmentId, studentId, title, message }) {
    // 1. Ghi log vào email_logs (giả lập gửi email nhắc nhở deadline)
    const emailQuery = `
      INSERT INTO email_logs (to_email, subject, body, type, status, related_entity_type, related_entity_id)
      SELECT u.email, $1, $2, 'deadline_reminder', 'pending', 'assignment', $3
      FROM users u WHERE u.id = $4
      RETURNING *;
    `;
    const emailRes = await pool.query(emailQuery, [
      title || "Nhắc nhở Deadline Bài tập",
      message || "Sắp tới hạn nộp bài tập. Vui lòng hoàn thành đúng hạn.",
      assignmentId,
      studentId
    ]);

    // 2. Tạo notification hệ thống
    const notifQuery = `
      INSERT INTO notifications (user_id, title, message, type, related_entity_type, related_entity_id)
      VALUES ($1, $2, $3, 'deadline_reminder', 'assignment', $4)
      RETURNING *;
    `;
    const notifRes = await pool.query(notifQuery, [
      studentId,
      title || "Nhắc nhở Deadline",
      message || "Sắp tới hạn nộp bài tập",
      assignmentId
    ]);

    return {
      emailLog: emailRes.rows[0],
      notification: notifRes.rows[0]
    };
  },

  /**
   * UC 98: Send Submission Confirmation Email
   * Actor: Student / System
   */
  async sendSubmissionConfirmationEmail({ submissionId, studentId, title, message }) {
    // 1. Ghi log vào email_logs (giả lập gửi email xác nhận)
    const emailQuery = `
      INSERT INTO email_logs (to_email, subject, body, type, status, related_entity_type, related_entity_id)
      SELECT u.email, $1, $2, 'submission_success', 'pending', 'submission', $3
      FROM users u WHERE u.id = $4
      RETURNING *;
    `;
    const emailRes = await pool.query(emailQuery, [
      title || "Xác nhận Nộp Bài Thành Công",
      message || "Hệ thống đã ghi nhận bài nộp của bạn.",
      submissionId,
      studentId
    ]);

    // 2. Tạo notification hệ thống
    const notifQuery = `
      INSERT INTO notifications (user_id, title, message, type, related_entity_type, related_entity_id)
      VALUES ($1, $2, $3, 'submission_success', 'submission', $4)
      RETURNING *;
    `;
    const notifRes = await pool.query(notifQuery, [
      studentId,
      title || "Nộp bài thành công",
      message || "Bài tập của bạn đã được nộp",
      submissionId
    ]);

    return {
      emailLog: emailRes.rows[0],
      notification: notifRes.rows[0]
    };
  }
};

module.exports = CommunicationsService;
