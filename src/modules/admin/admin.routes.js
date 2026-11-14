const express = require("express");
const router = express.Router();

const adminController = require("./admin.controller");
const { authenticate } = require("../../middlewares/auth.middleware");
const { validate } = require("../../middlewares/validate.middleware");
const {
  createUserSchema,
  updateUserSchema,
  broadcastNotificationSchema,
  createDepartmentSchema,
  updateDepartmentSchema,
  createClassSchema,
  updateClassSchema,
  addClassStudentSchema,
  updateClassSlotsSchema,
} = require("./admin.validation");

const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

// Tất cả routes admin đều phải xác thực và có role admin

const {
  requireSchoolContext,
} = require("../../middlewares/requireSchoolContext");

const {
  authorizeSchoolRoles,
} = require("../../middlewares/authorizeSchoolRoles");

// JWT authentication for the entire Admin Router.
router.use(authenticate);

// =============================================
// 007D-3A: SCHOOL MEMBER MANAGEMENT
// =============================================

const schoolAdminOnly = [
  requireSchoolContext,
  authorizeSchoolRoles("school_admin"),
];

router.get(
  "/users",
  ...schoolAdminOnly,
  adminController.getAllUsers
);

router.patch(
  "/users/:id/suspend",
  ...schoolAdminOnly,
  adminController.suspendUser
);

router.patch(
  "/users/:id/activate",
  ...schoolAdminOnly,
  adminController.activateUser
);

// =============================================
// TEMPORARY LEGACY ROUTES
// Must be migrated before multi-school launch.
// =============================================
router.post(
  "/users",
  ...schoolAdminOnly,
  validate(createUserSchema),
  adminController.createUser
);

router.patch(
  "/users/:id",
  ...schoolAdminOnly,
  validate(updateUserSchema),
  adminController.updateUser
);


router.get(
  "/departments",
  ...schoolAdminOnly,
  adminController.getAllDepartments
);

router.post(
  "/departments",
  ...schoolAdminOnly,
  validate(createDepartmentSchema),
  adminController.createDepartment
);

router.patch(
  "/departments/:id",
  ...schoolAdminOnly,
  validate(updateDepartmentSchema),
  adminController.updateDepartment
);

router.delete(
  "/departments/:id",
  ...schoolAdminOnly,
  adminController.deleteDepartment
);


router.get(
  "/lecturers",
  ...schoolAdminOnly,
  adminController.getLecturers
);

router.get(
  "/classes",
  ...schoolAdminOnly,
  adminController.getAllClasses
);

router.get(
  "/classes/:id/students",
  ...schoolAdminOnly,
  adminController.getClassStudents
);

router.get(
  "/classes/:id/slots",
  ...schoolAdminOnly,
  adminController.getClassSlots
);

router.post(
  "/classes",
  ...schoolAdminOnly,
  validate(createClassSchema),
  adminController.createClass
);

router.patch(
  "/classes/:id",
  ...schoolAdminOnly,
  validate(updateClassSchema),
  adminController.updateClass
);

router.delete(
  "/classes/:id",
  ...schoolAdminOnly,
  adminController.deleteClass
);


router.post(
  "/classes/:id/students",
  ...schoolAdminOnly,
  validate(addClassStudentSchema),
  adminController.addClassStudent
);

router.use(...schoolAdminOnly);

// Import Excel để tự động tạo user và lớp
router.post("/users/import", upload.single("file"), adminController.importExcel);
router.post("/users/import-list", upload.single("file"), adminController.importUsers);
router.post("/classes/import", upload.single("file"), adminController.importExcel);
router.post("/classes/auto-assign", upload.single("file"), adminController.importAutoAssignExcel);

// UC — Lấy danh sách users (phục vụ giao diện quản lý)
router.get("/users", adminController.getAllUsers);


// UC 88 — Tạm khóa tài khoản
router.patch("/users/:id/suspend", adminController.suspendUser);

// UC 89 — Kích hoạt lại tài khoản
router.patch("/users/:id/activate", adminController.activateUser);

// UC 90 — Broadcast Notification
router.get("/notifications", adminController.getSystemNotifications);
router.post("/notifications/broadcast", validate(broadcastNotificationSchema), adminController.broadcastNotification);

// Lấy và cập nhật danh sách Slot học (20 sessions) của lớp
router.put(
  "/classes/:id/slots",
  validate(updateClassSlotsSchema),
  adminController.updateClassSlots
);

// Xóa sinh viên khỏi lớp học (SRS 3.7.7)
router.delete("/classes/:id/students/:studentId", adminController.removeClassStudent);
router.delete("/classes/:id/members/:studentId", adminController.removeClassStudent);

module.exports = router;
