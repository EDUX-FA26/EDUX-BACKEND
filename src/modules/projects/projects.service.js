
const { validate: isUuid } = require('uuid');
const ClassesService = require('../classes/classes.service');
const ProjectsRepository = require('./projects.repository');

const validId = id =>
    typeof id === 'string' && isUuid(id);

const ProjectsService = {
    async createProject(data, tenant) {
        if (tenant.role !== 'student') {
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

        await ClassesService.getClassById(classId, tenant);

        return ProjectsRepository.create({
            classId,
            ownerId: tenant.userId,
            schoolId: tenant.schoolId,
            name: name.trim(),
            description: description.trim(),
        });
    },

    async getMyProjects(tenant) {
        if (tenant.role !== 'student') {
            throw new Error('FORBIDDEN');
        }

        return ProjectsRepository.findMyProjects(
            tenant.userId,
            tenant.schoolId
        );
    },

    async getClassProjects(classId, tenant) {
        if (!validId(classId)) {
            throw new Error('INVALID_PROJECT_DATA');
        }

        if (!['school_admin', 'lecturer'].includes(tenant.role)) {
            throw new Error('FORBIDDEN');
        }

        await ClassesService.getClassById(classId, tenant);

        return ProjectsRepository.findByClass(
            classId,
            tenant.schoolId
        );
    },

    async getProject(projectId, tenant) {
        if (!validId(projectId)) {
            throw new Error('INVALID_PROJECT_DATA');
        }

        const project = await ProjectsRepository.findById(projectId);

        if (!project) {
            throw new Error('PROJECT_NOT_FOUND');
        }

        await ClassesService.getClassById(project.class_id, tenant);

        if (tenant.role === 'student') {
            const member = await ProjectsRepository.findActiveMember(
                projectId,
                tenant.userId
            );

            if (!member) {
                throw new Error('FORBIDDEN');
            }
        } else if (!['school_admin', 'lecturer'].includes(tenant.role)) {
            throw new Error('FORBIDDEN');
        }

        const members = await ProjectsRepository.findMembers(projectId);

        return { ...project, members };
    },

    async inviteMember(projectId, studentId, tenant) {
        if (tenant.role !== 'student') {
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

        await ClassesService.getClassById(project.class_id, tenant);

        if (project.owner_id !== tenant.userId) {
            throw new Error('FORBIDDEN');
        }

        if (studentId === tenant.userId) {
            throw new Error('CANNOT_INVITE_SELF');
        }

        const members = await ClassesService.getMembers(
            project.class_id,
            tenant
        );
        const activeMemberIds = new Set(
            members
                .filter(member => member.membershipStatus === 'active')
                .map(member => member.studentId)
        );
        const ownerInClass = activeMemberIds.has(tenant.userId);
        const recipientInClass = activeMemberIds.has(studentId);

        if (!ownerInClass || !recipientInClass) {
            throw new Error('NOT_CLASS_MEMBER');
        }

        const invitation = await ProjectsRepository.invite({
            projectId,
            classId: project.class_id,
            userId: studentId,
            invitedBy: tenant.userId,
        });

        if (!invitation) {
            throw new Error('INVITATION_ALREADY_EXISTS');
        }

        return invitation;
    },

    async respondToInvitation(invitationId, accept, tenant) {
        if (tenant.role !== 'student') {
            throw new Error('FORBIDDEN');
        }

        if (!validId(invitationId)) {
            throw new Error('INVALID_PROJECT_DATA');
        }

        const invitation =
            await ProjectsRepository.findInvitationForUser(
                invitationId,
                tenant.userId
            );

        if (!invitation) {
            throw new Error('INVITATION_NOT_FOUND');
        }

        await ClassesService.getClassById(
            invitation.class_id,
            tenant
        );

        return ProjectsRepository.respondToInvitation(
            invitationId,
            tenant.userId,
            accept
        );
    },

    async getMyInvitations(tenant) {
        if (tenant.role !== 'student') {
            throw new Error('FORBIDDEN');
        }

        return ProjectsRepository.findPendingInvitations(
            tenant.userId,
            tenant.schoolId
        );
    },


    async getProjectInvitations(projectId, tenant) {
        if (tenant.role !== 'student') {
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

        await ClassesService.getClassById(project.class_id, tenant);

        // Chỉ Owner được xem danh sách lời mời
        if (project.owner_id !== tenant.userId) {
            throw new Error('FORBIDDEN');
        }

        return ProjectsRepository.findProjectInvitations(
            projectId,
            tenant.schoolId
        );
    },

};

module.exports = ProjectsService;
