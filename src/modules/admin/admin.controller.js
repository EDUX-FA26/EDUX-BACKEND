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
   * POST /api/admin/users/import
   * Import dữ liệu từ Excel
   */
  async importExcel(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "Vui lòng đính kèm file Excel" });
      }

      const result = await adminService.importExcelData(req.file.buffer);
      res.status(200).json({
        success: true,
        message: "Import dữ liệu thành công",
        data: result,
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

  /**
   * GET /api/admin/notifications
   * Lấy danh sách thông báo hệ thống đã phát
   */
  async getSystemNotifications(req, res, next) {
    try {
      const notifications = await adminService.getSystemNotifications();
      res.status(200).json({
        success: true,
        message: "Lấy danh sách thông báo thành công",
        data: notifications,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/admin/classes
   * Lấy danh sách toàn bộ lớp học
   */
  async getAllClasses(req, res, next) {
    try {
      const classes = await adminService.getAllClasses();
      res.status(200).json({
        success: true,
        message: "Lấy danh sách lớp học thành công",
        data: classes,
      });
    } catch (error) {
      next(error);
    }
  },

  async createClass(req, res, next) {
    try {
      const created = await adminService.createClass(req.body);
      res.status(201).json({
        success: true,
        message: "Tạo lớp học thành công",
        data: created,
      });
    } catch (error) {
      next(error);
    }
  },

  async updateClass(req, res, next) {
    try {
      const classId = req.params.id;
      const data = await adminService.updateClass(classId, req.body);
      res.status(200).json({ success: true, message: "Cập nhật lớp học thành công", data });
    } catch (error) {
      next(error);
    }
  },

  async deleteClass(req, res, next) {
    try {
      const classId = req.params.id;
      await adminService.deleteClass(classId);
      res.status(200).json({ success: true, message: "Xóa lớp học thành công" });
    } catch (error) {
      next(error);
    }
  },

  async getAllDepartments(req, res, next) {
    try {
      const departments = await adminService.getAllDepartments();
      res.status(200).json({
        success: true,
        message: "Lấy danh sách khoa thành công",
        data: departments,
      });
    } catch (error) {
      next(error);
    }
  },

  async createDepartment(req, res, next) {
    try {
      const department = await adminService.createDepartment(req.body);
      res.status(201).json({
        success: true,
        message: "Tạo khoa thành công",
        data: department,
      });
    } catch (error) {
      next(error);
    }
  },

  async updateDepartment(req, res, next) {
    try {
      const department = await adminService.updateDepartment(req.params.id, req.body);
      res.status(200).json({
        success: true,
        message: "Cập nhật khoa thành công",
        data: department,
      });
    } catch (error) {
      next(error);
    }
  },

  async deleteDepartment(req, res, next) {
    try {
      const result = await adminService.deleteDepartment(req.params.id);
      res.status(200).json({
        success: true,
        message: result.action === "deactivated" ? "Đã ngưng hoạt động khoa" : "Đã xóa khoa thành công",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },

  async importAutoAssignExcel(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "Vui lòng đính kèm file Excel" });
      }
      const result = await adminService.importAutoAssignExcelData(req.file.buffer);
      res.status(200).json({
        success: true,
        message: "Tự động xếp lớp thành công",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
};

AdminController.getClassStudents = async (req, res, next) => {
  try {
    const classId = req.params.id;
    const students = await adminService.getClassStudents(classId);
    res.status(200).json({ success: true, message: "Lấy danh sách sinh viên thành công", data: students });
  } catch (error) {
    next(error);
  }
};

AdminController.addClassStudent = async (req, res, next) => {
  try {
    const classId = req.params.id;
    const student = await adminService.addClassStudent(classId, req.body);
    res.status(201).json({
      success: true,
      message: "Đã thêm sinh viên vào lớp học",
      data: student,
    });
  } catch (error) {
    next(error);
  }
};

AdminController.getLecturers = async (req, res, next) => {
  try {
    const lecturers = await adminService.getLecturers();
    res.status(200).json({ success: true, data: lecturers });
  } catch (error) {
    next(error);
  }
};

AdminController.removeClassStudent = async (req, res, next) => {
  try {
    const { id: classId, studentId } = req.params;
    await adminService.removeClassStudent(classId, studentId);
    res.status(200).json({ success: true, message: "Đã xóa sinh viên khỏi lớp" });
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ success: false, message: error.message });
    }
    next(error);
  }
};

AdminController.importUsers = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Vui lòng đính kèm file Excel hoặc CSV" });
    }
    const result = await adminService.importUsersData(req.file.buffer, req.file.originalname);
    res.status(200).json({
      success: true,
      message: `Đã tạo ${result.importedUsers} tài khoản; bỏ qua ${result.skippedUsers} bản ghi.`,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = AdminController;
