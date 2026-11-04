
const ProjectsService = require('./projects.service');

function handleError(error, res, next) {
    const messages = {
        INVALID_PROJECT_DATA: 400,
        NOT_CLASS_MEMBER: 403,
        FORBIDDEN: 403,
        CLASS_NOT_FOUND: 404,
        PROJECT_NOT_FOUND: 404,
        PROJECT_NOT_ACTIVE: 409,
        CANNOT_INVITE_SELF: 400,
        INVITATION_NOT_FOUND: 404,
        INVITATION_ALREADY_EXISTS: 409,
        INVITATION_ALREADY_PROCESSED: 409,
        INVITATION_NOT_AVAILABLE: 409,
    };

    if (messages[error.message]) {
        return res.status(messages[error.message]).json({
            success: false,
            message: error.message,
        });
    }

    // Unique active membership: không tham gia hai nhóm
    // trong cùng lớp.
    if (
        error.code === '23505' &&
        error.constraint === 'uq_project_active_member_per_class'
    ) {
        return res.status(409).json({
            success: false,
            message: 'ALREADY_IN_ANOTHER_PROJECT',
        });
    }

    if (error.code === '23505') {
        return res.status(409).json({
            success: false,
            message: 'PROJECT_CONFLICT',
        });
    }

    next(error);
}

const ProjectsController = {
    async create(req, res, next) {
        try {
            const result = await ProjectsService.createProject(
                req.body,
                req.user
            );

            return res.status(201).json({
                success: true,
                data: result,
            });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

    async getMine(req, res, next) {
        try {
            const data = await ProjectsService.getMyProjects(req.user);
            return res.json({ success: true, data });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

    async getByClass(req, res, next) {
        try {
            const data = await ProjectsService.getClassProjects(
                req.params.classId,
                req.user
            );

            return res.json({ success: true, data });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

    async getById(req, res, next) {
        try {
            const data = await ProjectsService.getProject(
                req.params.projectId,
                req.user
            );

            return res.json({ success: true, data });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

    async invite(req, res, next) {
        try {
            const data = await ProjectsService.inviteMember(
                req.params.projectId,
                req.body?.studentId,
                req.user
            );

            return res.status(201).json({
                success: true,
                data,
            });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

    async accept(req, res, next) {
        try {
            const data = await ProjectsService.respondToInvitation(
                req.params.id,
                true,
                req.user
            );

            return res.json({ success: true, data });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

    async reject(req, res, next) {
        try {
            const data = await ProjectsService.respondToInvitation(
                req.params.id,
                false,
                req.user
            );

            return res.json({ success: true, data });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

    async getInvitations(req, res, next) {
        try {
            const data = await ProjectsService.getMyInvitations(
                req.user
            );

            return res.json({ success: true, data });
        } catch (error) {
            return handleError(error, res, next);
        }
    },


    async getProjectInvitations(req, res, next) {
        try {
            const data =
                await ProjectsService.getProjectInvitations(
                    req.params.projectId,
                    req.user
                );

            return res.status(200).json({
                success: true,
                data,
            });
        } catch (error) {
            return handleError(error, res, next);
        }
    },

};

module.exports = ProjectsController;
