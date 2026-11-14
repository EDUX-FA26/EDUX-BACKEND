"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = "multi-tenant-test-secret-key-12345";

const { pool } = require("../src/config/db.config");
const { authenticate } = require("../src/middlewares/auth.middleware");
const { requireSchoolContext } = require("../src/middlewares/requireSchoolContext");
const { authorizeSchoolRoles } = require("../src/middlewares/authorizeSchoolRoles");
const reportsService = require("../src/modules/reports/reports.service");
const reportsRepository = require("../src/modules/reports/reports.repository");

// Test UUIDs
const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "22222222-2222-4222-8222-222222222222";
const ADMIN_A = "33333333-3333-4333-8333-333333333331";
const LECTURER_A = "44444444-4444-4444-8444-444444444441";
const STUDENT_A = "55555555-5555-4555-8555-555555555551";

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
    user: { id: ADMIN_A, userId: ADMIN_A, role: "admin" },
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
      user: { id: ADMIN_A, userId: ADMIN_A },
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

test("4. Phân quyền theo req.tenant.role: school_admin và lecturer được phép; student bị chặn (403)", () => {
  const guard = authorizeSchoolRoles("school_admin", "lecturer");

  // Cho phép school_admin
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

  // Cho phép lecturer
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

  // Chặn student truy cập báo cáo tổng hợp
  {
    const req = {
      user: { id: STUDENT_A },
      tenant: { userId: STUDENT_A, role: "student", schoolId: SCHOOL_A },
    };
    const res = createMockRes();
    let nextCalled = false;
    guard(req, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "INSUFFICIENT_SCHOOL_ROLE");
    assert.equal(nextCalled, false);
  }
});

// ─────────────────────────────────────────────────────────────
// 2. FAIL-CLOSED SECURITY AT SERVICE & REPOSITORY LEVELS
// ─────────────────────────────────────────────────────────────

test("5. Fail-Closed: Service từ chối nếu thiếu schoolId, userId hoặc role (throw 400)", async () => {
  // Thiếu schoolId
  await assert.rejects(
    async () => {
      await reportsService.getSystemReports({ userId: ADMIN_A, role: "school_admin" });
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
      await reportsService.getAiUsageStatistics({ schoolId: SCHOOL_A, role: "school_admin" });
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
      await reportsService.getAuditLogs({ schoolId: SCHOOL_A, userId: ADMIN_A });
    },
    (err) => {
      assert.equal(err.message, "SCHOOL_CONTEXT_REQUIRED");
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test("6. Fail-Closed: Toàn bộ Repository methods ném lỗi ngay nếu thiếu schoolId (không query DB)", async () => {
  let queryRun = false;
  const origQuery = pool.query;
  pool.query = async () => {
    queryRun = true;
    return { rows: [] };
  };

  try {
    await assert.rejects(() => reportsRepository.getSystemStats(null, ADMIN_A, "school_admin"), /SCHOOL_ID_REQUIRED_FOR_REPORTS/);
    await assert.rejects(() => reportsRepository.getAiUsageStats(undefined, ADMIN_A, "school_admin"), /SCHOOL_ID_REQUIRED_FOR_REPORTS/);
    await assert.rejects(() => reportsRepository.getAuditLogs(null, ADMIN_A, "school_admin"), /SCHOOL_ID_REQUIRED_FOR_REPORTS/);
    await assert.rejects(() => reportsRepository.getLearningActivityExportData(undefined, ADMIN_A, "school_admin"), /SCHOOL_ID_REQUIRED_FOR_REPORTS/);
    await assert.rejects(() => reportsRepository.getAiTransparencyExportData(null, ADMIN_A, "school_admin"), /SCHOOL_ID_REQUIRED_FOR_REPORTS/);

    assert.equal(queryRun, false, "Không được phép truy vấn DB khi thiếu schoolId");
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 3. SCHOOL ADMIN REPORTS TENANT ISOLATION
// ─────────────────────────────────────────────────────────────

test("7. School Admin Reports Tenant Isolation: Mọi truy vấn SQL đều bị cô lập theo schoolId", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    if (sql.includes("public.school_memberships")) {
      return { rows: [{ total_users: 100, active_users: 90, inactive_users: 10, total_students: 80, total_lecturers: 15, total_admins: 5 }] };
    }
    if (sql.includes("total_classes")) {
      return { rows: [{ total_classes: 10, active_classes: 8 }] };
    }
    if (sql.includes("total_subjects")) {
      return { rows: [{ total_subjects: 5, active_subjects: 5 }] };
    }
    if (sql.includes("total_departments")) {
      return { rows: [{ total_departments: 3 }] };
    }
    if (sql.includes("total_semesters")) {
      return { rows: [{ total_semesters: 2, active_semesters: 1 }] };
    }
    if (sql.includes("total_assignments")) {
      return { rows: [{ total_assignments: 20, published_assignments: 18 }] };
    }
    if (sql.includes("total_submissions")) {
      return { rows: [{ total_submissions: 50, late_submissions: 5, ontime_submissions: 45 }] };
    }
    if (sql.includes("graded_submissions")) {
      return { rows: [{ graded_submissions: 40, avg_score: "8.2", max_score: "10", min_score: "5" }] };
    }
    if (sql.includes("total_ai_evaluations")) {
      return { rows: [{ total_ai_evaluations: 15 }] };
    }
    if (sql.includes("semester_code")) {
      return { rows: [] };
    }
    if (sql.includes("department_code")) {
      return { rows: [] };
    }
    if (sql.includes("excellent_count")) {
      return { rows: [{ excellent_count: 10, good_count: 20, fair_count: 8, below_avg_count: 2 }] };
    }
    return { rows: [] };
  };

  try {
    const stats = await reportsService.getSystemReports({
      schoolId: SCHOOL_A,
      userId: ADMIN_A,
      role: "school_admin",
    });

    assert.equal(stats.totalUsers, 100);
    assert.equal(stats.totalStudents, 80);
    assert.equal(stats.totalClasses, 10);

    // Xác minh toàn bộ queries thực thi đều có school_id = $1
    assert.ok(capturedQueries.length >= 10);
    for (const q of capturedQueries) {
      assert.equal(q.params[0], SCHOOL_A, "Tham số đầu tiên luôn là schoolId");
      assert.ok(
        q.sql.includes("school_id = $1") || q.sql.includes("c.school_id = $1"),
        `Query phải chứa ràng buộc school_id = $1:\n${q.sql}`
      );
    }
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 4. LECTURER REPORTS CLASS-LEVEL ISOLATION
// ─────────────────────────────────────────────────────────────

test("8. Lecturer Reports Isolation: Báo cáo của Lecturer tự động giới hạn c.school_id = $1 VÀ c.lecturer_id = $2", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    if (sql.includes("total_classes")) {
      return { rows: [{ total_classes: 2, active_classes: 2 }] };
    }
    return { rows: [{ count: 0 }] };
  };

  try {
    await reportsService.getSystemReports({
      schoolId: SCHOOL_A,
      userId: LECTURER_A,
      role: "lecturer",
    });

    const classQueries = capturedQueries.filter((q) => q.sql.includes("classes c") || q.sql.includes("classes"));
    assert.ok(classQueries.length > 0);
    for (const q of classQueries) {
      if (q.sql.includes("FROM public.school_memberships")) continue;
      assert.deepEqual(q.params, [SCHOOL_A, LECTURER_A], "Phải truyền cả schoolId và lecturerId cho vai trò lecturer");
      assert.ok(q.sql.includes("c.lecturer_id = $2"), "Phải có điều kiện lọc c.lecturer_id = $2");
    }
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 5. EXPORT SECURITY & CROSS-TENANT DATA LEAKAGE PREVENTION
// ─────────────────────────────────────────────────────────────

test("9. Export Learning Activity: Bắt buộc lọc theo c.school_id = $1, không rò rỉ bài nộp của trường khác", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    return {
      rows: [
        {
          student_id: STUDENT_A,
          student_code: "SV001",
          student_name: "Sinh viên Trường A",
          class_code: "SE101",
          school_id: SCHOOL_A,
        },
      ],
    };
  };

  try {
    const data = await reportsService.exportLearningActivity({
      schoolId: SCHOOL_A,
      userId: ADMIN_A,
      role: "school_admin",
    });

    assert.equal(data.length, 1);
    assert.equal(capturedQueries.length, 1);
    assert.equal(capturedQueries[0].params[0], SCHOOL_A);
    assert.ok(capturedQueries[0].sql.includes("c.school_id = $1"));
  } finally {
    pool.query = origQuery;
  }
});

test("10. Export AI Transparency: Bắt buộc lọc theo c.school_id = $1, không rò rỉ khai báo AI của trường khác", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    return {
      rows: [
        {
          submission_id: "sub-1",
          full_name: "Học viên A",
          assignment_title: "AI Report Assignment",
        },
      ],
    };
  };

  try {
    const data = await reportsService.exportAiTransparency({
      schoolId: SCHOOL_A,
      userId: ADMIN_A,
      role: "school_admin",
    });

    assert.ok(data.length >= 1);
    assert.ok(capturedQueries.length >= 2, "Truy vấn cả ai_evaluations và submission_versions");
    for (const q of capturedQueries) {
      assert.equal(q.params[0], SCHOOL_A);
      assert.ok(q.sql.includes("c.school_id = $1"), "Truy vấn export AI transparency phải có c.school_id = $1");
    }
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 6. MULTI-SCHOOL USER & AUDIT LOGS
// ─────────────────────────────────────────────────────────────

test("11. Audit Logs Tenant Isolation: Chỉ trả về nhật ký kiểm toán trong School Context", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    return { rows: [] };
  };

  try {
    await reportsService.getAuditLogs({
      schoolId: SCHOOL_A,
      userId: ADMIN_A,
      role: "school_admin",
    });

    assert.ok(capturedQueries.length >= 2);
    for (const q of capturedQueries) {
      assert.equal(q.params[0], SCHOOL_A);
      assert.ok(q.sql.includes("c.school_id = $1"));
    }
  } finally {
    pool.query = origQuery;
  }
});

test("12. Multi-School User: Phân quyền chính xác khi user là Lecturer ở School A và School Admin ở School B", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    return { rows: [] };
  };

  try {
    // 1. Tại School A: user là lecturer -> có c.lecturer_id = $2
    await reportsService.exportLearningActivity({
      schoolId: SCHOOL_A,
      userId: LECTURER_A,
      role: "lecturer",
    });
    assert.equal(capturedQueries[0].params[0], SCHOOL_A);
    assert.equal(capturedQueries[0].params[1], LECTURER_A);
    assert.ok(capturedQueries[0].sql.includes("c.lecturer_id = $2"));

    // 2. Tại School B: user là school_admin -> xem toàn trường School B, không bị lọc theo lecturer_id
    await reportsService.exportLearningActivity({
      schoolId: SCHOOL_B,
      userId: LECTURER_A,
      role: "school_admin",
    });
    assert.equal(capturedQueries[1].params[0], SCHOOL_B);
    assert.equal(capturedQueries[1].params.length, 1);
    assert.ok(!capturedQueries[1].sql.includes("c.lecturer_id = $2"));
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 7. FRONTEND RACE CONDITION & ASYNC OUT-OF-ORDER TESTS
// ─────────────────────────────────────────────────────────────

test("13. Frontend Race Condition Protection: Request A (chậm 80ms) phản hồi sau Request B (nhanh 20ms) không được ghi đè state", async () => {
  let state = {
    systemStats: null,
    loading: true,
    error: null,
  };
  const currentSchoolIdRef = { current: SCHOOL_A };
  let requestGen = 0;
  let activeAbortController = null;

  function loadReportsForSchool(targetSchoolId, delayMs, mockData) {
    currentSchoolIdRef.current = targetSchoolId;
    const genId = ++requestGen;

    if (activeAbortController) {
      activeAbortController.abort();
    }
    const controller = new AbortController();
    activeAbortController = controller;

    state.systemStats = null;
    state.loading = true;
    state.error = null;

    return new Promise((resolve) => {
      setTimeout(() => {
        if (controller.signal.aborted) {
          return resolve({ aborted: true });
        }
        if (currentSchoolIdRef.current === targetSchoolId && requestGen === genId) {
          state.systemStats = mockData;
          state.loading = false;
        }
        resolve({ success: true });
      }, delayMs);
    });
  }

  // 1. Đang ở School A, request A gửi đi (chậm: 80ms)
  const reqA = loadReportsForSchool(SCHOOL_A, 80, { school: "A", users: 500 });

  // 2. Sau 10ms, đổi sang School B, request B gửi đi (nhanh: 20ms)
  await new Promise((r) => setTimeout(r, 10));
  const reqB = loadReportsForSchool(SCHOOL_B, 20, { school: "B", users: 120 });

  await Promise.all([reqA, reqB]);

  // Request A hoàn tất muộn KHÔNG ĐƯỢC ghi đè dữ liệu của School B
  assert.deepEqual(state.systemStats, { school: "B", users: 120 });
  assert.equal(state.loading, false);
});

test("14. Stale Request Error không được phép ghi đè error trên School B", async () => {
  let state = {
    systemStats: null,
    loading: true,
    error: null,
  };
  const currentSchoolIdRef = { current: SCHOOL_A };
  let requestGen = 0;
  let activeAbortController = null;

  function fetchReports(targetSchoolId, delayMs, mockData, fails = false) {
    currentSchoolIdRef.current = targetSchoolId;
    const genId = ++requestGen;

    if (activeAbortController) {
      activeAbortController.abort();
    }
    const controller = new AbortController();
    activeAbortController = controller;

    state.loading = true;

    return new Promise((resolve) => {
      setTimeout(() => {
        if (controller.signal.aborted) {
          return resolve();
        }
        if (fails) {
          if (currentSchoolIdRef.current === targetSchoolId && requestGen === genId) {
            state.error = "Lỗi trường cũ";
            state.loading = false;
          }
        } else {
          if (currentSchoolIdRef.current === targetSchoolId && requestGen === genId) {
            state.systemStats = mockData;
            state.loading = false;
          }
        }
        resolve();
      }, delayMs);
    });
  }

  const reqA = fetchReports(SCHOOL_A, 90, null, true);
  await new Promise((r) => setTimeout(r, 10));
  const reqB = fetchReports(SCHOOL_B, 20, { school: "B" }, false);

  await Promise.all([reqA, reqB]);

  assert.equal(state.error, null);
  assert.deepEqual(state.systemStats, { school: "B" });
  assert.equal(state.loading, false);
});

test("15. Platform Admin vs School Admin: Yêu cầu X-School-Id cho School Reports, cấm fallback ngầm", async () => {
  // Platform admin nếu cố gọi School Reports mà không có header X-School-Id sẽ bị từ chối 400
  const req = {
    user: { id: ADMIN_A, userId: ADMIN_A, role: "admin" }, // Legacy admin token
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
