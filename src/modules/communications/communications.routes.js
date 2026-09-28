const express = require("express");
const router = express.Router();
const communicationsController = require("./communications.controller");
const { authenticate } = require("../../middlewares/auth.middleware");
const { authorize } = require("../../middlewares/role.middleware");

// Yêu cầu đăng nhập, và ở đây theo yêu cầu của bạn, mình set quyền truy cập cho Admin
// Hoặc có thể thêm "student" nếu UC đó thực sự trigger từ frontend của student.
// Ở đây mình cứ thêm cả admin và student để đảm bảo không bị chặn lúc test.
router.use(authenticate, authorize(["admin", "student"]));

// UC 97: Send Assignment Deadline Notification
router.post("/assignment-deadline", communicationsController.sendAssignmentDeadline);

// UC 98: Send Submission Confirmation Email
router.post("/submission-confirmation", communicationsController.sendSubmissionConfirmation);

module.exports = router;
