const express = require("express");
const router = express.Router();

const adminController = require("./admin.controller");
const { authenticate } = require("../../middlewares/auth.middleware");
const { authorize } = require("../../middlewares/role.middleware");
const { validate } = require("../../middlewares/validate.middleware");
const { createUserSchema, updateUserSchema, broadcastNotificationSchema } = require("./admin.validation");

const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

// Tất cả routes admin đều phải xác thực và có role admin
router.use(authenticate, authorize(["admin"]));

// Import Excel để tự động tạo user và lớp
router.post("/users/import", upload.single("file"), adminController.importExcel);

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

// Lấy danh sách lớp học
router.get("/classes", adminController.getAllClasses);

// Lấy danh sách sinh viên trong lớp
router.get("/classes/:id/students", adminController.getClassStudents);

// Cập nhật lớp học
router.patch("/classes/:id", adminController.updateClass);

// Xóa lớp học
router.delete("/classes/:id", adminController.deleteClass);

module.exports = router;
