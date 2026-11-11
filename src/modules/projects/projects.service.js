
const { validate: isUuid } = require('uuid');
const ClassesService = require('../classes/classes.service');
const ProjectsRepository = require('./projects.repository');

const validId = id =>
    typeof id === 'string' && isUuid(id);

const ProjectsService = {
    async createProject(data, user) {
        if (user.role !== 'student') {
            throw new Error('FORBIDDEN');
        }

        const { classId, name, description = '' } = data || {};

        if (
            !validId(classId) ||
            typeof name !== 'string' ||
            !name.trim() ||
            name.trim().length > 200 ||
            typeof description !== 'string' ||
            description.length > 5000
        ) {
            throw new Error('INVALID_PROJECT_DATA');
        }

        return ProjectsRepository.create({
            classId,
            ownerId: user.id,
            name: name.trim(),
            description: description.trim(),
        });
    },

    async getMyProjects(user) {
        if (user.role !== 'student') {
            throw new Error('FORBIDDEN');
        }

        return ProjectsRepository.findMyProjects(user.id);
    },

    async getClassProjects(classId, user) {
        if (!validId(classId)) {
            throw new Error('INVALID_PROJECT_DATA');
        }

        if (!['admin', 'lecturer'].includes(user.role)) {
            throw new Error('FORBIDDEN');
        }

        await ClassesService.getClassById(classId, user);

        return ProjectsRepository.findByClass(classId);
    },

    async getProject(projectId, user) {
        if (!validId(projectId)) {
            throw new Error('INVALID_PROJECT_DATA');
        }

        const project = await ProjectsRepository.findById(projectId);

        if (!project) {
            throw new Error('PROJECT_NOT_FOUND');
        }

        if (['admin', 'lecturer'].includes(user.role)) {
            await ClassesService.getClassById(project.class_id, user);
        } else if (user.role === 'student') {
            const member = await ProjectsRepository.findActiveMember(
                projectId,
                user.id
            );

            const inClass =
                await ProjectsRepository.isActiveClassMember(
                    project.class_id,
                    user.id
                );

            if (!member || !inClass) {
                throw new Error('FORBIDDEN');
            }
        } else {
            throw new Error('FORBIDDEN');
        }

        const members = await ProjectsRepository.findMembers(projectId);

        return { ...project, members };
    },

    async inviteMember(projectId, studentId, user) {
        if (user.role !== 'student') {
            throw new Error('FORBIDDEN');
        }

        if (!validId(projectId) || !validId(studentId)) {
            throw new Error('INVALID_PROJECT_DATA');
        }

        const project = await ProjectsRepository.findById(projectId);

        if (!project) {
            throw new Error('PROJECT_NOT_FOUND');
        }

        if (project.status !== 'active') {
            throw new Error('PROJECT_NOT_ACTIVE');
        }

        if (project.owner_id !== user.id) {
            throw new Error('FORBIDDEN');
        }

        if (studentId === user.id) {
            throw new Error('CANNOT_INVITE_SELF');
        }

        const [ownerInClass, recipientInClass] = await Promise.all([
            ProjectsRepository.isActiveClassMember(
                project.class_id, user.id
            ),
            ProjectsRepository.isActiveClassMember(
                project.class_id, studentId
            ),
        ]);

        if (!ownerInClass || !recipientInClass) {
            throw new Error('NOT_CLASS_MEMBER');
        }

        const invitation = await ProjectsRepository.invite({
            projectId,
            classId: project.class_id,
            userId: studentId,
            invitedBy: user.id,
        });

        if (!invitation) {
            throw new Error('INVITATION_ALREADY_EXISTS');
        }

        return invitation;
    },

    async respondToInvitation(invitationId, accept, user) {
        if (user.role !== 'student') {
            throw new Error('FORBIDDEN');
        }

        if (!validId(invitationId)) {
            throw new Error('INVALID_PROJECT_DATA');
        }

        return ProjectsRepository.respondToInvitation(
            invitationId,
            user.id,
            accept
        );
    },

    async getMyInvitations(user) {
        if (user.role !== 'student') {
            throw new Error('FORBIDDEN');
        }

        return ProjectsRepository.findPendingInvitations(user.id);
    },


    async getProjectInvitations(projectId, user) {
        if (user.role !== 'student') {
            throw new Error('FORBIDDEN');
        }

        if (!validId(projectId)) {
            throw new Error('INVALID_PROJECT_DATA');
        }

        // Lấy Project
        const project = await ProjectsRepository.findById(projectId);

        if (!project) {
            throw new Error('PROJECT_NOT_FOUND');
        }

        // Chỉ Owner được xem danh sách lời mời
        if (project.owner_id !== user.id) {
            throw new Error('FORBIDDEN');
        }

        // Owner phải còn thuộc lớp đang hoạt động
        const isClassMember =
            await ProjectsRepository.isActiveClassMember(
                project.class_id,
                user.id
            );

        if (!isClassMember) {
            throw new Error('FORBIDDEN');
        }

        return ProjectsRepository.findProjectInvitations(projectId);
    },

};

module.exports = ProjectsService;
