const express = require("express");
const router = express.Router();

const adminController = require("./admin.controller");
const { authenticate } = require("../../middlewares/auth.middleware");
const { authorize } = require("../../middlewares/role.middleware");
const { validate } = require("../../middlewares/validate.middleware");
const { createUserSchema, updateUserSchema, broadcastNotificationSchema } = require("./admin.validation");

// Tất cả routes admin đều phải xác thực và có role admin
router.use(authenticate, authorize(["admin"]));

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
router.post("/notifications/broadcast", validate(broadcastNotificationSchema), adminController.broadcastNotification);

module.exports = router;
