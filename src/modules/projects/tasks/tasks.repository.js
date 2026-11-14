
"use strict";

const { pool } = require("../../../config/db.config");

const TASK_COLUMNS = `
    t.id,
    t.project_id,
    t.school_id,
    t.task_number,
    t.title,
    t.description,
    t.type,
    t.status,
    t.priority,
    t.reporter_id,
    t.assignee_id,
    t.parent_task_id,
    t.position,
    t.due_date,
    t.completed_at,
    t.created_at,
    t.updated_at
`;

const TasksRepository = {

    // ==========================================
    // PROJECT ACCESS
    // ==========================================

    async findProject(projectId, schoolId, db = pool) {
        const { rows } = await db.query(
            `
            SELECT
                p.id,
                p.class_id,
                p.owner_id,
                p.school_id,
                p.name,
                p.status
            FROM projects p
            JOIN classes c
                ON c.id = p.class_id
                AND c.school_id = p.school_id
            WHERE p.id = $1
              AND p.school_id = $2
              AND c.is_active = true
            LIMIT 1
            `,
            [projectId, schoolId]
        );

        return rows[0] || null;
    },

    async findProjectMember(
        projectId,
        userId,
        schoolId,
        db = pool
    ) {
        const { rows } = await db.query(
            `
            SELECT
                pm.id,
                pm.project_id,
                pm.user_id,
                pm.role,
                pm.status
            FROM project_members pm
            JOIN projects p
                ON p.id = pm.project_id
                AND p.school_id = pm.school_id
            JOIN classes c
                ON c.id = p.class_id
                AND c.school_id = p.school_id
            JOIN class_members cm
                ON cm.class_id = p.class_id
                AND cm.student_id = pm.user_id
            JOIN public.school_memberships sm
                ON sm.school_id = pm.school_id
                AND sm.user_id = pm.user_id
            WHERE pm.project_id = $1
              AND pm.user_id = $2
              AND pm.school_id = $3
              AND pm.status = 'active'
              AND cm.status = 'active'
              AND sm.status = 'active'
              AND p.status = 'active'
              AND c.is_active = true
            LIMIT 1
            `,
            [projectId, userId, schoolId]
        );

        return rows[0] || null;
    },

    // ==========================================
    // GET TASK LIST
    // ==========================================

    async findByProject(projectId, schoolId) {
        const { rows } = await pool.query(
            `
            SELECT
                ${TASK_COLUMNS},
                assignee.full_name AS assignee_name,
                reporter.full_name AS reporter_name
            FROM project_tasks t
            JOIN projects p
                ON p.id = t.project_id
                AND p.school_id = t.school_id
            LEFT JOIN user_profiles assignee
                ON assignee.user_id = t.assignee_id
            LEFT JOIN user_profiles reporter
                ON reporter.user_id = t.reporter_id
            WHERE t.project_id = $1
              AND t.school_id = $2
              AND p.status = 'active'
            ORDER BY
                CASE t.status
                    WHEN 'todo' THEN 1
                    WHEN 'in_progress' THEN 2
                    WHEN 'in_review' THEN 3
                    WHEN 'done' THEN 4
                END,
                t.position ASC,
                t.created_at ASC,
                t.id ASC
            `,
            [projectId, schoolId]
        );

        return rows;
    },

    // ==========================================
    // GET TASK DETAIL
    // ==========================================

    async findById(
        taskId,
        projectId,
        schoolId,
        db = pool
    ) {
        const { rows } = await db.query(
            `
            SELECT
                ${TASK_COLUMNS},
                assignee.full_name AS assignee_name,
                reporter.full_name AS reporter_name
            FROM project_tasks t
            LEFT JOIN user_profiles assignee
                ON assignee.user_id = t.assignee_id
            LEFT JOIN user_profiles reporter
                ON reporter.user_id = t.reporter_id
            WHERE t.id = $1
              AND t.project_id = $2
              AND t.school_id = $3
            LIMIT 1
            `,
            [taskId, projectId, schoolId]
        );

        return rows[0] || null;
    },

    // ==========================================
    // CREATE TASK
    // ==========================================

    async create({
        projectId,
        schoolId,
        reporterId,
        title,
        description = "",
        type = "task",
        priority = "medium",
        assigneeId = null,
        parentTaskId = null,
        dueDate = null,
    }) {
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            // Khóa Project để tránh tạo Task khi
            // Project đang bị thay đổi trạng thái.
            const projectResult = await client.query(
                `
                SELECT p.id
                FROM projects p
                JOIN classes c
                    ON c.id = p.class_id
                    AND c.school_id = p.school_id
                WHERE p.id = $1
                  AND p.school_id = $2
                  AND p.status = 'active'
                  AND c.is_active = true
                FOR UPDATE OF p
                `,
                [projectId, schoolId]
            );

            if (!projectResult.rowCount) {
                throw new Error("PROJECT_NOT_ACTIVE");
            }

            const member = await this.findProjectMember(
                projectId,
                reporterId,
                schoolId,
                client
            );

            if (!member) {
                throw new Error("FORBIDDEN");
            }

            // Cấp số Task nguyên tử.
            const counterResult = await client.query(
                `
                INSERT INTO project_task_counters (
                    project_id,
                    next_number
                )
                VALUES ($1, 2)
                ON CONFLICT (project_id)
                DO UPDATE SET
                    next_number =
                        project_task_counters.next_number + 1
                RETURNING next_number - 1 AS task_number
                `,
                [projectId]
            );

            const taskNumber =
                counterResult.rows[0].task_number;

            // Xác định vị trí cuối cột To Do.
            const positionResult = await client.query(
                `
                SELECT COALESCE(MAX(position), 0) + 1
                    AS next_position
                FROM project_tasks
                WHERE project_id = $1
                  AND school_id = $2
                  AND status = 'todo'
                `,
                [projectId, schoolId]
            );

            const position =
                positionResult.rows[0].next_position;

            const { rows } = await client.query(
                `
                INSERT INTO project_tasks (
                    project_id,
                    school_id,
                    task_number,
                    title,
                    description,
                    type,
                    status,
                    priority,
                    reporter_id,
                    assignee_id,
                    parent_task_id,
                    position,
                    due_date
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6,
                    'todo', $7, $8, $9, $10,
                    $11, $12
                )
                RETURNING *
                `,
                [
                    projectId,
                    schoolId,
                    taskNumber,
                    title,
                    description,
                    type,
                    priority,
                    reporterId,
                    assigneeId,
                    parentTaskId,
                    position,
                    dueDate,
                ]
            );

            await client.query("COMMIT");

            return rows[0];

        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    },

    // ==========================================
    // UPDATE TASK
    // ==========================================

    async update(
        taskId,
        projectId,
        schoolId,
        changes
    ) {
        const allowedFields = {
            title: "title",
            description: "description",
            type: "type",
            priority: "priority",
            dueDate: "due_date",
            parentTaskId: "parent_task_id",
        };

        const fields = [];
        const values = [];

        for (const [key, column] of Object.entries(
            allowedFields
        )) {
            if (
                Object.prototype.hasOwnProperty.call(
                    changes,
                    key
                )
            ) {
                values.push(changes[key]);
                fields.push(
                    `${column} = $${values.length}`
                );
            }
        }

        if (!fields.length) {
            throw new Error("INVALID_TASK_DATA");
        }

        fields.push("updated_at = NOW()");

        values.push(taskId, projectId, schoolId);

        const offset = values.length - 3;

        const { rows } = await pool.query(
            `
            UPDATE project_tasks
            SET ${fields.join(", ")}
            WHERE id = $${offset + 1}
              AND project_id = $${offset + 2}
              AND school_id = $${offset + 3}
            RETURNING *
            `,
            values
        );

        return rows[0] || null;
    },

    // ==========================================
    // ASSIGN TASK
    // ==========================================

    async assign(
        taskId,
        projectId,
        schoolId,
        assigneeId
    ) {
        const { rows } = await pool.query(
            `
            UPDATE project_tasks
            SET assignee_id = $4,
                updated_at = NOW()
            WHERE id = $1
              AND project_id = $2
              AND school_id = $3
            RETURNING *
            `,
            [
                taskId,
                projectId,
                schoolId,
                assigneeId,
            ]
        );

        return rows[0] || null;
    },


    // ==========================================
    // UPDATE TASK STATUS
    // ==========================================

    async updateStatus(
        taskId,
        projectId,
        schoolId,
        status
    ) {
        const { rows } = await pool.query(
            `
            UPDATE project_tasks
            SET
                status = $4::varchar,

                completed_at =
                    CASE
                        WHEN $4::varchar = 'done'
                            THEN COALESCE(
                                completed_at,
                                NOW()
                            )
                        ELSE NULL
                    END,

                updated_at = NOW()

            WHERE id = $1
              AND project_id = $2
              AND school_id = $3

            RETURNING *
            `,
            [
                taskId,
                projectId,
                schoolId,
                status,
            ]
        );

        return rows[0] || null;
    },


    // ==========================================
    // REORDER KANBAN
    // ==========================================

    async reorder(
        projectId,
        schoolId,
        taskIds,
        status
    ) {
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            // Khóa Project để tuần tự hóa các lần
            // kéo thả trong cùng một Kanban.
            const projectResult = await client.query(
                `
                SELECT id
                FROM projects
                WHERE id = $1
                  AND school_id = $2
                  AND status = 'active'
                FOR UPDATE
                `,
                [projectId, schoolId]
            );

            if (!projectResult.rowCount) {
                throw new Error("PROJECT_NOT_ACTIVE");
            }

            const { rows } = await client.query(
                `
                SELECT id
                FROM project_tasks
                WHERE project_id = $1
                  AND school_id = $2
                  AND status = $3
                FOR UPDATE
                `,
                [projectId, schoolId, status]
            );

            const existingIds = new Set(
                rows.map(row => row.id)
            );

            if (
                taskIds.length !== existingIds.size ||
                new Set(taskIds).size !== taskIds.length ||
                taskIds.some(id => !existingIds.has(id))
            ) {
                throw new Error("INVALID_TASK_ORDER");
            }

            for (let index = 0; index < taskIds.length; index++) {
                await client.query(
                    `
                    UPDATE project_tasks
                    SET position = $1,
                        updated_at = NOW()
                    WHERE id = $2
                      AND project_id = $3
                      AND school_id = $4
                    `,
                    [
                        index + 1,
                        taskIds[index],
                        projectId,
                        schoolId,
                    ]
                );
            }

            await client.query("COMMIT");

            return {
                status,
                taskIds,
            };

        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    },


    // ==========================================
    // ATOMIC KANBAN MOVE
    // ==========================================

    async moveTask({
        taskId,
        projectId,
        schoolId,
        userId,
        status,
        targetIndex,
    }) {
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            // 1. Khóa Project để serialize các lần
            // di chuyển Task trong cùng một Board.
            const projectResult = await client.query(
                `
                SELECT p.id, p.owner_id
                FROM projects p
                JOIN classes c
                  ON c.id = p.class_id
                 AND c.school_id = p.school_id
                WHERE p.id = $1
                  AND p.school_id = $2
                  AND p.status = 'active'
                  AND c.is_active = true
                FOR UPDATE OF p
                `,
                [projectId, schoolId]
            );

            if (!projectResult.rowCount) {
                throw new Error("PROJECT_NOT_ACTIVE");
            }

            // 2. Kiểm tra membership trong transaction.
            const member = await this.findProjectMember(
                projectId,
                userId,
                schoolId,
                client
            );

            if (!member) {
                throw new Error("FORBIDDEN");
            }

            // 3. Khóa Task cần di chuyển.
            const taskResult = await client.query(
                `
                SELECT *
                FROM project_tasks
                WHERE id = $1
                  AND project_id = $2
                  AND school_id = $3
                FOR UPDATE
                `,
                [taskId, projectId, schoolId]
            );

            const task = taskResult.rows[0];

            if (!task) {
                throw new Error("TASK_NOT_FOUND");
            }

            const project = projectResult.rows[0];

            const isOwner =
                member.role === "owner" &&
                project.owner_id === userId;

            if (
                !isOwner &&
                task.assignee_id !== userId
            ) {
                throw new Error("FORBIDDEN");
            }

            // 4. Lấy toàn bộ Task để tính lại vị trí.
            // Project lock giúp các request move
            // của cùng Board được xử lý tuần tự.
            const allResult = await client.query(
                `
                SELECT id, status, position
                FROM project_tasks
                WHERE project_id = $1
                  AND school_id = $2
                ORDER BY
                    position ASC,
                    created_at ASC,
                    id ASC
                FOR UPDATE
                `,
                [projectId, schoolId]
            );

            const allTasks = allResult.rows;

            const sourceStatus = task.status;

            // Bỏ Task đang di chuyển ra khỏi danh sách.
            const remainingTasks = allTasks.filter(
                item => item.id !== taskId
            );

            const sourceTasks = remainingTasks.filter(
                item => item.status === sourceStatus
            );

            const destinationTasks =
                sourceStatus === status
                    ? sourceTasks
                    : remainingTasks.filter(
                        item => item.status === status
                    );

            const insertIndex = Math.min(
                targetIndex,
                destinationTasks.length
            );

            destinationTasks.splice(
                insertIndex,
                0,
                {
                    id: taskId,
                    status,
                }
            );

            // 5. Cập nhật trạng thái Task.
            await client.query(
                `
                UPDATE project_tasks
                SET
                    status = $4::varchar,

                    completed_at =
                        CASE
                            WHEN $4::varchar = 'done'
                                THEN COALESCE(
                                    completed_at,
                                    NOW()
                                )
                            ELSE NULL
                        END,

                    updated_at = NOW()

                WHERE id = $1
                  AND project_id = $2
                  AND school_id = $3
                `,
                [
                    taskId,
                    projectId,
                    schoolId,
                    status,
                ]
            );

            // 6. Chuẩn hóa vị trí trong cột.
            async function updatePositions(items) {
                for (
                    let index = 0;
                    index < items.length;
                    index++
                ) {
                    await client.query(
                        `
                        UPDATE project_tasks
                        SET position = $1,
                            updated_at = NOW()
                        WHERE id = $2
                          AND project_id = $3
                          AND school_id = $4
                        `,
                        [
                            index + 1,
                            items[index].id,
                            projectId,
                            schoolId,
                        ]
                    );
                }
            }

            if (sourceStatus !== status) {
                await updatePositions(sourceTasks);
            }

            await updatePositions(destinationTasks);

            // 7. Trả Task mới.
            const updatedResult = await client.query(
                `
                SELECT *
                FROM project_tasks
                WHERE id = $1
                  AND project_id = $2
                  AND school_id = $3
                `,
                [taskId, projectId, schoolId]
            );

            await client.query("COMMIT");

            return updatedResult.rows[0];

        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    },


    // ==========================================
    // DELETE TASK
    // ==========================================

    async remove(taskId, projectId, schoolId) {
        const { rows } = await pool.query(
            `
            DELETE FROM project_tasks
            WHERE id = $1
              AND project_id = $2
              AND school_id = $3
            RETURNING id
            `,
            [taskId, projectId, schoolId]
        );

        return rows[0] || null;
    },
};

module.exports = TasksRepository;
