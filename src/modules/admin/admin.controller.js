const adminService = require("./admin.service");

const AdminController = {

  // POST /api/admin/users
  async createUser(req, res, next) {
    try {
      const user = await adminService.createUser(
        req.body,
        req.tenant
      );

      return res.status(201).json({
        success: true,
        message: user.linked_existing_user
          ? "Đã thêm tài khoản có sẵn vào trường"
          : "Tạo tài khoản và thành viên thành công",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  },

  // PATCH /api/admin/users/:id
  async updateUser(req, res, next) {
    try {
      const user = await adminService.updateUser(
        req.params.id,
        req.body,
        req.tenant
      );

      return res.status(200).json({
        success: true,
        message: "Cập nhật thành viên thành công",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/admin/users
  async getAllUsers(req, res, next) {
    try {
      const users = await adminService.getAllUsers(
        req.tenant.schoolId
      );

      return res.status(200).json({
        success: true,
        message: "Lấy danh sách thành viên thành công",
        data: users,
      });
    } catch (error) {
      next(error);
    }
  },

  // PATCH /api/admin/users/:id/suspend
  async suspendUser(req, res, next) {
    try {
      await adminService.suspendUser({
        schoolId: req.tenant.schoolId,
        actorUserId: req.tenant.userId,
        targetUserId: req.params.id,
      });

      return res.status(200).json({
        success: true,
        message: "Đã tạm ngưng thành viên tại trường",
        data: null,
      });
    } catch (error) {
      next(error);
    }
  },

  // PATCH /api/admin/users/:id/activate
  async activateUser(req, res, next) {
    try {
      await adminService.activateUser({
        schoolId: req.tenant.schoolId,
        actorUserId: req.tenant.userId,
        targetUserId: req.params.id,
      });

      return res.status(200).json({
        success: true,
        message: "Đã kích hoạt thành viên tại trường",
        data: null,
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

      return res.status(501).json({
        success: false,
        code: "TENANT_IMPORT_NOT_READY",
        message: "Import chưa được bật vì luồng Legacy chưa bảo đảm ghi dữ liệu theo school context.",
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
      const result =
        await adminService.broadcastNotification(
          req.body,
          req.tenant
        );
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
      const notifications = await adminService.getSystemNotifications(
        req.tenant.schoolId
      );
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
      const classes =
        await adminService.getAllClasses(
          req.tenant.schoolId
        );

      return res.status(200).json({
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
      const created = await adminService.createClass(
        req.body,
        req.tenant
      );

      return res.status(201).json({
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
      const data = await adminService.updateClass(
        req.params.id,
        req.body,
        req.tenant
      );

      return res.status(200).json({
        success: true,
        message: "Cập nhật lớp học thành công",
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  async deleteClass(req, res, next) {
    try {
      const data = await adminService.deleteClass(
        req.params.id,
        req.tenant
      );

      return res.status(200).json({
        success: true,
        message: "Đã ngưng hoạt động lớp học",
        data,
      });
    } catch (error) {
      next(error);
    }
  },



  // GET /api/admin/departments
  async getAllDepartments(req, res, next) {
    try {
      const departments =
        await adminService.getAllDepartments(
          req.tenant.schoolId
        );

      return res.status(200).json({
        success: true,
        message: "Lấy danh sách khoa thành công",
        data: departments,
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/admin/departments
  async createDepartment(req, res, next) {
    try {
      const department =
        await adminService.createDepartment(
          req.body,
          req.tenant
        );

      return res.status(201).json({
        success: true,
        message: "Tạo khoa thành công",
        data: department,
      });
    } catch (error) {
      next(error);
    }
  },

  // PATCH /api/admin/departments/:id
  async updateDepartment(req, res, next) {
    try {
      const department =
        await adminService.updateDepartment(
          req.params.id,
          req.body,
          req.tenant
        );

      return res.status(200).json({
        success: true,
        message: "Cập nhật khoa thành công",
        data: department,
      });
    } catch (error) {
      next(error);
    }
  },

  // DELETE /api/admin/departments/:id
  async deleteDepartment(req, res, next) {
    try {
      const result =
        await adminService.deleteDepartment(
          req.params.id,
          req.tenant
        );

      return res.status(200).json({
        success: true,
        message: "Đã ngưng hoạt động khoa",
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
      return res.status(501).json({
        success: false,
        code: "TENANT_IMPORT_NOT_READY",
        message: "Import tự động xếp lớp chưa được bật vì luồng hiện tại ghi dữ liệu theo Legacy school; cần hoàn tất nhập theo school context trước khi sử dụng.",
      });
    } catch (error) {
      next(error);
    }
  }
};


AdminController.getLecturers = async (
  req,
  res,
  next
) => {
  try {
    const lecturers =
      await adminService.getLecturers(
        req.tenant.schoolId
      );

    return res.status(200).json({
      success: true,
      data: lecturers,
    });
  } catch (error) {
    next(error);
  }
};

AdminController.getClassStudents = async (
  req,
  res,
  next
) => {
  try {
    const students =
      await adminService.getClassStudents(
        req.params.id,
        req.tenant.schoolId
      );

    return res.status(200).json({
      success: true,
      message: "Lấy danh sách sinh viên thành công",
      data: students,
    });
  } catch (error) {
    next(error);
  }
};

AdminController.getClassSlots = async (
  req,
  res,
  next
) => {
  try {
    const slots =
      await adminService.getClassSlots(
        req.params.id,
        req.tenant.schoolId
      );

    return res.status(200).json({
      success: true,
      message: "Lấy danh sách slot học thành công",
      data: slots,
    });
  } catch (error) {
    next(error);
  }
};


AdminController.updateClassSlots = async (req, res, next) => {
  try {
    const classId = req.params.id;
    const slots = await adminService.updateClassSlots(
      classId,
      req.body,
      req.tenant
    );
    res.status(200).json({ success: true, message: "Cập nhật lịch và chia slot học thành công", data: slots });
  } catch (error) {
    next(error);
  }
};


AdminController.addClassStudent = async (
  req,
  res,
  next
) => {
  try {
    const student =
      await adminService.addClassStudent(
        req.params.id,
        req.body,
        req.tenant
      );

    return res.status(201).json({
      success: true,
      message: "Đã thêm sinh viên vào lớp học",
      data: student,
    });
  } catch (error) {
    next(error);
  }
};


AdminController.removeClassStudent = async (req, res, next) => {
  try {
    const { id: classId, studentId } = req.params;
    const result = await adminService.removeClassStudent(
      classId,
      studentId,
      req.tenant
    );
    res.status(200).json({
      success: true,
      message: "Đã ngừng thành viên khỏi lớp; lịch sử được giữ nguyên",
      data: result,
    });
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
    return res.status(501).json({
      success: false,
      code: "TENANT_IMPORT_NOT_READY",
      message: "Import người dùng chưa được bật vì luồng hiện tại tạo tài khoản Legacy với mật khẩu mặc định; cần quy trình cấp tài khoản an toàn theo trường.",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = AdminController;
