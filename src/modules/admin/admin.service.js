const bcrypt = require("bcryptjs");
const adminRepository = require("./admin.repository");
const authRepository = require("../auth/auth.repository");
const notificationsRepository = require("../notifications/notifications.repository");
const { getIO } = require("../../config/socket.config");

const AdminService = {
  /**
   * UC 86 — Tạo user mới với role tùy chọn (admin, lecturer, student)
   */
  async createUser(data) {
    // 1. Kiểm tra trùng lặp email, username, student_code
    const duplicates = await authRepository.checkDuplication(
      data.email,
      data.username || null,
      data.student_code || null
    );
    if (duplicates && duplicates.length > 0) {
      const error = new Error(`Conflict: ${duplicates.join(", ")} đã tồn tại`);
      error.status = 409;
      throw error;
    }

    // 2. Hash password
    const password_hash = await bcrypt.hash(data.password, 10);

    const userData = {
      ...data,
      password_hash,
    };

    // 3. Tạo user (transaction: insert users + user_profiles)
    const newUser = await adminRepository.createUser(userData);

    // 4. Fetch lại full profile để trả về
    return await adminRepository.findUserByIdWithProfile(newUser.id);
  },

  /**
   * UC 87 — Cập nhật thông tin user
   */
  async updateUser(userId, data) {
    // Kiểm tra user tồn tại
    const existingUser = await adminRepository.findUserByIdWithProfile(userId);
    if (!existingUser) {
      const error = new Error("Không tìm thấy người dùng");
      error.status = 404;
      throw error;
    }

    // Nếu đổi email, kiểm tra trùng lặp
    if (data.email && data.email !== existingUser.email) {
      const duplicates = await authRepository.checkDuplication(data.email, null, null);
      if (duplicates && duplicates.includes("email")) {
        const error = new Error("Email đã được sử dụng");
        error.status = 409;
        throw error;
      }
    }

    // Nếu đổi student_code, kiểm tra trùng lặp
    if (data.student_code && data.student_code !== existingUser.student_code) {
      const duplicates = await authRepository.checkDuplication(null, null, data.student_code);
      if (duplicates && duplicates.includes("student_code")) {
        const error = new Error("Mã số sinh viên đã được sử dụng");
        error.status = 409;
        throw error;
      }
    }

    await adminRepository.updateUser(userId, data);

    // Trả về profile đã cập nhật
    return await adminRepository.findUserByIdWithProfile(userId);
  },

  /**
   * UC 88 — Tạm khóa tài khoản người dùng
   */
  async suspendUser(userId) {
    const existingUser = await adminRepository.findUserByIdWithProfile(userId);
    if (!existingUser) {
      const error = new Error("Không tìm thấy người dùng");
      error.status = 404;
      throw error;
    }

    await adminRepository.updateUserStatus(userId, false);
    return { success: true };
  },

  /**
   * UC 89 — Kích hoạt lại tài khoản người dùng
   */
  async activateUser(userId) {
    const existingUser = await adminRepository.findUserByIdWithProfile(userId);
    if (!existingUser) {
      const error = new Error("Không tìm thấy người dùng");
      error.status = 404;
      throw error;
    }

    await adminRepository.updateUserStatus(userId, true);
    return { success: true };
  },

  /**
   * Lấy danh sách tất cả users (phục vụ giao diện quản lý)
   */
  async getAllUsers() {
    return await adminRepository.getAllUsers();
  },

  /**
   * UC 90 — Broadcast Notification
   */
  async broadcastNotification(data) {
    const { title, message, target } = data;

    // 1. Lấy danh sách user IDs theo target
    const userIds = await adminRepository.findUserIdsByTarget(target);
    if (userIds.length === 0) return { success: true, count: 0 };

    // 2. Format notifications for bulk insert
    const notifications = userIds.map(userId => ({
      userId,
      title,
      message,
      type: "system_announcement",
      related_entity_type: "admin_broadcast",
      related_entity_id: null
    }));

    // 3. Bulk insert vào database
    const createdNotifications = await notificationsRepository.bulkCreate(notifications);

    // 4. Emit realtime event via Socket.IO
    const io = getIO();
    if (io) {
      if (target === "all") {
        io.emit("new_notification", { title, message, type: "system_announcement" });
      } else {
        // Emit tới từng user trong room của họ (mỗi user join room `user_${id}`)
        userIds.forEach(userId => {
          io.to(`user_${userId}`).emit("new_notification", { title, message, type: "system_announcement" });
        });
      }
    }

    return { success: true, count: createdNotifications.length };
  },
};

module.exports = AdminService;
