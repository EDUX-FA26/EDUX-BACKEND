"use strict";

const { validate: isUuid } = require("uuid");
const { pool } = require("../../config/db.config");

const validId = (id) => typeof id === "string" && isUuid(id);

const CommunicationsService = {
  /**
   * UC 97: Send Assignment Deadline Notification
   * Actor: Student (tự nhắc bài tập của mình), Lecturer (phụ trách lớp), School Admin
   */
  async sendAssignmentDeadlineNotification({ assignmentId, studentId, title, message }, tenant) {
    if (!tenant) {
      throw new Error("FORBIDDEN");
    }

    if (!validId(assignmentId) || !validId(studentId)) {
      throw new Error("INVALID_COMMUNICATION_DATA");
    }

    // 1. Phân quyền vai trò người gửi
    if (tenant.role === "student") {
      // Sinh viên chỉ được tạo thông báo nhắc hạn cho chính mình
      if (studentId !== tenant.userId) {
        throw new Error("FORBIDDEN");
      }
    }

    // 2. Xác minh Assignment thuộc Class của trường hiện tại
    const assignmentRes = await pool.query(
      `SELECT a.id, a.title, a.deadline, c.id AS class_id, c.school_id, c.lecturer_id
       FROM assignments a
       JOIN classes c ON c.id = a.class_id
       WHERE a.id = $1 AND c.school_id = $2 AND c.is_active = true`,
      [assignmentId, tenant.schoolId]
    );

    const assignment = assignmentRes.rows[0];
    if (!assignment) {
      throw new Error("ASSIGNMENT_NOT_FOUND");
    }

    // 3. Phân quyền giảng viên
    if (tenant.role === "lecturer") {
      // Giảng viên chỉ được nhắc hạn cho sinh viên thuộc lớp mình phụ trách
      if (assignment.lecturer_id !== tenant.userId) {
        throw new Error("FORBIDDEN");
      }
    } else if (tenant.role !== "student" && tenant.role !== "school_admin") {
      throw new Error("FORBIDDEN");
    }

    // 4. Xác minh Student có active membership tại trường hiện tại
    const studentSchoolRes = await pool.query(
      `SELECT 1 FROM public.school_memberships
       WHERE user_id = $1 AND school_id = $2 AND status = 'active'`,
      [studentId, tenant.schoolId]
    );
    if (!studentSchoolRes.rowCount) {
      throw new Error("NOT_CLASS_MEMBER");
    }

    // 5. Xác minh Student đang học lớp này
    const classMemberRes = await pool.query(
      `SELECT 1 FROM class_members
       WHERE class_id = $1 AND student_id = $2 AND status = 'active'`,
      [assignment.class_id, studentId]
    );
    if (!classMemberRes.rowCount) {
      throw new Error("NOT_CLASS_MEMBER");
    }

    // 6. Ghi log vào email_logs có xác thực active School Membership
    const emailQuery = `
      INSERT INTO email_logs (to_email, subject, body, type, status, related_entity_type, related_entity_id)
      SELECT u.email, $1, $2, 'deadline_reminder', 'pending', 'assignment', $3
      FROM users u
      JOIN public.school_memberships sm ON sm.user_id = u.id AND sm.school_id = $5
      WHERE u.id = $4 AND sm.status = 'active'
      RETURNING *;
    `;
    const emailRes = await pool.query(emailQuery, [
      title || "Nhắc nhở Deadline Bài tập",
      message || "Sắp tới hạn nộp bài tập. Vui lòng hoàn thành đúng hạn.",
      assignmentId,
      studentId,
      tenant.schoolId,
    ]);

    // 7. Tạo notification hệ thống với school_id và notification_scope = 'school'
    const notifQuery = `
      INSERT INTO notifications (user_id, title, message, type, related_entity_type, related_entity_id, school_id, notification_scope)
      VALUES ($1, $2, $3, 'deadline_reminder', 'assignment', $4, $5, $6)
      RETURNING *;
    `;
    const notifRes = await pool.query(notifQuery, [
      studentId,
      title || "Nhắc nhở Deadline",
      message || "Sắp tới hạn nộp bài tập",
      assignmentId,
      tenant.schoolId,
      "school",
    ]);

    return {
      emailLog: emailRes.rows[0] || null,
      notification: notifRes.rows[0] || null,
    };
  },

  /**
   * UC 98: Send Submission Confirmation Email
   * Actor: Student (nộp bài của mình), Lecturer (phụ trách lớp), School Admin
   */
  async sendSubmissionConfirmationEmail({ submissionId, studentId, title, message }, tenant) {
    if (!tenant) {
      throw new Error("FORBIDDEN");
    }

    if (!validId(submissionId) || !validId(studentId)) {
      throw new Error("INVALID_COMMUNICATION_DATA");
    }

    // 1. Phân quyền vai trò người gửi
    if (tenant.role === "student") {
      // Sinh viên chỉ được gửi xác nhận nộp bài cho chính mình
      if (studentId !== tenant.userId) {
        throw new Error("FORBIDDEN");
      }
    }

    // 2. Xác minh Submission thuộc Class của trường hiện tại
    const submissionRes = await pool.query(
      `SELECT s.id, s.assignment_id, s.student_id, c.id AS class_id, c.school_id, c.lecturer_id
       FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN classes c ON c.id = a.class_id
       WHERE s.id = $1 AND c.school_id = $2`,
      [submissionId, tenant.schoolId]
    );

    const submission = submissionRes.rows[0];
    if (!submission) {
      throw new Error("SUBMISSION_NOT_FOUND");
    }

    // 3. Xác minh Submission đúng là của studentId
    if (submission.student_id !== studentId) {
      throw new Error("FORBIDDEN");
    }

    // 4. Phân quyền giảng viên
    if (tenant.role === "lecturer") {
      // Giảng viên chỉ được gửi xác nhận đối với bài nộp thuộc lớp mình giảng dạy
      if (submission.lecturer_id !== tenant.userId) {
        throw new Error("FORBIDDEN");
      }
    } else if (tenant.role !== "student" && tenant.role !== "school_admin") {
      throw new Error("FORBIDDEN");
    }

    // 5. Xác minh Student có active membership tại trường hiện tại
    const studentSchoolRes = await pool.query(
      `SELECT 1 FROM public.school_memberships
       WHERE user_id = $1 AND school_id = $2 AND status = 'active'`,
      [studentId, tenant.schoolId]
    );
    if (!studentSchoolRes.rowCount) {
      throw new Error("NOT_CLASS_MEMBER");
    }

    // 6. Ghi log vào email_logs có xác thực active School Membership
    const emailQuery = `
      INSERT INTO email_logs (to_email, subject, body, type, status, related_entity_type, related_entity_id)
      SELECT u.email, $1, $2, 'submission_success', 'pending', 'submission', $3
      FROM users u
      JOIN public.school_memberships sm ON sm.user_id = u.id AND sm.school_id = $5
      WHERE u.id = $4 AND sm.status = 'active'
      RETURNING *;
    `;
    const emailRes = await pool.query(emailQuery, [
      title || "Xác nhận Nộp Bài Thành Công",
      message || "Hệ thống đã ghi nhận bài nộp của bạn.",
      submissionId,
      studentId,
      tenant.schoolId,
    ]);

    // 7. Tạo notification hệ thống với school_id và notification_scope = 'school'
    const notifQuery = `
      INSERT INTO notifications (user_id, title, message, type, related_entity_type, related_entity_id, school_id, notification_scope)
      VALUES ($1, $2, $3, 'submission_success', 'submission', $4, $5, $6)
      RETURNING *;
    `;
    const notifRes = await pool.query(notifQuery, [
      studentId,
      title || "Nộp bài thành công",
      message || "Bài tập của bạn đã được nộp",
      submissionId,
      tenant.schoolId,
      "school",
    ]);

    return {
      emailLog: emailRes.rows[0] || null,
      notification: notifRes.rows[0] || null,
    };
  },
};

module.exports = CommunicationsService;
