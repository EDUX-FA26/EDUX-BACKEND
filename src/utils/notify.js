const NotificationsRepository = require('../modules/notifications/notifications.repository');

// ─────────────────────────────────────────────────────────────────
// CORE: Gửi thông báo cơ bản
// ─────────────────────────────────────────────────────────────────

/**
 * Gửi 1 thông báo cho 1 user.
 * Tự động bắt lỗi — không làm crash luồng chính nếu notify thất bại.
 *
 * @param {Object} params
 * @param {string} params.userId              - UUID của user nhận thông báo
 * @param {string} params.title               - Tiêu đề thông báo
 * @param {string} params.message             - Nội dung thông báo
 * @param {string} params.type                - Loại thông báo (xem danh sách bên dưới)
 * @param {string} [params.relatedEntityType] - Tên bảng liên quan (vd: 'assignments')
 * @param {string} [params.relatedEntityId]   - UUID của bản ghi liên quan
 */
async function send({ userId, title, message, type, relatedEntityType = null, relatedEntityId = null }) {
  try {
    await NotificationsRepository.create({
      userId,
      title,
      message,
      type,
      related_entity_type: relatedEntityType,
      related_entity_id:   relatedEntityId,
    });
  } catch (err) {
    // Log lỗi nhưng KHÔNG throw — notify không được làm gián đoạn business logic
    console.error(`[notify.send] Lỗi khi gửi thông báo cho user ${userId}:`, err.message);
  }
}

/**
 * Gửi thông báo cho nhiều user cùng lúc (broadcast).
 *
 * @param {Array<Object>} notifications - Mảng các object cùng cấu trúc với `send()`
 */
async function sendMany(notifications) {
  if (!notifications || notifications.length === 0) return;
  try {
    const payload = notifications.map(n => ({
      userId:               n.userId,
      title:                n.title,
      message:              n.message,
      type:                 n.type,
      related_entity_type:  n.relatedEntityType || null,
      related_entity_id:    n.relatedEntityId   || null,
    }));
    await NotificationsRepository.bulkCreate(payload);
  } catch (err) {
    console.error(`[notify.sendMany] Lỗi khi gửi batch notifications:`, err.message);
  }
}


// ─────────────────────────────────────────────────────────────────
// TEMPLATES: Các loại thông báo phổ biến theo từng hành động
// ─────────────────────────────────────────────────────────────────

const notify = {
  send,
  sendMany,

  // ── ASSIGNMENT ────────────────────────────────────────────────

  /**
   * Giao bài tập mới → thông báo cho danh sách sinh viên
   * @param {{ studentIds: string[], assignmentTitle: string, classCode: string, deadline: string, assignmentId?: string }} p
   */
  async assignmentCreated({ studentIds, assignmentTitle, classCode, deadline, assignmentId }) {
    const notifications = studentIds.map(userId => ({
      userId,
      title:   `📋 Bài tập mới: ${assignmentTitle}`,
      message: `Giảng viên vừa giao bài tập "${assignmentTitle}" cho lớp ${classCode}. Hạn nộp: ${deadline}.`,
      type:    'assignment_created',
      relatedEntityType: assignmentId ? 'assignments' : null,
      relatedEntityId:   assignmentId || null,
    }));
    await sendMany(notifications);
  },

  /**
   * Cập nhật bài tập → thông báo cho danh sách sinh viên
   * @param {{ studentIds: string[], assignmentTitle: string, assignmentId?: string }} p
   */
  async assignmentUpdated({ studentIds, assignmentTitle, assignmentId }) {
    const notifications = studentIds.map(userId => ({
      userId,
      title:   `📝 Bài tập đã được cập nhật`,
      message: `Giảng viên vừa cập nhật yêu cầu bài tập "${assignmentTitle}". Vui lòng đọc lại đề bài.`,
      type:    'assignment_updated',
      relatedEntityType: assignmentId ? 'assignments' : null,
      relatedEntityId:   assignmentId || null,
    }));
    await sendMany(notifications);
  },

  /**
   * Nhắc deadline sắp đến → thông báo cho danh sách sinh viên chưa nộp
   * @param {{ studentIds: string[], assignmentTitle: string, hoursLeft: number, assignmentId?: string }} p
   */
  async deadlineReminder({ studentIds, assignmentTitle, hoursLeft, assignmentId }) {
    const notifications = studentIds.map(userId => ({
      userId,
      title:   `⚠️ Nhắc nhở: Hạn nộp sắp đến!`,
      message: `Bài tập "${assignmentTitle}" sẽ hết hạn sau ${hoursLeft} giờ nữa. Hãy nộp bài ngay!`,
      type:    'deadline_reminder',
      relatedEntityType: assignmentId ? 'assignments' : null,
      relatedEntityId:   assignmentId || null,
    }));
    await sendMany(notifications);
  },

  // ── SUBMISSION ────────────────────────────────────────────────

  /**
   * Nộp bài thành công → thông báo cho sinh viên
   * @param {{ userId: string, assignmentTitle: string, submissionId?: string }} p
   */
  async submissionSuccess({ userId, assignmentTitle, submissionId }) {
    await send({
      userId,
      title:   `✅ Nộp bài thành công`,
      message: `Bạn đã nộp bài "${assignmentTitle}" thành công. Chờ giảng viên chấm điểm.`,
      type:    'submission_success',
      relatedEntityType: submissionId ? 'submissions' : null,
      relatedEntityId:   submissionId || null,
    });
  },

  /**
   * Sinh viên nộp bài → thông báo cho giảng viên cần chấm
   * @param {{ lecturerId: string, studentName: string, assignmentTitle: string, submissionId?: string }} p
   */
  async submissionReceived({ lecturerId, studentName, assignmentTitle, submissionId }) {
    await send({
      userId:  lecturerId,
      title:   `📥 Sinh viên vừa nộp bài`,
      message: `${studentName} đã nộp bài "${assignmentTitle}". Vui lòng xem xét và chấm điểm.`,
      type:    'submission_reviewed',
      relatedEntityType: submissionId ? 'submissions' : null,
      relatedEntityId:   submissionId || null,
    });
  },

  // ── GRADING ───────────────────────────────────────────────────

  /**
   * Điểm đã được công bố → thông báo cho sinh viên
   * @param {{ userId: string, assignmentTitle: string, score: string|number, submissionId?: string }} p
   */
  async gradePublished({ userId, assignmentTitle, score, submissionId }) {
    await send({
      userId,
      title:   `🏆 Điểm của bạn đã được công bố`,
      message: `Bài tập "${assignmentTitle}" đã được chấm điểm. Điểm của bạn: ${score}. Xem nhận xét trong mục Bài tập.`,
      type:    'grade_published',
      relatedEntityType: submissionId ? 'submissions' : null,
      relatedEntityId:   submissionId || null,
    });
  },

  /**
   * Kết quả cuối kỳ → thông báo cho danh sách sinh viên
   * @param {{ studentIds: string[], subjectName: string, semesterName: string }} p
   */
  async finalResultReleased({ studentIds, subjectName, semesterName }) {
    const notifications = studentIds.map(userId => ({
      userId,
      title:   `📊 Kết quả cuối kỳ đã được công bố`,
      message: `Kết quả cuối kỳ môn ${subjectName} - ${semesterName} đã được công bố. Kiểm tra bảng điểm trong hồ sơ của bạn.`,
      type:    'final_result_released',
    }));
    await sendMany(notifications);
  },

  // ── FLAG ──────────────────────────────────────────────────────

  /**
   * Bài nộp bị gắn cờ → thông báo cho sinh viên
   * @param {{ userId: string, assignmentTitle: string, reason?: string, submissionId?: string }} p
   */
  async flagCreated({ userId, assignmentTitle, reason, submissionId }) {
    await send({
      userId,
      title:   `🚩 Bài nộp của bạn bị gắn cờ`,
      message: `Bài nộp "${assignmentTitle}" bị gắn cờ để xem xét thêm${reason ? ': ' + reason : ''}. Vui lòng liên hệ giảng viên.`,
      type:    'flag_created',
      relatedEntityType: submissionId ? 'submissions' : null,
      relatedEntityId:   submissionId || null,
    });
  },

  // ── CHAT ──────────────────────────────────────────────────────

  /**
   * Tin nhắn chat mới → thông báo cho user được tag hoặc tất cả thành viên
   * @param {{ userIds: string[], senderName: string, preview: string, chatId?: string }} p
   */
  async chatMessage({ userIds, senderName, preview, chatId }) {
    const notifications = userIds.map(userId => ({
      userId,
      title:   `💬 Tin nhắn mới từ ${senderName}`,
      message: `${senderName}: "${preview}"`,
      type:    'chat_message',
      relatedEntityType: chatId ? 'chats' : null,
      relatedEntityId:   chatId || null,
    }));
    await sendMany(notifications);
  },

  // ── SYSTEM ────────────────────────────────────────────────────

  /**
   * Thông báo hệ thống → gửi cho 1 hoặc nhiều user
   * @param {{ userIds: string[], title: string, message: string }} p
   */
  async systemAnnouncement({ userIds, title, message }) {
    const notifications = userIds.map(userId => ({
      userId,
      title,
      message,
      type: 'system_announcement',
    }));
    await sendMany(notifications);
  },
};

module.exports = notify;
