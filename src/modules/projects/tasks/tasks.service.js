
"use strict";

const { validate: isUuid } = require("uuid");
const TasksRepository = require("./tasks.repository");

// ==========================================
// CONSTANTS
// ==========================================

const TASK_TYPES = new Set([
    "task",
    "bug",
    "story",
]);

const TASK_STATUSES = new Set([
    "todo",
    "in_progress",
    "in_review",
    "done",
]);

const TASK_PRIORITIES = new Set([
    "low",
    "medium",
    "high",
    "critical",
]);

const validId = (value) =>
    typeof value === "string" &&
    isUuid(value);

// ==========================================
// VALIDATION HELPERS
// ==========================================

function invalidData() {
    throw new Error("INVALID_TASK_DATA");
}

function validateTitle(value) {
    if (
        typeof value !== "string" ||
        !value.trim() ||
        value.trim().length > 255
    ) {
        invalidData();
    }

    return value.trim();
}

function validateDescription(value) {
    if (
        typeof value !== "string" ||
        value.length > 10000
    ) {
        invalidData();
    }

    return value.trim();
}

function validateDueDate(value) {
    if (value === null) {
        return null;
    }

    if (
        typeof value !== "string" ||
        !value.trim()
    ) {
        invalidData();
    }

    // Chấp nhận timestamp ISO 8601 có timezone.
    const isoWithTimezone =
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i;

    if (!isoWithTimezone.test(value)) {
        invalidData();
    }

    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {
        invalidData();
    }

    return date.toISOString();
}

function validateNullableId(value) {
    if (value === null) {
        return null;
    }

    if (!validId(value)) {
        invalidData();
    }

    return value;
}

function isPlainObject(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
    );
}

function ensureAllowedFields(data, allowedFields) {
    if (!isPlainObject(data)) {
        invalidData();
    }

    const keys = Object.keys(data);

    if (
        keys.length === 0 ||
        keys.some(key => !allowedFields.has(key))
    ) {
        invalidData();
    }
}

// ==========================================
// TENANT & PROJECT ACCESS
// ==========================================

async function requireProjectAccess(
    projectId,
    tenant
) {
    if (
        !tenant ||
        !validId(tenant.schoolId) ||
        !validId(tenant.userId) ||
        tenant.role !== "student"
    ) {
        throw new Error("FORBIDDEN");
    }

    if (!validId(projectId)) {
        invalidData();
    }

    const project = await TasksRepository.findProject(
        projectId,
        tenant.schoolId
    );

    if (!project) {
        throw new Error("PROJECT_NOT_FOUND");
    }

    if (project.status !== "active") {
        throw new Error("PROJECT_NOT_ACTIVE");
    }

    const member = await TasksRepository.findProjectMember(
        projectId,
        tenant.userId,
        tenant.schoolId
    );

    if (!member) {
        throw new Error("FORBIDDEN");
    }

    return {
        project,
        member,
        isOwner: (
            member.role === "owner" &&
            project.owner_id === tenant.userId
        ),
    };
}

// ==========================================
// TASK ACCESS
// ==========================================

async function requireTask(
    taskId,
    projectId,
    tenant
) {
    if (!validId(taskId)) {
        invalidData();
    }

    const access = await requireProjectAccess(
        projectId,
        tenant
    );

    const task = await TasksRepository.findById(
        taskId,
        projectId,
        tenant.schoolId
    );

    if (!task) {
        throw new Error("TASK_NOT_FOUND");
    }

    return {
        ...access,
        task,
    };
}

function canEditTask(access, userId) {
    return (
        access.isOwner ||
        access.task.assignee_id === userId
    );
}

// ==========================================
// ASSIGNEE VALIDATION
// ==========================================

async function validateAssignee(
    projectId,
    assigneeId,
    schoolId
) {
    if (assigneeId === null) {
        return null;
    }

    if (!validId(assigneeId)) {
        invalidData();
    }

    const member = await TasksRepository.findProjectMember(
        projectId,
        assigneeId,
        schoolId
    );

    if (!member) {
        throw new Error("ASSIGNEE_NOT_PROJECT_MEMBER");
    }

    return assigneeId;
}

// ==========================================
// PARENT TASK VALIDATION
// ==========================================

async function validateParentTask(
    parentTaskId,
    taskId,
    projectId,
    schoolId
) {
    if (parentTaskId === null) {
        return null;
    }

    if (!validId(parentTaskId)) {
        invalidData();
    }

    if (taskId && parentTaskId === taskId) {
        throw new Error("INVALID_PARENT_TASK");
    }

    const parent = await TasksRepository.findById(
        parentTaskId,
        projectId,
        schoolId
    );

    if (!parent) {
        throw new Error("PARENT_TASK_NOT_FOUND");
    }

    // Giai đoạn đầu chỉ hỗ trợ một cấp Subtask.
    // Không cho Subtask trở thành Task cha.
    if (parent.parent_task_id !== null) {
        throw new Error("INVALID_PARENT_TASK");
    }

    // Khi sửa parent, tránh tạo chu kỳ 2 chiều.
    if (taskId) {
        const task = await TasksRepository.findById(
            taskId,
            projectId,
            schoolId
        );

        if (!task) {
            throw new Error("TASK_NOT_FOUND");
        }

        // Task có con không được trở thành Subtask.
        const tasks = await TasksRepository.findByProject(
            projectId,
            schoolId
        );

        if (tasks.some(t => t.parent_task_id === taskId)) {
            throw new Error("INVALID_PARENT_TASK");
        }
    }

    return parentTaskId;
}

// ==========================================
// TASK SERVICE
// ==========================================

const TasksService = {

    // ======================================
    // GET TASKS
    // ======================================

    async getTasks(projectId, tenant) {
        await requireProjectAccess(
            projectId,
            tenant
        );

        return TasksRepository.findByProject(
            projectId,
            tenant.schoolId
        );
    },

    // ======================================
    // GET TASK DETAIL
    // ======================================

    async getTask(
        projectId,
        taskId,
        tenant
    ) {
        const { task } = await requireTask(
            taskId,
            projectId,
            tenant
        );

        return task;
    },

    // ======================================
    // CREATE TASK
    // ======================================

    async createTask(
        projectId,
        data,
        tenant
    ) {
        const access = await requireProjectAccess(
            projectId,
            tenant
        );

        ensureAllowedFields(
            data,
            new Set([
                "title",
                "description",
                "type",
                "priority",
                "assigneeId",
                "parentTaskId",
                "dueDate",
            ])
        );

        const title = validateTitle(data.title);

        const description = validateDescription(
            data.description ?? ""
        );

        const type = data.type ?? "task";

        const priority = data.priority ?? "medium";

        if (!TASK_TYPES.has(type)) {
            invalidData();
        }

        if (!TASK_PRIORITIES.has(priority)) {
            invalidData();
        }

        const assigneeId = validateNullableId(
            data.assigneeId ?? null
        );

        // Member có thể tạo Task nhưng chỉ Owner
        // được chủ động giao việc cho người khác.
        if (
            !access.isOwner &&
            assigneeId !== null &&
            assigneeId !== tenant.userId
        ) {
            throw new Error("FORBIDDEN");
        }

        await validateAssignee(
            projectId,
            assigneeId,
            tenant.schoolId
        );

        const parentTaskId = await validateParentTask(
            data.parentTaskId ?? null,
            null,
            projectId,
            tenant.schoolId
        );

        const dueDate = (
            data.dueDate === undefined
                ? null
                : validateDueDate(data.dueDate)
        );

        return TasksRepository.create({
            projectId,
            schoolId: tenant.schoolId,
            reporterId: tenant.userId,
            title,
            description,
            type,
            priority,
            assigneeId,
            parentTaskId,
            dueDate,
        });
    },

    // ======================================
    // UPDATE TASK
    // ======================================

    async updateTask(
        projectId,
        taskId,
        data,
        tenant
    ) {
        const access = await requireTask(
            taskId,
            projectId,
            tenant
        );

        if (!canEditTask(access, tenant.userId)) {
            throw new Error("FORBIDDEN");
        }

        ensureAllowedFields(
            data,
            new Set([
                "title",
                "description",
                "type",
                "priority",
                "dueDate",
                "parentTaskId",
            ])
        );

        const changes = {};

        if (
            Object.prototype.hasOwnProperty.call(
                data,
                "title"
            )
        ) {
            changes.title = validateTitle(data.title);
        }

        if (
            Object.prototype.hasOwnProperty.call(
                data,
                "description"
            )
        ) {
            changes.description = validateDescription(
                data.description
            );
        }

        if (
            Object.prototype.hasOwnProperty.call(
                data,
                "type"
            )
        ) {
            if (!TASK_TYPES.has(data.type)) {
                invalidData();
            }

            changes.type = data.type;
        }

        if (
            Object.prototype.hasOwnProperty.call(
                data,
                "priority"
            )
        ) {
            if (!TASK_PRIORITIES.has(data.priority)) {
                invalidData();
            }

            changes.priority = data.priority;
        }

        if (
            Object.prototype.hasOwnProperty.call(
                data,
                "dueDate"
            )
        ) {
            changes.dueDate = validateDueDate(
                data.dueDate
            );
        }

        if (
            Object.prototype.hasOwnProperty.call(
                data,
                "parentTaskId"
            )
        ) {
            // Chỉ Owner được thay đổi cấu trúc Task.
            if (!access.isOwner) {
                throw new Error("FORBIDDEN");
            }

            changes.parentTaskId =
                await validateParentTask(
                    data.parentTaskId,
                    taskId,
                    projectId,
                    tenant.schoolId
                );
        }

        const updated = await TasksRepository.update(
            taskId,
            projectId,
            tenant.schoolId,
            changes
        );

        if (!updated) {
            throw new Error("TASK_NOT_FOUND");
        }

        return updated;
    },

    // ======================================
    // ASSIGN TASK
    // ======================================

    async assignTask(
        projectId,
        taskId,
        assigneeId,
        tenant
    ) {
        const access = await requireTask(
            taskId,
            projectId,
            tenant
        );

        if (!access.isOwner) {
            throw new Error("FORBIDDEN");
        }

        const validAssignee = validateNullableId(
            assigneeId
        );

        await validateAssignee(
            projectId,
            validAssignee,
            tenant.schoolId
        );

        const updated = await TasksRepository.assign(
            taskId,
            projectId,
            tenant.schoolId,
            validAssignee
        );

        if (!updated) {
            throw new Error("TASK_NOT_FOUND");
        }

        return updated;
    },

    // ======================================
    // UPDATE STATUS
    // ======================================

    async updateTaskStatus(
        projectId,
        taskId,
        status,
        tenant
    ) {
        const access = await requireTask(
            taskId,
            projectId,
            tenant
        );

        if (!canEditTask(access, tenant.userId)) {
            throw new Error("FORBIDDEN");
        }

        if (!TASK_STATUSES.has(status)) {
            invalidData();
        }

        const updated =
            await TasksRepository.updateStatus(
                taskId,
                projectId,
                tenant.schoolId,
                status
            );

        if (!updated) {
            throw new Error("TASK_NOT_FOUND");
        }

        return updated;
    },

    // ======================================
    // REORDER KANBAN
    // ======================================

    async reorderTasks(
        projectId,
        data,
        tenant
    ) {
        await requireProjectAccess(
            projectId,
            tenant
        );

        ensureAllowedFields(
            data,
            new Set(["status", "taskIds"])
        );

        const { status, taskIds } = data;

        if (!TASK_STATUSES.has(status)) {
            invalidData();
        }

        if (
            !Array.isArray(taskIds) ||
            taskIds.length > 1000 ||
            taskIds.some(id => !validId(id)) ||
            new Set(taskIds).size !== taskIds.length
        ) {
            invalidData();
        }

        return TasksRepository.reorder(
            projectId,
            tenant.schoolId,
            taskIds,
            status
        );
    },


    // ==========================================
    // MOVE TASK IN KANBAN
    // ==========================================

    async moveTask(
        projectId,
        taskId,
        data,
        tenant
    ) {
        // Kiểm tra tenant và quyền Project.
        await requireTask(
            taskId,
            projectId,
            tenant
        );

        ensureAllowedFields(
            data,
            new Set(["status", "targetIndex"])
        );

        const { status, targetIndex } = data;

        if (!TASK_STATUSES.has(status)) {
            throw new Error("INVALID_TASK_DATA");
        }

        if (
            !Number.isInteger(targetIndex) ||
            targetIndex < 0 ||
            targetIndex > 100000
        ) {
            throw new Error("INVALID_TASK_DATA");
        }

        return TasksRepository.moveTask({
            taskId,
            projectId,
            schoolId: tenant.schoolId,
            userId: tenant.userId,
            status,
            targetIndex,
        });
    },


    // ======================================
    // DELETE TASK
    // ======================================

    async deleteTask(
        projectId,
        taskId,
        tenant
    ) {
        const access = await requireTask(
            taskId,
            projectId,
            tenant
        );

        if (!access.isOwner) {
            throw new Error("FORBIDDEN");
        }

        const deleted = await TasksRepository.remove(
            taskId,
            projectId,
            tenant.schoolId
        );

        if (!deleted) {
            throw new Error("TASK_NOT_FOUND");
        }

        return {
            id: deleted.id,
            deleted: true,
        };
    },
};

module.exports = TasksService;
