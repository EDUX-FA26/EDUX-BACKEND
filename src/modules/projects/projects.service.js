
"use strict";

const { validate: isUuid } = require('uuid');
const ProjectsRepository = require('./projects.repository');

const validId = (id) => typeof id === 'string' && isUuid(id);

const ProjectsService = {
    async createProject(data, tenant) {
        if (!tenant || tenant.role !== 'student') {
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
        if (!tenant || tenant.role !== 'student') {
            throw new Error('FORBIDDEN');
        }

        return ProjectsRepository.findMyProjects(tenant.userId, tenant.schoolId);
    },

    async getClassProjects(classId, tenant) {
        if (!validId(classId)) {
            throw new Error('INVALID_PROJECT_DATA');
        }

        if (!tenant || !['school_admin', 'lecturer'].includes(tenant.role)) {
            throw new Error('FORBIDDEN');
        }

        if (tenant.role === 'lecturer') {
            const isLecturer = await ProjectsRepository.isClassLecturer(
                classId,
                tenant.userId,
                tenant.schoolId
            );
            if (!isLecturer) {
                throw new Error('FORBIDDEN');
            }
        }

        return ProjectsRepository.findByClass(
            classId,
            tenant.schoolId,
            tenant.userId,
            tenant.role
        );
    },

    async getProject(projectId, tenant) {
        if (!validId(projectId)) {
            throw new Error('INVALID_PROJECT_DATA');
        }

        if (!tenant) {
            throw new Error('FORBIDDEN');
        }

        const project = await ProjectsRepository.findById(
            projectId,
            tenant.schoolId
        );

        if (!project) {
            throw new Error('PROJECT_NOT_FOUND');
        }

        if (tenant.role === 'school_admin') {
            // school_admin có toàn quyền quản trị dự án trong trường
        } else if (tenant.role === 'lecturer') {
            const isLecturer = await ProjectsRepository.isClassLecturer(
                project.class_id,
                tenant.userId,
                tenant.schoolId
            );
            if (!isLecturer) {
                throw new Error('FORBIDDEN');
            }
        } else if (tenant.role === 'student') {
            const member = await ProjectsRepository.findActiveMember(
                projectId,
                tenant.userId,
                tenant.schoolId
            );

            const inClass = await ProjectsRepository.isActiveClassMember(
                project.class_id,
                tenant.userId,
                tenant.schoolId
            );

            if (!member || !inClass) {
                throw new Error('FORBIDDEN');
            }
        } else if (!['school_admin', 'lecturer'].includes(tenant.role)) {
            throw new Error('FORBIDDEN');
        }

        const members = await ProjectsRepository.findMembers(
            projectId,
            tenant.schoolId
        );

        return { ...project, members };
    },

    async inviteMember(projectId, studentId, tenant) {
        if (!tenant || tenant.role !== 'student') {
            throw new Error('FORBIDDEN');
        }

        if (!validId(projectId) || !validId(studentId)) {
            throw new Error('INVALID_PROJECT_DATA');
        }

        const project = await ProjectsRepository.findById(
            projectId,
            tenant.schoolId
        );

        if (!project) {
            throw new Error('PROJECT_NOT_FOUND');
        }

        if (project.status !== 'active') {
            throw new Error('PROJECT_NOT_ACTIVE');
        }

        if (project.owner_id !== tenant.userId) {
            throw new Error('FORBIDDEN');
        }

        if (studentId === tenant.userId) {
            throw new Error('CANNOT_INVITE_SELF');
        }

        // Xác minh thành viên được mời có membership hợp lệ tại trường
        const recipientInSchool = await ProjectsRepository.isActiveSchoolMember(
            studentId,
            tenant.schoolId
        );

        if (!recipientInSchool) {
            throw new Error('NOT_CLASS_MEMBER');
        }

        const [ownerInClass, recipientInClass] = await Promise.all([
            ProjectsRepository.isActiveClassMember(
                project.class_id,
                tenant.userId,
                tenant.schoolId
            ),
            ProjectsRepository.isActiveClassMember(
                project.class_id,
                studentId,
                tenant.schoolId
            ),
        ]);

        if (!ownerInClass || !recipientInClass) {
            throw new Error('NOT_CLASS_MEMBER');
        }

        const invitation = await ProjectsRepository.invite({
            projectId,
            classId: project.class_id,
            userId: studentId,
            invitedBy: tenant.userId,
            schoolId: tenant.schoolId,
        });

        if (!invitation) {
            throw new Error('INVITATION_ALREADY_EXISTS');
        }

        return invitation;
    },

    async respondToInvitation(invitationId, accept, tenant) {
        if (!tenant || tenant.role !== 'student') {
            throw new Error('FORBIDDEN');
        }

        if (!validId(invitationId)) {
            throw new Error('INVALID_PROJECT_DATA');
        }

        const invitation =
            await ProjectsRepository.findInvitationForUser(
                invitationId,
                tenant.userId,
                tenant.schoolId
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
            accept,
            tenant.schoolId
        );
    },

    async getMyInvitations(tenant) {
        if (!tenant || tenant.role !== 'student') {
            throw new Error('FORBIDDEN');
        }

        return ProjectsRepository.findPendingInvitations(
            tenant.userId,
            tenant.schoolId
        );
    },

    async getProjectInvitations(projectId, tenant) {
        if (!tenant || tenant.role !== 'student') {
            throw new Error('FORBIDDEN');
        }

        if (!validId(projectId)) {
            throw new Error('INVALID_PROJECT_DATA');
        }

        const project = await ProjectsRepository.findById(
            projectId,
            tenant.schoolId
        );

        if (!project) {
            throw new Error('PROJECT_NOT_FOUND');
        }

        if (project.owner_id !== tenant.userId) {
            throw new Error('FORBIDDEN');
        }

        const isClassMember = await ProjectsRepository.isActiveClassMember(
            project.class_id,
            tenant.userId,
            tenant.schoolId
        );

        if (!isClassMember) {
            throw new Error('FORBIDDEN');
        }

        return ProjectsRepository.findProjectInvitations(
            projectId,
            tenant.schoolId
        );
    },
};

module.exports = ProjectsService;
