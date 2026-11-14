
"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'multi-tenant-test-secret-key-12345';

const { pool } = require('../src/config/db.config');
const { requireSchoolContext } = require('../src/middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../src/middlewares/authorizeSchoolRoles');
const ProjectsService = require('../src/modules/projects/projects.service');
const ProjectsRepository = require('../src/modules/projects/projects.repository');

// UUIDs
const SCHOOL_A = '11111111-1111-4111-8111-111111111111';
const SCHOOL_B = '22222222-2222-4222-8222-222222222222';
const USER_STUDENT_A = '33333333-3333-4333-8333-333333333333';
const USER_OUTSIDER = '44444444-4444-4444-8444-444444444444';
const USER_MULTI_ROLE = '55555555-5555-4555-8555-555555555555';
const CLASS_A = '66666666-6666-4666-8666-666666666666';
const PROJECT_A = '77777777-7777-4777-8777-777777777777';
const PROJECT_B = '88888888-8888-4888-8888-888888888888';
const INVITATION_B = '99999999-9999-4999-8999-999999999999';

// Helpers to simulate request/response
function createMockRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
}

test('1. Không có JWT hoặc JWT không hợp lệ -> Bị từ chối', async () => {
    const { authenticate } = require('../src/middlewares/auth.middleware');
    const req = { headers: {} };
    const res = createMockRes();
    let nextCalled = false;

    authenticate(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.equal(nextCalled, false);
});

test('2. Không có School Context (thiếu header X-School-Id) -> Bị từ chối', async () => {
    const req = {
        user: { id: USER_STUDENT_A, userId: USER_STUDENT_A, role: 'student' },
        get(header) { return header.toLowerCase() === 'x-school-id' ? undefined : null; },
    };
    const res = createMockRes();
    let nextCalled = false;

    await requireSchoolContext(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'SCHOOL_CONTEXT_REQUIRED');
    assert.equal(nextCalled, false);
});

test('3. User không có Membership tại trường được yêu cầu -> Bị từ chối (403)', async () => {
    const originalQuery = pool.query;
    pool.query = async (sql, params) => {
        // Trả về không tìm thấy membership
        return { rows: [] };
    };

    try {
        const req = {
            user: { id: USER_OUTSIDER, userId: USER_OUTSIDER, role: 'student' },
            get(header) { return header.toLowerCase() === 'x-school-id' ? SCHOOL_A : null; },
        };
        const res = createMockRes();
        let nextCalled = false;

        await requireSchoolContext(req, res, () => { nextCalled = true; });

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.code, 'SCHOOL_ACCESS_DENIED');
        assert.equal(nextCalled, false);
    } finally {
        pool.query = originalQuery;
    }
});

test('4. Phân quyền vai trò theo trường (authorizeSchoolRoles) chặn truy cập trái quyền', async () => {
    const studentTenant = {
        schoolId: SCHOOL_A,
        userId: USER_STUDENT_A,
        role: 'student',
    };

    const req = {
        user: { id: USER_STUDENT_A },
        tenant: studentTenant,
    };
    const res = createMockRes();
    let nextCalled = false;

    // Giảng viên mới được gọi endpoint này
    const lecturerOnlyMiddleware = authorizeSchoolRoles('lecturer', 'school_admin');
    lecturerOnlyMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'INSUFFICIENT_SCHOOL_ROLE');
    assert.equal(nextCalled, false);
});

test('5. User School A cố tình truy cập Project School B -> Bị từ chối (404 Project Not Found)', async () => {
    const originalFindById = ProjectsRepository.findById;
    try {
        ProjectsRepository.findById = async (projectId, schoolId) => {
            // Nếu schoolId là SCHOOL_A mà projectId là PROJECT_B -> query trả về null
            if (projectId === PROJECT_B && schoolId === SCHOOL_A) {
                return null;
            }
            return { id: projectId, class_id: CLASS_A, owner_id: USER_STUDENT_A };
        };

        const tenantSchoolA = {
            schoolId: SCHOOL_A,
            userId: USER_STUDENT_A,
            role: 'student',
        };

        await assert.rejects(
            async () => {
                await ProjectsService.getProject(PROJECT_B, tenantSchoolA);
            },
            { message: 'PROJECT_NOT_FOUND' }
        );
    } finally {
        ProjectsRepository.findById = originalFindById;
    }
});

test('6. Student trong cùng trường nhưng không thuộc Project và không thuộc Lớp -> Bị từ chối (403)', async () => {
    const originalFindById = ProjectsRepository.findById;
    const originalFindActiveMember = ProjectsRepository.findActiveMember;
    const originalIsActiveClassMember = ProjectsRepository.isActiveClassMember;
    try {
        ProjectsRepository.findById = async () => ({
            id: PROJECT_A,
            class_id: CLASS_A,
            owner_id: '00000000-0000-0000-0000-000000000000',
        });
        ProjectsRepository.findActiveMember = async () => null; // Không phải thành viên project
        ProjectsRepository.isActiveClassMember = async () => false; // Không thuộc lớp

        const tenantStudent = {
            schoolId: SCHOOL_A,
            userId: USER_STUDENT_A,
            role: 'student',
        };

        await assert.rejects(
            async () => {
                await ProjectsService.getProject(PROJECT_A, tenantStudent);
            },
            { message: 'FORBIDDEN' }
        );
    } finally {
        ProjectsRepository.findById = originalFindById;
        ProjectsRepository.findActiveMember = originalFindActiveMember;
        ProjectsRepository.isActiveClassMember = originalIsActiveClassMember;
    }
});

test('7. User School A cố tình chấp nhận Invitation của School B -> Bị từ chối (404/Not available)', async () => {
    const originalRespond = ProjectsRepository.respondToInvitation;
    try {
        ProjectsRepository.respondToInvitation = async (invitationId, userId, accept, schoolId) => {
            // Khi lọc c.school_id = schoolId, invitation của School B không tìm thấy
            if (schoolId === SCHOOL_A && invitationId === INVITATION_B) {
                throw new Error('INVITATION_NOT_FOUND');
            }
            return { id: invitationId, status: 'active' };
        };

        const tenantSchoolA = {
            schoolId: SCHOOL_A,
            userId: USER_STUDENT_A,
            role: 'student',
        };

        await assert.rejects(
            async () => {
                await ProjectsService.respondToInvitation(INVITATION_B, true, tenantSchoolA);
            },
            { message: 'INVITATION_NOT_FOUND' }
        );
    } finally {
        ProjectsRepository.respondToInvitation = originalRespond;
    }
});

test('8. Multi-School User: User có vai trò khác nhau ở 2 trường được phân quyền chính xác', async () => {
    // User X: Lecturer tại School A, Student tại School B
    const tenantSchoolA = {
        schoolId: SCHOOL_A,
        userId: USER_MULTI_ROLE,
        role: 'lecturer',
    };

    const tenantSchoolB = {
        schoolId: SCHOOL_B,
        userId: USER_MULTI_ROLE,
        role: 'student',
    };

    // Khi ở School A (Lecturer): không thể tạo Project (chỉ dành cho sinh viên)
    await assert.rejects(
        async () => {
            await ProjectsService.createProject({ classId: CLASS_A, name: 'Proj' }, tenantSchoolA);
        },
        { message: 'FORBIDDEN' }
    );

    // Khi ở School B (Student): có thể tạo Project
    const originalCreate = ProjectsRepository.create;
    try {
        ProjectsRepository.create = async ({ classId, ownerId, schoolId, name }) => {
            assert.equal(schoolId, SCHOOL_B);
            assert.equal(ownerId, USER_MULTI_ROLE);
            return { id: 'new-proj-id', class_id: classId, name };
        };

        const created = await ProjectsService.createProject(
            { classId: CLASS_A, name: 'Proj Valid' },
            tenantSchoolB
        );
        assert.equal(created.name, 'Proj Valid');
    } finally {
        ProjectsRepository.create = originalCreate;
    }
});

test('9. User hợp lệ truy cập Project thành công', async () => {
    const originalFindById = ProjectsRepository.findById;
    const originalFindActiveMember = ProjectsRepository.findActiveMember;
    const originalIsActiveClassMember = ProjectsRepository.isActiveClassMember;
    const originalFindMembers = ProjectsRepository.findMembers;
    try {
        ProjectsRepository.findById = async (id, schoolId) => {
            assert.equal(schoolId, SCHOOL_A);
            return {
                id: PROJECT_A,
                class_id: CLASS_A,
                owner_id: USER_STUDENT_A,
                name: 'Capstone AI',
            };
        };
        ProjectsRepository.findActiveMember = async () => ({ role: 'owner', status: 'active' });
        ProjectsRepository.isActiveClassMember = async () => true;
        ProjectsRepository.findMembers = async () => [
            { user_id: USER_STUDENT_A, role: 'owner', full_name: 'Student A' },
        ];

        const tenant = {
            schoolId: SCHOOL_A,
            userId: USER_STUDENT_A,
            role: 'student',
        };

        const project = await ProjectsService.getProject(PROJECT_A, tenant);
        assert.equal(project.id, PROJECT_A);
        assert.equal(project.name, 'Capstone AI');
        assert.equal(project.members.length, 1);
    } finally {
        ProjectsRepository.findById = originalFindById;
        ProjectsRepository.findActiveMember = originalFindActiveMember;
        ProjectsRepository.isActiveClassMember = originalIsActiveClassMember;
        ProjectsRepository.findMembers = originalFindMembers;
    }
});
