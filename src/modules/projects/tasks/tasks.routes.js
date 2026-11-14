
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

router.use(
    authorizeSchoolRoles("student")
);

// ==========================================
// TASK LIST
// ==========================================

// GET /api/projects/:projectId/tasks
router.get(
    "/",
    controller.getTasks
);

// ==========================================
// CREATE TASK
// ==========================================

// POST /api/projects/:projectId/tasks
router.post(
    "/",
    controller.createTask
);

// ==========================================
// KANBAN REORDER
// ==========================================

// PATCH /api/projects/:projectId/tasks/reorder
router.patch(
    "/reorder",
    controller.reorderTasks
);

// ==========================================
// TASK DETAIL
// ==========================================

// GET /api/projects/:projectId/tasks/:taskId
router.get(
    "/:taskId",
    controller.getTask
);

// ==========================================
// UPDATE TASK
// ==========================================

// PATCH /api/projects/:projectId/tasks/:taskId
router.patch(
    "/:taskId",
    controller.updateTask
);

// ==========================================
// ASSIGN TASK
// ==========================================

// PATCH /api/projects/:projectId/tasks/:taskId/assignee
router.patch(
    "/:taskId/assignee",
    controller.assignTask
);

// ==========================================
// UPDATE TASK STATUS
// ==========================================

// PATCH /api/projects/:projectId/tasks/:taskId/status
router.patch(
    "/:taskId/status",
    controller.updateTaskStatus
);

// PATCH /api/projects/:projectId/tasks/:taskId/move
router.patch(
    "/:taskId/move",
    controller.moveTask
);

// ==========================================
// DELETE TASK
// ==========================================

// DELETE /api/projects/:projectId/tasks/:taskId
router.delete(
    "/:taskId",
    controller.deleteTask
);

module.exports = router;
