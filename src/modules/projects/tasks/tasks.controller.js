
"use strict";

const TasksService = require("./tasks.service");

// ==========================================
// ERROR HANDLER
// ==========================================

function handleError(error, res, next) {
    const errorStatuses = {
        // Validation
        INVALID_TASK_DATA: 400,
        INVALID_TASK_ORDER: 400,
        INVALID_PARENT_TASK: 400,

        // Authorization
        FORBIDDEN: 403,
        ASSIGNEE_NOT_PROJECT_MEMBER: 403,

        // Not found
        PROJECT_NOT_FOUND: 404,
        TASK_NOT_FOUND: 404,
        PARENT_TASK_NOT_FOUND: 404,

        // Conflict
        PROJECT_NOT_ACTIVE: 409,
    };

    const status = errorStatuses[error.message];

    if (status) {
        return res.status(status).json({
            success: false,
            message: error.message,
        });
    }

    // PostgreSQL CHECK, FK, NOT NULL
    if (
        error.code === "23514" ||
        error.code === "23503" ||
        error.code === "23502"
    ) {
        return res.status(409).json({
            success: false,
            message: "TASK_CONSTRAINT_VIOLATION",
        });
    }

    // Unique constraint
    if (error.code === "23505") {
        return res.status(409).json({
            success: false,
            message: "TASK_CONFLICT",
        });
    }

    return next(error);
}

// ==========================================
// TASK CONTROLLER
// ==========================================

const TasksController = {

    // ======================================
    // GET /:projectId/tasks
    // ======================================

    async getTasks(req, res, next) {
        try {
            const data = await TasksService.getTasks(
                req.params.projectId,
                req.tenant
            );

            return res.status(200).json({
                success: true,
                data,
            });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

    // ======================================
    // GET /:projectId/tasks/:taskId
    // ======================================

    async getTask(req, res, next) {
        try {
            const data = await TasksService.getTask(
                req.params.projectId,
                req.params.taskId,
                req.tenant
            );

            return res.status(200).json({
                success: true,
                data,
            });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

    // ======================================
    // POST /:projectId/tasks
    // ======================================

    async createTask(req, res, next) {
        try {
            const data = await TasksService.createTask(
                req.params.projectId,
                req.body,
                req.tenant
            );

            return res.status(201).json({
                success: true,
                message: "TASK_CREATED",
                data,
            });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

    // ======================================
    // PATCH /:projectId/tasks/:taskId
    // ======================================

    async updateTask(req, res, next) {
        try {
            const data = await TasksService.updateTask(
                req.params.projectId,
                req.params.taskId,
                req.body,
                req.tenant
            );

            return res.status(200).json({
                success: true,
                message: "TASK_UPDATED",
                data,
            });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

    // ======================================
    // PATCH /:projectId/tasks/:taskId/assignee
    // ======================================

    async assignTask(req, res, next) {
        try {
            const data = await TasksService.assignTask(
                req.params.projectId,
                req.params.taskId,
                req.body?.assigneeId,
                req.tenant
            );

            return res.status(200).json({
                success: true,
                message: "TASK_ASSIGNED",
                data,
            });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

    // ======================================
    // PATCH /:projectId/tasks/:taskId/status
    // ======================================

    async updateTaskStatus(req, res, next) {
        try {
            const data =
                await TasksService.updateTaskStatus(
                    req.params.projectId,
                    req.params.taskId,
                    req.body?.status,
                    req.tenant
                );

            return res.status(200).json({
                success: true,
                message: "TASK_STATUS_UPDATED",
                data,
            });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

    // ======================================
    // PATCH /:projectId/tasks/reorder
    // ======================================

    async reorderTasks(req, res, next) {
        try {
            const data = await TasksService.reorderTasks(
                req.params.projectId,
                req.body,
                req.tenant
            );

            return res.status(200).json({
                success: true,
                message: "TASKS_REORDERED",
                data,
            });
        } catch (error) {
            return handleError(error, res, next);
        }
    },


    // ==========================================
    // PATCH /:projectId/tasks/:taskId/move
    // ==========================================

    async moveTask(req, res, next) {
        try {
            const data = await TasksService.moveTask(
                req.params.projectId,
                req.params.taskId,
                req.body,
                req.tenant
            );

            return res.status(200).json({
                success: true,
                message: "TASK_MOVED",
                data,
            });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

    // ======================================
    // DELETE /:projectId/tasks/:taskId
    // ======================================

    async deleteTask(req, res, next) {
        try {
            const data = await TasksService.deleteTask(
                req.params.projectId,
                req.params.taskId,
                req.tenant
            );

            return res.status(200).json({
                success: true,
                message: "TASK_DELETED",
                data,
            });
        } catch (error) {
            return handleError(error, res, next);
        }
    },
};

module.exports = TasksController;
