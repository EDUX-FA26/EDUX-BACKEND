
"use strict";

const express = require("express");

const router = express.Router({
    mergeParams: true,
});

const { authorizeSchoolRoles } = require(
    "../../../middlewares/authorizeSchoolRoles"
);

const controller = require("./tasks.controller");

// ==========================================
// TASK MANAGEMENT ROUTES
// ==========================================

// Authentication và School Context được
// thực hiện tại projects.routes.js.

// Chỉ sinh viên thuộc Project mới được thao tác.
// Kiểm tra membership cụ thể nằm trong Service.


// ==========================================
// READ-ONLY ROUTES
// Student / Lecturer / School Admin
// ==========================================

router.get(
    "/",
    authorizeSchoolRoles(
        "student",
        "lecturer",
        "school_admin"
    ),
    controller.getTasks
);

router.get(
    "/:taskId",
    authorizeSchoolRoles(
        "student",
        "lecturer",
        "school_admin"
    ),
    controller.getTask
);

// ==========================================
// STUDENT WRITE ROUTES
// ==========================================

router.post(
    "/",
    authorizeSchoolRoles("student"),
    controller.createTask
);

router.patch(
    "/reorder",
    authorizeSchoolRoles("student"),
    controller.reorderTasks
);

router.patch(
    "/:taskId",
    authorizeSchoolRoles("student"),
    controller.updateTask
);

router.patch(
    "/:taskId/assignee",
    authorizeSchoolRoles("student"),
    controller.assignTask
);

router.patch(
    "/:taskId/status",
    authorizeSchoolRoles("student"),
    controller.updateTaskStatus
);

router.patch(
    "/:taskId/move",
    authorizeSchoolRoles("student"),
    controller.moveTask
);

router.delete(
    "/:taskId",
    authorizeSchoolRoles("student"),
    controller.deleteTask
);


module.exports = router;
