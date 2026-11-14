
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

  let emitted = 0;

  for (const notification of notifications) {
    if (!notification.user_id) {
      continue;
    }

    let room;

    if (
      notification.notification_scope === "school" &&
      notification.school_id
    ) {
      room =
        `user:${notification.user_id}:school:${notification.school_id}`;

    } else if (
      notification.notification_scope === "platform" &&
      notification.school_id == null
    ) {
      room = `user:${notification.user_id}`;

    } else {
      console.warn(
        "[NOTIFICATION REALTIME] Invalid scope:",
        notification.id
      );

      continue;
    }

    io.to(room).emit("new_notification", {
      id: notification.id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      related_entity_type:
        notification.related_entity_type,
      related_entity_id:
        notification.related_entity_id,
      notification_scope:
        notification.notification_scope,
      school_id:
        notification.school_id,
      is_read:
        notification.is_read,
      created_at:
        notification.created_at,
    });

    emitted++;
  }

  return {
    emitted,
  };

}

module.exports = {
  emitCreatedNotifications,
};
