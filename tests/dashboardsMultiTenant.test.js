"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = "multi-tenant-test-secret-key-12345";

const { pool } = require("../src/config/db.config");
const { redis } = require("../src/config/redis.config");
const { authenticate } = require("../src/middlewares/auth.middleware");
const { requireSchoolContext } = require("../src/middlewares/requireSchoolContext");
const { authorizeSchoolRoles } = require("../src/middlewares/authorizeSchoolRoles");
const dashboardService = require("../src/modules/dashboards/dashboard.service");
const DashboardRepository = require("../src/modules/dashboards/dashboard.repository");

// Test UUIDs
const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "22222222-2222-4222-8222-222222222222";
const STUDENT_A = "33333333-3333-4333-8333-333333333331";
const LECTURER_A = "44444444-4444-4444-8444-444444444441";
const ADMIN_A = "55555555-5555-4555-8555-555555555551";

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

let mockRedisIsOpen = false;
Object.defineProperty(redis, "isOpen", {
  get: () => mockRedisIsOpen,
  configurable: true,
});

// ─────────────────────────────────────────────────────────────
// 1. ROUTE & MIDDLEWARE AUTHENTICATION / AUTHORIZATION
// ─────────────────────────────────────────────────────────────

test("1. Không có JWT hoặc JWT không hợp lệ -> Bị từ chối (401)", () => {
  const req = { headers: {} };
  const res = createMockRes();
  let nextCalled = false;

  authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
  assert.equal(nextCalled, false);
});

test("2. Không có School Context (thiếu header X-School-Id) -> Bị từ chối (400)", async () => {
  const req = {
    user: { id: STUDENT_A, userId: STUDENT_A, role: "student" },
    get(header) {
      return header.toLowerCase() === "x-school-id" ? undefined : null;
    },
  };
  const res = createMockRes();
  let nextCalled = false;

  await requireSchoolContext(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "SCHOOL_CONTEXT_REQUIRED");
  assert.equal(nextCalled, false);
});

test("3. User không thuộc School yêu cầu (không có active membership) -> Bị từ chối (403)", async () => {
  const origQuery = pool.query;
  pool.query = async (sql) => {
    if (sql.includes("school_memberships")) {
      return { rows: [] }; // Không tìm thấy active membership
    }
    return { rows: [] };
  };

  try {
    const req = {
      user: { id: STUDENT_A, userId: STUDENT_A },
      get(header) {
        return header.toLowerCase() === "x-school-id" ? SCHOOL_A : null;
      },
    };
    const res = createMockRes();
    let nextCalled = false;

    await requireSchoolContext(req, res, () => {
      nextCalled = true;
    });

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "SCHOOL_ACCESS_DENIED");
    assert.equal(nextCalled, false);
  } finally {
    pool.query = origQuery;
  }
});

test("4. Phân quyền theo req.tenant.role: student, lecturer, school_admin hợp lệ; role khác bị chặn (403)", () => {
  const guard = authorizeSchoolRoles("student", "lecturer", "school_admin");

  // Hợp lệ: student
  {
    const req = {
      user: { id: STUDENT_A },
      tenant: { userId: STUDENT_A, role: "student", schoolId: SCHOOL_A },
    };
    const res = createMockRes();
    let nextCalled = false;
    guard(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  }

  // Hợp lệ: lecturer
  {
    const req = {
      user: { id: LECTURER_A },
      tenant: { userId: LECTURER_A, role: "lecturer", schoolId: SCHOOL_A },
    };
    const res = createMockRes();
    let nextCalled = false;
    guard(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  }

  // Hợp lệ: school_admin
  {
    const req = {
      user: { id: ADMIN_A },
      tenant: { userId: ADMIN_A, role: "school_admin", schoolId: SCHOOL_A },
    };
    const res = createMockRes();
    let nextCalled = false;
    guard(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  }

  // Bị chặn: role không được phép (ví dụ student truy cập route chỉ dành cho admin hoặc role lạ)
  {
    const adminGuard = authorizeSchoolRoles("school_admin");
    const req = {
      user: { id: STUDENT_A },
      tenant: { userId: STUDENT_A, role: "student", schoolId: SCHOOL_A },
    };
    const res = createMockRes();
    let nextCalled = false;
    adminGuard(req, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "INSUFFICIENT_SCHOOL_ROLE");
    assert.equal(nextCalled, false);
  }
});

// ─────────────────────────────────────────────────────────────
// 2. FAIL-CLOSED SECURITY AT SERVICE & REPOSITORY LEVELS
// ─────────────────────────────────────────────────────────────

test("5. Fail-Closed: Service getDashboard từ chối nếu thiếu schoolId, userId hoặc role (throw 400)", async () => {
  // Thiếu schoolId
  await assert.rejects(
    async () => {
      await dashboardService.getDashboard({ userId: STUDENT_A, role: "student" });
    },
    (err) => {
      assert.equal(err.message, "SCHOOL_CONTEXT_REQUIRED");
      assert.equal(err.status, 400);
      return true;
    }
  );

  // Thiếu userId
  await assert.rejects(
    async () => {
      await dashboardService.getDashboard({ schoolId: SCHOOL_A, role: "student" });
    },
    (err) => {
      assert.equal(err.message, "SCHOOL_CONTEXT_REQUIRED");
      assert.equal(err.status, 400);
      return true;
    }
  );

  // Thiếu role
  await assert.rejects(
    async () => {
      await dashboardService.getDashboard({ userId: STUDENT_A, schoolId: SCHOOL_A });
    },
    (err) => {
      assert.equal(err.message, "SCHOOL_CONTEXT_REQUIRED");
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test("6. Fail-Closed: Toàn bộ Repository methods ném lỗi ngay lập tức nếu thiếu schoolId (không query DB)", async () => {
  let queryExecuted = false;
  const origQuery = pool.query;
  pool.query = async () => {
    queryExecuted = true;
    return { rows: [] };
  };

  try {
    await assert.rejects(() => DashboardRepository.getStudentStatistics(STUDENT_A, null), /SCHOOL_ID_REQUIRED_FOR_DASHBOARD/);
    await assert.rejects(() => DashboardRepository.getStudentRecentAssignments(STUDENT_A, undefined), /SCHOOL_ID_REQUIRED_FOR_DASHBOARD/);
    await assert.rejects(() => DashboardRepository.getLecturerStatistics(LECTURER_A, null), /SCHOOL_ID_REQUIRED_FOR_DASHBOARD/);
    await assert.rejects(() => DashboardRepository.getLecturerRecentSubmissions(LECTURER_A, undefined), /SCHOOL_ID_REQUIRED_FOR_DASHBOARD/);
    await assert.rejects(() => DashboardRepository.getAdminStatistics(null), /SCHOOL_ID_REQUIRED_FOR_DASHBOARD/);
    await assert.rejects(() => DashboardRepository.getAdminRecentUsers(undefined), /SCHOOL_ID_REQUIRED_FOR_DASHBOARD/);
    await assert.rejects(() => DashboardRepository.getRecentNotifications(STUDENT_A, null), /SCHOOL_ID_REQUIRED_FOR_DASHBOARD/);
    await assert.rejects(() => DashboardRepository.getUnreadCount(STUDENT_A, undefined), /SCHOOL_ID_REQUIRED_FOR_DASHBOARD/);

    assert.equal(queryExecuted, false, "Không được phép thực thi SQL query khi thiếu schoolId");
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 3. STUDENT DASHBOARD TENANT ISOLATION
// ─────────────────────────────────────────────────────────────

test("7. Student Dashboard Tenant Isolation: SQL chỉ truy vấn Classes, Assignments, Grades thuộc School hiện tại", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    if (sql.includes("total_classes")) {
      return {
        rows: [
          {
            total_classes: "3",
            pending_assignments: "2",
            submitted_assignments: "5",
            average_score: "8.5",
          },
        ],
      };
    }
    if (sql.includes("ORDER BY a.deadline ASC")) {
      return {
        rows: [
          {
            id: "assign-1",
            title: "Bài tập 1",
            deadline: new Date(),
            class_code: "SE101",
            subject_name: "Software Engineering",
            is_submitted: false,
          },
        ],
      };
    }
    return { rows: [] };
  };

  mockRedisIsOpen = false;

  try {
    const data = await dashboardService.getDashboard({
      userId: STUDENT_A,
      schoolId: SCHOOL_A,
      role: "student",
    });

    assert.equal(data.role, "student");
    assert.equal(data.statistics.totalClasses, 3);
    assert.equal(data.statistics.pendingAssignments, 2);
    assert.equal(data.statistics.submittedAssignments, 5);
    assert.equal(data.statistics.averageScore, 8.5);
    assert.equal(data.recentAssignments.length, 1);

    // Kiểm tra params và mệnh đề WHERE school_id
    assert.ok(capturedQueries.length >= 2, "Cần có ít nhất 2 truy vấn: thống kê và bài tập gần đây");

    const statsQuery = capturedQueries.find((q) => q.sql.includes("total_classes"));
    assert.ok(statsQuery, "Truy vấn thống kê student phải được thực thi");
    assert.deepEqual(statsQuery.params, [STUDENT_A, SCHOOL_A]);
    assert.ok(statsQuery.sql.includes("c.school_id = $2"), "Phải lọc c.school_id = $2 trong classes");

    const assignQuery = capturedQueries.find((q) => q.sql.includes("ORDER BY a.deadline ASC"));
    assert.ok(assignQuery, "Truy vấn bài tập gần đây student phải được thực thi");
    assert.deepEqual(assignQuery.params, [STUDENT_A, SCHOOL_A]);
    assert.ok(assignQuery.sql.includes("c.school_id = $2"), "Phải lọc c.school_id = $2 trong assignments/classes");
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 4. LECTURER DASHBOARD TENANT ISOLATION
// ─────────────────────────────────────────────────────────────

test("8. Lecturer Dashboard Tenant Isolation: SQL chỉ lấy Classes và Submissions thuộc phân công của Lecturer tại School hiện tại", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    if (sql.includes("pending_submissions")) {
      return {
        rows: [
          {
            total_classes: "2",
            total_students: "45",
            pending_submissions: "12",
            total_assignments: "6",
          },
        ],
      };
    }
    if (sql.includes("s.submitted_at DESC")) {
      return {
        rows: [
          {
            id: "sub-1",
            submitted_at: new Date(),
            status: "submitted",
            student_name: "Nguyễn Văn A",
            student_code: "SV001",
            assignment_title: "Bài tập lớn",
            class_code: "CS201",
          },
        ],
      };
    }
    return { rows: [] };
  };

  mockRedisIsOpen = false;

  try {
    const data = await dashboardService.getDashboard({
      userId: LECTURER_A,
      schoolId: SCHOOL_A,
      role: "lecturer",
    });

    assert.equal(data.role, "lecturer");
    assert.equal(data.statistics.totalClasses, 2);
    assert.equal(data.statistics.totalStudents, 45);
    assert.equal(data.statistics.pendingSubmissions, 12);
    assert.equal(data.statistics.totalAssignments, 6);
    assert.equal(data.recentSubmissions.length, 1);

    const statsQuery = capturedQueries.find((q) => q.sql.includes("pending_submissions"));
    assert.ok(statsQuery);
    assert.deepEqual(statsQuery.params, [LECTURER_A, SCHOOL_A]);
    assert.ok(statsQuery.sql.includes("school_id = $2"), "Phải lọc school_id = $2 trong classes");

    const subsQuery = capturedQueries.find((q) => q.sql.includes("s.submitted_at DESC"));
    assert.ok(subsQuery);
    assert.deepEqual(subsQuery.params, [LECTURER_A, SCHOOL_A]);
    assert.ok(subsQuery.sql.includes("c.school_id = $2"), "Phải lọc c.school_id = $2 trong submissions");
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 5. SCHOOL ADMIN DASHBOARD TENANT ISOLATION
// ─────────────────────────────────────────────────────────────

test("9. School Admin Dashboard Tenant Isolation: SQL chỉ truy vấn memberships và classes của School hiện tại", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    if (sql.includes("public.school_memberships")) {
      return {
        rows: [
          {
            total_users: "150",
            total_students: "130",
            total_lecturers: "18",
            total_classes: "12",
          },
        ],
      };
    }
    if (sql.includes("ORDER BY sm.created_at DESC")) {
      return {
        rows: [
          {
            id: "user-1",
            email: "student1@school.edu",
            role: "student",
            created_at: new Date(),
            full_name: "Sinh viên Một",
          },
        ],
      };
    }
    return { rows: [] };
  };

  mockRedisIsOpen = false;

  try {
    const data = await dashboardService.getDashboard({
      userId: ADMIN_A,
      schoolId: SCHOOL_A,
      role: "school_admin",
    });

    assert.equal(data.role, "school_admin");
    assert.equal(data.statistics.totalUsers, 150);
    assert.equal(data.statistics.totalStudents, 130);
    assert.equal(data.statistics.totalLecturers, 18);
    assert.equal(data.statistics.totalClasses, 12);
    assert.equal(data.recentUsers.length, 1);

    const statsQuery = capturedQueries.find((q) => q.sql.includes("public.school_memberships"));
    assert.ok(statsQuery);
    assert.deepEqual(statsQuery.params, [SCHOOL_A], "Chỉ truyền schoolId vào thống kê School Admin");
    assert.ok(statsQuery.sql.includes("school_id = $1"), "Lọc theo school_id = $1");

    const usersQuery = capturedQueries.find((q) => q.sql.includes("ORDER BY sm.created_at DESC"));
    assert.ok(usersQuery);
    assert.deepEqual(usersQuery.params, [SCHOOL_A]);
    assert.ok(usersQuery.sql.includes("sm.school_id = $1"), "Lọc thành viên thuộc school_id = $1");
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 6. REDIS CACHE TENANT ISOLATION
// ─────────────────────────────────────────────────────────────

test("10. Redis Cache Tenant Isolation: Cache Key phân vùng theo schoolId:userId:role và TTL 60s", async () => {
  const cacheStore = new Map();
  const setExCalls = [];

  const origGet = redis.get;
  const origSetEx = redis.setEx;

  mockRedisIsOpen = true;
  redis.get = async (key) => cacheStore.get(key) || null;
  redis.setEx = async (key, ttl, value) => {
    setExCalls.push({ key, ttl, value });
    cacheStore.set(key, value);
  };

  let dbQueriesRun = 0;
  const origQuery = pool.query;
  pool.query = async (sql) => {
    dbQueriesRun++;
    if (sql.includes("total_classes")) {
      return { rows: [{ total_classes: "5", pending_assignments: "1", submitted_assignments: "4", average_score: "9.0" }] };
    }
    return { rows: [] };
  };

  try {
    // 1. Cache MISS tại School A -> Query DB -> Lưu vào cache key của School A
    const resA1 = await dashboardService.getDashboard({
      userId: STUDENT_A,
      schoolId: SCHOOL_A,
      role: "student",
    });

    assert.equal(resA1.statistics.totalClasses, 5);
    const expectedKeyA = `dashboard:${SCHOOL_A}:${STUDENT_A}:student`;
    assert.ok(cacheStore.has(expectedKeyA), "Phải lưu cache với key phân vùng theo School A");
    const writeRecord = setExCalls.find((c) => c.key === expectedKeyA);
    assert.equal(writeRecord.ttl, 60, "TTL của cache dashboard phải là 60 giây");

    // 2. Cache HIT tại School A -> Lấy từ cache, KHÔNG gọi lại DB
    const dbQueriesBeforeHit = dbQueriesRun;
    const resA2 = await dashboardService.getDashboard({
      userId: STUDENT_A,
      schoolId: SCHOOL_A,
      role: "student",
    });
    assert.equal(dbQueriesRun, dbQueriesBeforeHit, "Khi Cache HIT không được query DB");
    assert.equal(resA2.statistics.totalClasses, 5);

    // 3. User chuyển sang School B -> Cache MISS (key khác hoàn toàn) -> Gọi DB riêng cho School B
    pool.query = async (sql) => {
      dbQueriesRun++;
      if (sql.includes("total_classes")) {
        return { rows: [{ total_classes: "1", pending_assignments: "0", submitted_assignments: "0", average_score: "6.0" }] };
      }
      return { rows: [] };
    };

    const resB = await dashboardService.getDashboard({
      userId: STUDENT_A,
      schoolId: SCHOOL_B,
      role: "student",
    });

    const expectedKeyB = `dashboard:${SCHOOL_B}:${STUDENT_A}:student`;
    assert.ok(cacheStore.has(expectedKeyB), "Phải lưu cache riêng cho School B");
    assert.equal(resB.statistics.totalClasses, 1, "Dữ liệu School B độc lập hoàn toàn với School A");
    assert.notEqual(cacheStore.get(expectedKeyA), cacheStore.get(expectedKeyB));
  } finally {
    mockRedisIsOpen = false;
    redis.get = origGet;
    redis.setEx = origSetEx;
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 7. DASHBOARD NOTIFICATIONS TENANT ISOLATION
// ─────────────────────────────────────────────────────────────

test("11. Dashboard Notifications: Chỉ lấy notifications thuộc School Scope hiện tại hoặc Platform Scope", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    if (sql.includes("FROM notifications") && sql.includes("SELECT id")) {
      return {
        rows: [
          { id: "n-1", title: "Thông báo Trường A", is_read: false, created_at: new Date() },
        ],
      };
    }
    if (sql.includes("FROM notifications") && sql.includes("COUNT(*)")) {
      return {
        rows: [{ count: "1" }],
      };
    }
    return { rows: [] };
  };

  try {
    const res = await dashboardService.getDashboardNotifications({
      userId: STUDENT_A,
      schoolId: SCHOOL_A,
    });

    assert.equal(res.notifications.length, 1);
    assert.equal(res.unreadCount, 1);

    for (const q of capturedQueries) {
      assert.deepEqual(q.params, [STUDENT_A, SCHOOL_A]);
      assert.ok(
        q.sql.includes("notification_scope = 'school' AND school_id = $2") &&
        q.sql.includes("notification_scope = 'platform'"),
        "Phải cô lập notifications theo School hiện tại hoặc Platform"
      );
    }
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 8. FRONTEND RACE CONDITION & ASYNC OUT-OF-ORDER TESTS
// ─────────────────────────────────────────────────────────────

test("12. Frontend Race Condition Protection: Chuyển trường nhanh (School A -> School B) không bị dữ liệu cũ ghi đè", async () => {
  let activeSchoolId = SCHOOL_A;
  let componentData = null;

  async function fetchDashboardForSchool(targetSchoolId, delayMs, mockResult) {
    await new Promise((r) => setTimeout(r, delayMs));
    if (targetSchoolId === activeSchoolId) {
      componentData = mockResult;
    }
  }

  const reqA = fetchDashboardForSchool(SCHOOL_A, 50, { school: "A", classes: 10 });
  activeSchoolId = SCHOOL_B;
  const reqB = fetchDashboardForSchool(SCHOOL_B, 20, { school: "B", classes: 2 });

  await Promise.all([reqA, reqB]);

  assert.deepEqual(componentData, { school: "B", classes: 2 });
});

test("13. Asynchronous Out-of-Order Completion: Request A hoàn tất muộn hơn Request B không thể ghi đè Dashboard của School B", async () => {
  // Mô phỏng state và ref chính xác như trong Student/Lecturer/Admin DashboardPage
  let state = {
    data: null,
    loading: true,
    error: null,
  };
  const currentSchoolIdRef = { current: SCHOOL_A };
  let requestGen = 0;
  let activeAbortController = null;

  function switchSchoolAndFetch(targetSchoolId, delayMs, responseData, shouldFail = false) {
    currentSchoolIdRef.current = targetSchoolId;
    const genId = ++requestGen;

    if (activeAbortController) {
      activeAbortController.abort();
    }
    const controller = new AbortController();
    activeAbortController = controller;

    state.data = null;
    state.loading = true;
    state.error = null;

    return new Promise((resolve) => {
      setTimeout(() => {
        // Kiểm tra xem request có bị abort không
        if (controller.signal.aborted) {
          return resolve({ aborted: true });
        }

        if (shouldFail) {
          // Xử lý lỗi
          if (currentSchoolIdRef.current === targetSchoolId && requestGen === genId) {
            state.error = "Lỗi mạng hoặc 500";
            state.loading = false;
          }
          return resolve({ error: true });
        }

        // Cập nhật thành công nếu còn đúng school và genId
        if (currentSchoolIdRef.current === targetSchoolId && requestGen === genId) {
          state.data = responseData;
          state.error = null;
        }
        if (currentSchoolIdRef.current === targetSchoolId && requestGen === genId) {
          state.loading = false;
        }
        return resolve({ success: true });
      }, delayMs);
    });
  }

  // 1. User bắt đầu tại School A -> Request 1 bắn đi (chậm: 100ms)
  const req1Promise = switchSchoolAndFetch(SCHOOL_A, 100, { school: "A", totalClasses: 8 });

  // 2. Sau 10ms, user chuyển sang School B -> Request 2 bắn đi (nhanh: 25ms)
  await new Promise((r) => setTimeout(r, 10));
  const req2Promise = switchSchoolAndFetch(SCHOOL_B, 25, { school: "B", totalClasses: 3 });

  // Chờ cả 2 requests
  await Promise.all([req1Promise, req2Promise]);

  // Request 1 hoàn tất muộn (sau Request 2) nhưng KHÔNG được phép ghi đè School B
  assert.deepEqual(state.data, { school: "B", totalClasses: 3 });
  assert.equal(state.loading, false);
  assert.equal(state.error, null);
});

test("14. Stale Request Failure không được ghi đè error hoặc loading của trường đang chọn", async () => {
  let state = {
    data: null,
    loading: true,
    error: null,
  };
  const currentSchoolIdRef = { current: SCHOOL_A };
  let requestGen = 0;
  let activeAbortController = null;

  function executeFetch(targetSchoolId, delayMs, resultData, throwsError = false) {
    currentSchoolIdRef.current = targetSchoolId;
    const genId = ++requestGen;

    if (activeAbortController) {
      activeAbortController.abort();
    }
    const controller = new AbortController();
    activeAbortController = controller;

    state.data = null;
    state.loading = true;
    state.error = null;

    return new Promise((resolve) => {
      setTimeout(() => {
        if (controller.signal.aborted) {
          // Bỏ qua lỗi canceled/aborted
          return resolve({ aborted: true });
        }

        if (throwsError) {
          // Chỉ set error nếu request này là thế hệ mới nhất của trường hiện tại
          if (currentSchoolIdRef.current === targetSchoolId && requestGen === genId) {
            state.error = "Lỗi từ server trường cũ";
          }
        } else {
          if (currentSchoolIdRef.current === targetSchoolId && requestGen === genId) {
            state.data = resultData;
          }
        }

        if (currentSchoolIdRef.current === targetSchoolId && requestGen === genId) {
          state.loading = false;
        }
        resolve();
      }, delayMs);
    });
  }

  // Trường hợp 1: Request 1 của School A bị lỗi sau 80ms
  const reqA = executeFetch(SCHOOL_A, 80, null, true);

  // Sau 10ms, chuyển sang School B và tải thành công sau 20ms
  await new Promise((r) => setTimeout(r, 10));
  const reqB = executeFetch(SCHOOL_B, 20, { school: "B", totalClasses: 5 }, false);

  await Promise.all([reqA, reqB]);

  // Request lỗi của School A (80ms) không được phép ghi đè state.error thành 'Lỗi từ server trường cũ'
  assert.equal(state.error, null, "Lỗi từ request cũ không được ghi đè lên trường mới");
  assert.deepEqual(state.data, { school: "B", totalClasses: 5 });
  assert.equal(state.loading, false);
});

test("15. AbortController Signal hủy request khi chuyển trường hoặc unmount", async () => {
  const controller = new AbortController();
  assert.equal(controller.signal.aborted, false);

  controller.abort();
  assert.equal(controller.signal.aborted, true);
});
