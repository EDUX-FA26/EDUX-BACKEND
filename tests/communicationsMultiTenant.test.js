"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = "multi-tenant-test-secret-key-12345";

const { pool } = require("../src/config/db.config");
const { requireSchoolContext } = require("../src/middlewares/requireSchoolContext");
const { authorizeSchoolRoles } = require("../src/middlewares/authorizeSchoolRoles");
const CommunicationsService = require("../src/modules/communications/communications.service");

// UUIDs
const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "22222222-2222-4222-8222-222222222222";
const STUDENT_A1 = "33333333-3333-4333-8333-333333333331";
const STUDENT_A2 = "33333333-3333-4333-8333-333333333332";
const LECTURER_A1 = "44444444-4444-4444-8444-444444444441";
const LECTURER_A2 = "44444444-4444-4444-8444-444444444442";
const OUTSIDER = "55555555-5555-4555-8555-555555555555";
const MULTI_USER = "66666666-6666-4666-8666-666666666666";

const CLASS_A = "77777777-7777-4777-8777-777777777777";
const ASSIGNMENT_A = "88888888-8888-4888-8888-888888888881";
const ASSIGNMENT_B = "88888888-8888-4888-8888-888888888882";
const SUBMISSION_A = "99999999-9999-4999-8999-999999999991";
const SUBMISSION_B = "99999999-9999-4999-8999-999999999992";

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

test("1. Không có JWT hoặc JWT không hợp lệ -> Bị từ chối (401)", async () => {
  const { authenticate } = require("../src/middlewares/auth.middleware");
  const req = { headers: {} };
  const res = createMockRes();
  let nextCalled = false;

  authenticate(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
  assert.equal(nextCalled, false);
});

test("2. Không có School Context (thiếu header X-School-Id) -> Bị từ chối (400)", async () => {
  const req = {
    user: { id: STUDENT_A1, userId: STUDENT_A1, role: "student" },
    get(header) { return header.toLowerCase() === "x-school-id" ? undefined : null; },
  };
  const res = createMockRes();
  let nextCalled = false;

  await requireSchoolContext(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "SCHOOL_CONTEXT_REQUIRED");
  assert.equal(nextCalled, false);
});

test("3. User không có Membership tại trường được yêu cầu -> Bị từ chối (403)", async () => {
  const originalQuery = pool.query;
  pool.query = async () => ({ rows: [] });

  try {
    const req = {
      user: { id: OUTSIDER, userId: OUTSIDER, role: "student" },
      get(header) { return header.toLowerCase() === "x-school-id" ? SCHOOL_A : null; },
    };
    const res = createMockRes();
    let nextCalled = false;

    await requireSchoolContext(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "SCHOOL_ACCESS_DENIED");
    assert.equal(nextCalled, false);
  } finally {
    pool.query = originalQuery;
  }
});

test("4. Phân quyền vai trò theo trường (authorizeSchoolRoles) chặn truy cập sai vai trò", async () => {
  const req = {
    user: { id: STUDENT_A1 },
    tenant: { schoolId: SCHOOL_A, userId: STUDENT_A1, role: "guest_role" },
  };
  const res = createMockRes();
  let nextCalled = false;

  const schoolRoleMiddleware = authorizeSchoolRoles("student", "lecturer", "school_admin");
  schoolRoleMiddleware(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "INSUFFICIENT_SCHOOL_ROLE");
  assert.equal(nextCalled, false);
});

test("5. User School A cố gửi thông báo cho Assignment thuộc School B -> 404 (ASSIGNMENT_NOT_FOUND)", async () => {
  const originalQuery = pool.query;
  try {
    pool.query = async (sql, params) => {
      // Query assignment + class kiểm tra c.school_id = $2
      if (sql.includes("FROM assignments a") && params[0] === ASSIGNMENT_B && params[1] === SCHOOL_A) {
        return { rows: [] }; // Không tìm thấy vì khác trường
      }
      return { rows: [{ id: ASSIGNMENT_A, class_id: CLASS_A, school_id: SCHOOL_A, lecturer_id: LECTURER_A1 }] };
    };

    const tenantA = { schoolId: SCHOOL_A, userId: STUDENT_A1, role: "student" };

    await assert.rejects(
      async () => {
        await CommunicationsService.sendAssignmentDeadlineNotification(
          { assignmentId: ASSIGNMENT_B, studentId: STUDENT_A1 },
          tenantA
        );
      },
      { message: "ASSIGNMENT_NOT_FOUND" }
    );
  } finally {
    pool.query = originalQuery;
  }
});

test("6. Student A1 cố gửi deadline notification cho Student A2 -> Bị từ chối (403 FORBIDDEN)", async () => {
  const tenantStudentA1 = { schoolId: SCHOOL_A, userId: STUDENT_A1, role: "student" };

  await assert.rejects(
    async () => {
      await CommunicationsService.sendAssignmentDeadlineNotification(
        { assignmentId: ASSIGNMENT_A, studentId: STUDENT_A2 },
        tenantStudentA1
      );
    },
    { message: "FORBIDDEN" }
  );
});

test("7. Student cố gửi xác nhận nộp bài cho Submission của Student khác -> Bị từ chối (403 FORBIDDEN)", async () => {
  // Student A1 cố gửi xác nhận cho bài nộp của A2
  const tenantStudentA1 = { schoolId: SCHOOL_A, userId: STUDENT_A1, role: "student" };

  await assert.rejects(
    async () => {
      await CommunicationsService.sendSubmissionConfirmationEmail(
        { submissionId: SUBMISSION_A, studentId: STUDENT_A2 },
        tenantStudentA1
      );
    },
    { message: "FORBIDDEN" }
  );
});

test("8. Lecturer A2 cố gửi thông báo cho Assignment thuộc lớp do Lecturer A1 phụ trách -> Bị từ chối (403 FORBIDDEN)", async () => {
  const originalQuery = pool.query;
  try {
    pool.query = async (sql) => {
      if (sql.includes("FROM assignments a")) {
        // Lớp thuộc LECTURER_A1
        return { rows: [{ id: ASSIGNMENT_A, class_id: CLASS_A, school_id: SCHOOL_A, lecturer_id: LECTURER_A1 }] };
      }
      if (sql.includes("FROM public.school_memberships")) {
        return { rowCount: 1 };
      }
      if (sql.includes("FROM class_members")) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    };

    // Lecturer A2 cố can thiệp lớp của Lecturer A1
    const tenantLecturerA2 = { schoolId: SCHOOL_A, userId: LECTURER_A2, role: "lecturer" };

    await assert.rejects(
      async () => {
        await CommunicationsService.sendAssignmentDeadlineNotification(
          { assignmentId: ASSIGNMENT_A, studentId: STUDENT_A1 },
          tenantLecturerA2
        );
      },
      { message: "FORBIDDEN" }
    );
  } finally {
    pool.query = originalQuery;
  }
});

test("9. Gửi thông báo hợp lệ: Notifications và Email Logs ghi nhận đúng School Context và notification_scope", async () => {
  const originalQuery = pool.query;
  let recordedNotification = null;
  let recordedEmailLog = null;

  try {
    pool.query = async (sql, params) => {
      if (sql.includes("FROM assignments a")) {
        return { rows: [{ id: ASSIGNMENT_A, class_id: CLASS_A, school_id: SCHOOL_A, lecturer_id: LECTURER_A1 }] };
      }
      if (sql.includes("INSERT INTO email_logs")) {
        recordedEmailLog = { params };
        return { rows: [{ id: "email-log-1", to_email: "student@school.edu.vn" }] };
      }
      if (sql.includes("FROM public.school_memberships")) {
        return { rowCount: 1 };
      }
      if (sql.includes("FROM class_members")) {
        return { rowCount: 1 };
      }
      if (sql.includes("INSERT INTO notifications")) {
        recordedNotification = { sql, params };
        return { rows: [{ id: "notif-1", user_id: STUDENT_A1, school_id: params[4], notification_scope: params[5] }] };
      }
      return { rows: [] };
    };

    const tenantStudentA1 = { schoolId: SCHOOL_A, userId: STUDENT_A1, role: "student" };

    const result = await CommunicationsService.sendAssignmentDeadlineNotification(
      { assignmentId: ASSIGNMENT_A, studentId: STUDENT_A1, title: "Deadline sắp tới", message: "Nhớ nộp bài" },
      tenantStudentA1
    );

    assert.ok(result.notification);
    assert.ok(result.emailLog);
    // params[4] là school_id = SCHOOL_A
    assert.equal(recordedNotification.params[4], SCHOOL_A);
    // params[5] là notification_scope = 'school'
    assert.equal(recordedNotification.params[5], "school");
  } finally {
    pool.query = originalQuery;
  }
});

test("10. Multi-School User: Phân quyền chính xác theo trường đang chọn", async () => {
  const originalQuery = pool.query;
  try {
    pool.query = async (sql) => {
      if (sql.includes("FROM assignments a")) {
        return { rows: [{ id: ASSIGNMENT_A, class_id: CLASS_A, school_id: SCHOOL_A, lecturer_id: MULTI_USER }] };
      }
      if (sql.includes("FROM public.school_memberships")) {
        return { rowCount: 1 };
      }
      if (sql.includes("FROM class_members")) {
        return { rowCount: 1 };
      }
      if (sql.includes("INSERT INTO email_logs")) {
        return { rows: [{ id: "log-1" }] };
      }
      if (sql.includes("INSERT INTO notifications")) {
        return { rows: [{ id: "notif-1" }] };
      }
      return { rows: [] };
    };

    // User X ở School A là Lecturer phụ trách lớp: được phép gửi nhắc nhở cho Student A1
    const tenantSchoolA = { schoolId: SCHOOL_A, userId: MULTI_USER, role: "lecturer" };
    const resA = await CommunicationsService.sendAssignmentDeadlineNotification(
      { assignmentId: ASSIGNMENT_A, studentId: STUDENT_A1 },
      tenantSchoolA
    );
    assert.ok(resA.notification);

    // User X ở School B là Student: cố tình gửi nhắc nhở cho Student A1 -> Bị chặn vì vai trò student không thể nhắc nhở người khác
    const tenantSchoolB = { schoolId: SCHOOL_B, userId: MULTI_USER, role: "student" };
    await assert.rejects(
      async () => {
        await CommunicationsService.sendAssignmentDeadlineNotification(
          { assignmentId: ASSIGNMENT_A, studentId: STUDENT_A1 },
          tenantSchoolB
        );
      },
      { message: "FORBIDDEN" }
    );
  } finally {
    pool.query = originalQuery;
  }
});
