"use strict";

const express = require("express");
const router = express.Router();
const communicationsController = require("./communications.controller");
const { authenticate } = require("../../middlewares/auth.middleware");
const { requireSchoolContext } = require("../../middlewares/requireSchoolContext");
const { authorizeSchoolRoles } = require("../../middlewares/authorizeSchoolRoles");

// ==========================================
// Multi-Tenant Middleware Chain
// authenticate -> requireSchoolContext
// ==========================================
router.use(authenticate, requireSchoolContext);

// UC 97: Send Assignment Deadline Notification (Student, Lecturer, School Admin)
router.post(
  "/assignment-deadline",
  authorizeSchoolRoles("student", "lecturer", "school_admin"),
  communicationsController.sendAssignmentDeadline
);

// UC 98: Send Submission Confirmation Email (Student, Lecturer, School Admin)
router.post(
  "/submission-confirmation",
  authorizeSchoolRoles("student", "lecturer", "school_admin"),
  communicationsController.sendSubmissionConfirmation
);

module.exports = router;
