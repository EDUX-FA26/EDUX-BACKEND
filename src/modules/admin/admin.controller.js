const adminService = require("./admin.service");

const AdminController = {
  /**
   * UC 86 — POST /api/admin/users
   * Tạo user mới
   */
  async createUser(req, res, next) {
    try {
      const user = await adminService.createUser(req.body);
      res.status(201).json({
        success: true,
        message: "Tạo người dùng thành công",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * UC 87 — PATCH /api/admin/users/:id
   * Cập nhật thông tin user
   */
  async updateUser(req, res, next) {
    try {
      const { id } = req.params;
      const user = await adminService.updateUser(id, req.body);
      res.status(200).json({
        success: true,
        message: "Cập nhật người dùng thành công",
        data: user,
      });
    } catch (error) {
      if (error.status === 404) {
        return res.status(404).json({ success: false, message: error.message });
      }
      if (error.status === 409) {
        return res.status(409).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  /**
   * UC 88 — PATCH /api/admin/users/:id/suspend
   * Tạm khóa tài khoản người dùng
   */
  async suspendUser(req, res, next) {
    try {
      const { id } = req.params;
      await adminService.suspendUser(id);
      res.status(200).json({
        success: true,
        message: "Tài khoản người dùng đã bị tạm khóa",
        data: null,
      });
    } catch (error) {
      if (error.status === 404) {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  /**
   * UC 89 — PATCH /api/admin/users/:id/activate
   * Kích hoạt lại tài khoản người dùng
   */
  async activateUser(req, res, next) {
    try {
      const { id } = req.params;
      await adminService.activateUser(id);
      res.status(200).json({
        success: true,
        message: "Tài khoản người dùng đã được kích hoạt",
        data: null,
      });
    } catch (error) {
      if (error.status === 404) {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  /**
   * GET /api/admin/users
   * Lấy danh sách tất cả users (phục vụ giao diện quản lý)
   */
  async getAllUsers(req, res, next) {
    try {
      const users = await adminService.getAllUsers();
      res.status(200).json({
        success: true,
        message: "Lấy danh sách người dùng thành công",
        data: users,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * UC 90 — POST /api/admin/notifications/broadcast
   * Gửi thông báo đến toàn hệ thống hoặc theo role
   */
  async broadcastNotification(req, res, next) {
    try {
      const result = await adminService.broadcastNotification(req.body);
      res.status(200).json({
        success: true,
        message: `Đã gửi thông báo thành công đến ${result.count} người dùng.`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
};

module.exports = AdminController;
