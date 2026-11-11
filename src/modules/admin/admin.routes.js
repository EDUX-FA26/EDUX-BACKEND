const express = require("express");
const router = express.Router();

const adminController = require("./admin.controller");
const { authenticate } = require("../../middlewares/auth.middleware");
const { authorize } = require("../../middlewares/role.middleware");
const { validate } = require("../../middlewares/validate.middleware");
const {
  createUserSchema,
  updateUserSchema,
  broadcastNotificationSchema,
  createDepartmentSchema,
  updateDepartmentSchema,
  createClassSchema,
  addClassStudentSchema,
} = require("./admin.validation");

const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

// Tất cả routes admin đều phải xác thực và có role admin
router.use(authenticate, authorize(["admin"]));

// Import Excel để tự động tạo user và lớp
router.post("/users/import", upload.single("file"), adminController.importExcel);
router.post("/users/import-list", upload.single("file"), adminController.importUsers);
router.post("/classes/import", upload.single("file"), adminController.importExcel);
router.post("/classes/auto-assign", upload.single("file"), adminController.importAutoAssignExcel);

// Quản lý Khoa / Bộ môn (Departments)
router.get("/departments", adminController.getAllDepartments);
router.post("/departments", validate(createDepartmentSchema), adminController.createDepartment);
router.patch("/departments/:id", validate(updateDepartmentSchema), adminController.updateDepartment);
router.delete("/departments/:id", adminController.deleteDepartment);

// UC — Lấy danh sách users (phục vụ giao diện quản lý)
router.get("/users", adminController.getAllUsers);

// UC 86 — Tạo user mới
router.post("/users", validate(createUserSchema), adminController.createUser);

// UC 87 — Cập nhật thông tin user
router.patch("/users/:id", validate(updateUserSchema), adminController.updateUser);

// UC 88 — Tạm khóa tài khoản
router.patch("/users/:id/suspend", adminController.suspendUser);

// UC 89 — Kích hoạt lại tài khoản
router.patch("/users/:id/activate", adminController.activateUser);

// UC 90 — Broadcast Notification
router.get("/notifications", adminController.getSystemNotifications);
router.post("/notifications/broadcast", validate(broadcastNotificationSchema), adminController.broadcastNotification);

// Lấy danh sách lớp học & tạo lớp học mới
router.get("/classes", adminController.getAllClasses);
router.post("/classes", validate(createClassSchema), adminController.createClass);

// Lấy danh sách giảng viên đang hoạt động
router.get("/lecturers", adminController.getLecturers);

// Lấy danh sách sinh viên trong lớp & thêm sinh viên vào lớp
router.get("/classes/:id/students", adminController.getClassStudents);
router.post("/classes/:id/students", validate(addClassStudentSchema), adminController.addClassStudent);

// Lấy và cập nhật danh sách Slot học (20 sessions) của lớp
router.get("/classes/:id/slots", adminController.getClassSlots);
router.put("/classes/:id/slots", adminController.updateClassSlots);

// Xóa sinh viên khỏi lớp học (SRS 3.7.7)
router.delete("/classes/:id/students/:studentId", adminController.removeClassStudent);
router.delete("/classes/:id/members/:studentId", adminController.removeClassStudent);

// Cập nhật lớp học
router.patch("/classes/:id", adminController.updateClass);

// Xóa lớp học
router.delete("/classes/:id", adminController.deleteClass);

module.exports = router;
