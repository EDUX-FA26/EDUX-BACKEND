
const { getIO } = require('../../config/socket.config');

/**
 * Emit notifications đã được lưu vào PostgreSQL.
 * Đây là tín hiệu realtime, không thay thế DB.
 */
function emitCreatedNotifications(notifications = []) {
  if (!Array.isArray(notifications) || notifications.length === 0) {
    return { emitted: 0 };
  }

  let io;

  try {
    io = getIO();
  } catch (error) {
    console.warn(
      '[NOTIFICATION REALTIME] Socket.IO unavailable:',
      error.message
    );

    return { emitted: 0 };
  }

  for (const notification of notifications) {
    if (!notification.user_id) continue;

    // Room có Tenant Scope: school:${schoolId}:user:${userId}
    // Đối với Platform Notification (không có school_id): platform:user:${userId}
    // Tuyệt đối KHÔNG emit School Notifications vào room toàn cục user:${userId}
    const targetRoom = notification.school_id
      ? `school:${notification.school_id}:user:${notification.user_id}`
      : `platform:user:${notification.user_id}`;

    io.to(targetRoom).emit(
      'new_notification',
      {
        id: notification.id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        related_entity_type: notification.related_entity_type,
        related_entity_id: notification.related_entity_id,
        school_id: notification.school_id || null,
        notification_scope: notification.notification_scope || (notification.school_id ? 'school' : 'platform'),
        is_read: notification.is_read,
        created_at: notification.created_at,
      }
    );
  }

  return {
    emitted: notifications.filter(n => n.user_id).length,
  };
}

module.exports = {
  emitCreatedNotifications,
};
