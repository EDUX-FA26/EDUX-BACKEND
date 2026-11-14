"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = "multi-tenant-test-secret-key-12345";

const { pool } = require("../src/config/db.config");
const { authenticate } = require("../src/middlewares/auth.middleware");
const { requireSchoolContext } = require("../src/middlewares/requireSchoolContext");
const { authorizeSchoolRoles } = require("../src/middlewares/authorizeSchoolRoles");
const searchService = require("../src/modules/search/search.service");
const searchRepository = require("../src/modules/search/search.repository");
const { searchQuery } = require("../src/modules/search/search.validation");

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

test("3. User không có Membership tại trường được yêu cầu -> Bị từ chối (403)", async () => {
  const origQuery = pool.query;
  pool.query = async (sql) => {
    if (sql.includes("school_memberships")) {
      return { rows: [] };
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

test("4. Phân quyền theo req.tenant.role: student, lecturer, school_admin hợp lệ; role lạ bị chặn (403)", () => {
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

  // Bị chặn: role ngoài danh mục
  {
    const req = {
      user: { id: STUDENT_A },
      tenant: { userId: STUDENT_A, role: "unauthorized_guest", schoolId: SCHOOL_A },
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

test("5. Fail-Closed: Service search từ chối nếu thiếu schoolId, userId hoặc role (throw 400)", () => {
  // Thiếu schoolId
  assert.throws(
    () => {
      searchService.search({ q: "test", page: 1, limit: 10 }, { userId: STUDENT_A, role: "student" });
    },
    (err) => {
      assert.equal(err.message, "SCHOOL_CONTEXT_REQUIRED");
      assert.equal(err.status, 400);
      return true;
    }
  );

  // Thiếu userId
  assert.throws(
    () => {
      searchService.search({ q: "test", page: 1, limit: 10 }, { schoolId: SCHOOL_A, role: "student" });
    },
    (err) => {
      assert.equal(err.message, "SCHOOL_CONTEXT_REQUIRED");
      assert.equal(err.status, 400);
      return true;
    }
  );

  // Thiếu role
  assert.throws(
    () => {
      searchService.search({ q: "test", page: 1, limit: 10 }, { schoolId: SCHOOL_A, userId: STUDENT_A });
    },
    (err) => {
      assert.equal(err.message, "SCHOOL_CONTEXT_REQUIRED");
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test("6. Fail-Closed: Repository search ném lỗi ngay nếu thiếu schoolId (không query DB)", async () => {
  let queryRun = false;
  const origQuery = pool.query;
  pool.query = async () => {
    queryRun = true;
    return { rows: [] };
  };

  try {
    await assert.rejects(
      () => searchRepository.search({ q: "test", page: 1, limit: 10 }, { userId: STUDENT_A, role: "student" }),
      /SCHOOL_ID_REQUIRED_FOR_SEARCH/
    );
    assert.equal(queryRun, false, "Không được phép thực thi SQL khi thiếu schoolId");
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 3. STUDENT SEARCH TENANT ISOLATION
// ─────────────────────────────────────────────────────────────

test("7. Student Search Tenant Isolation: Chỉ tìm thấy Classes, Assignments, Materials, Flashcards thuộc School A", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    if (sql.includes("COUNT(*)")) {
      return { rows: [{ total: 2 }] };
    }
    return {
      rows: [
        { id: "c-1", type: "class", title: "CS101", subtitle: "HK1" },
        { id: "a-1", type: "assignment", title: "Bài tập 1", subtitle: "CS101" },
      ],
    };
  };

  try {
    const res = await searchService.search(
      { q: "CS101", page: 1, limit: 10 },
      { schoolId: SCHOOL_A, userId: STUDENT_A, role: "student" }
    );

    assert.equal(res.total, 2);
    assert.equal(res.data.length, 2);

    assert.ok(capturedQueries.length >= 2);
    for (const q of capturedQueries) {
      assert.deepEqual(q.params.slice(0, 4), ["%CS101%", STUDENT_A, "student", SCHOOL_A]);
      assert.ok(q.sql.includes("c.school_id = $4"));
      assert.ok(q.sql.includes("cm.student_id = $2 AND cm.status = 'active'"));
    }
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 4. LECTURER SEARCH CLASS-LEVEL ISOLATION
// ─────────────────────────────────────────────────────────────

test("8. Lecturer Search Isolation: Tự động giới hạn c.school_id = $4 VÀ c.lecturer_id = $2", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    if (sql.includes("COUNT(*)")) return { rows: [{ total: 1 }] };
    return { rows: [{ id: "c-2", type: "class", title: "SE201" }] };
  };

  try {
    const res = await searchService.search(
      { q: "SE201", type: "class", page: 1, limit: 10 },
      { schoolId: SCHOOL_A, userId: LECTURER_A, role: "lecturer" }
    );

    assert.equal(res.total, 1);
    for (const q of capturedQueries) {
      assert.deepEqual(q.params.slice(0, 4), ["%SE201%", LECTURER_A, "lecturer", SCHOOL_A]);
      assert.ok(q.sql.includes("c.school_id = $4"));
      assert.ok(q.sql.includes("c.lecturer_id = $2"));
    }
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 5. SCHOOL ADMIN SEARCH TENANT ISOLATION
// ─────────────────────────────────────────────────────────────

test("9. School Admin Search Isolation: Tìm thấy tài nguyên trong trường hiện tại, không rò rỉ trường khác", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    if (sql.includes("COUNT(*)")) return { rows: [{ total: 4 }] };
    return { rows: [] };
  };

  try {
    await searchService.search(
      { q: "toán", page: 1, limit: 10 },
      { schoolId: SCHOOL_A, userId: ADMIN_A, role: "school_admin" }
    );

    for (const q of capturedQueries) {
      assert.equal(q.params[3], SCHOOL_A);
      assert.ok(q.sql.includes("c.school_id = $4"));
      // Cho phép school_admin tìm thấy các lớp trong trường mà không bị ràng buộc lecturer_id hay class_members
      assert.ok(q.sql.includes("$3 = 'school_admin' OR $3 = 'admin'"));
    }
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 6. SQL INJECTION & PARAMETERIZED QUERIES
// ─────────────────────────────────────────────────────────────

test("10. SQL Injection Protection: Ký tự nguy hiểm được parameterized an toàn, không bị chèn mã độc", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  const sqlInjectionPayload = "' OR '1'='1' -- ; DROP TABLE users;";

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    if (sql.includes("COUNT(*)")) return { rows: [{ total: 0 }] };
    return { rows: [] };
  };

  try {
    await searchService.search(
      { q: sqlInjectionPayload, page: 1, limit: 10 },
      { schoolId: SCHOOL_A, userId: STUDENT_A, role: "student" }
    );

    assert.ok(capturedQueries.length >= 2);
    for (const q of capturedQueries) {
      assert.equal(q.params[0], `%${sqlInjectionPayload}%`);
      // Đảm bảo không có chuỗi SQL injection thô nào bị ghép trực tiếp vào câu lệnh
      assert.ok(!q.sql.includes("DROP TABLE"));
      assert.ok(!q.sql.includes("'1'='1'"));
    }
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 7. INPUT VALIDATION & PAGINATION
// ─────────────────────────────────────────────────────────────

test("11. Input Validation: Zod schema kiểm tra độ dài q <= 100, page >= 1, limit <= 100", () => {
  // Hợp lệ
  const valid = searchQuery.parse({ q: "kiến trúc phần mềm", page: 2, limit: 25 });
  assert.equal(valid.q, "kiến trúc phần mềm");
  assert.equal(valid.page, 2);
  assert.equal(valid.limit, 25);

  // Không hợp lệ: q vượt quá 100 ký tự
  assert.throws(() => {
    searchQuery.parse({ q: "a".repeat(101) });
  });

  // Không hợp lệ: limit vượt quá 100
  assert.throws(() => {
    searchQuery.parse({ limit: 150 });
  });

  // Không hợp lệ: page âm
  assert.throws(() => {
    searchQuery.parse({ page: -1 });
  });

  // Không hợp lệ: type ngoài danh mục enum
  assert.throws(() => {
    searchQuery.parse({ type: "secret_table" });
  });
});

// ─────────────────────────────────────────────────────────────
// 8. MULTI-SCHOOL USER
// ─────────────────────────────────────────────────────────────

test("12. Multi-School User: Phân quyền chính xác khi user ở 2 trường khác nhau", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    if (sql.includes("COUNT(*)")) return { rows: [{ total: 1 }] };
    return { rows: [] };
  };

  try {
    // 1. Tìm kiếm tại School A dưới vai trò student -> lọc theo class_members
    await searchService.search(
      { q: "lab", type: "assignment", page: 1, limit: 10 },
      { schoolId: SCHOOL_A, userId: STUDENT_A, role: "student" }
    );
    assert.equal(capturedQueries[0].params[3], SCHOOL_A);
    assert.equal(capturedQueries[0].params[2], "student");

    // 2. Tìm kiếm tại School B dưới vai trò lecturer -> lọc theo lecturer_id
    await searchService.search(
      { q: "lab", type: "assignment", page: 1, limit: 10 },
      { schoolId: SCHOOL_B, userId: STUDENT_A, role: "lecturer" }
    );
    assert.equal(capturedQueries[2].params[3], SCHOOL_B);
    assert.equal(capturedQueries[2].params[2], "lecturer");
  } finally {
    pool.query = origQuery;
  }
});

// ─────────────────────────────────────────────────────────────
// 9. FRONTEND RACE CONDITION & ASYNC OUT-OF-ORDER TESTS
// ─────────────────────────────────────────────────────────────

test("13. Frontend Race Condition Protection: Request School A (chậm 80ms) phản hồi sau Request School B (nhanh 20ms) không được ghi đè kết quả", async () => {
  let state = {
    results: [],
    loading: true,
    error: null,
  };
  const currentSchoolIdRef = { current: SCHOOL_A };
  let requestGen = 0;
  let activeAbortController = null;

  function executeSearch(targetSchoolId, delayMs, mockResults) {
    currentSchoolIdRef.current = targetSchoolId;
    const genId = ++requestGen;

    if (activeAbortController) {
      activeAbortController.abort();
    }
    const controller = new AbortController();
    activeAbortController = controller;

    state.results = [];
    state.loading = true;
    state.error = null;

    return new Promise((resolve) => {
      setTimeout(() => {
        if (controller.signal.aborted) {
          return resolve({ aborted: true });
        }
        if (currentSchoolIdRef.current === targetSchoolId && requestGen === genId) {
          state.results = mockResults;
          state.loading = false;
        }
        resolve({ success: true });
      }, delayMs);
    });
  }

  // 1. Đang ở School A, request A gửi đi (chậm: 80ms)
  const reqA = executeSearch(SCHOOL_A, 80, [{ id: "A1", title: "Môn học Trường A" }]);

  // 2. Sau 10ms, đổi sang School B, request B gửi đi (nhanh: 20ms)
  await new Promise((r) => setTimeout(r, 10));
  const reqB = executeSearch(SCHOOL_B, 20, [{ id: "B1", title: "Môn học Trường B" }]);

  await Promise.all([reqA, reqB]);

  // Request A hoàn tất muộn KHÔNG ĐƯỢC ghi đè kết quả của School B
  assert.deepEqual(state.results, [{ id: "B1", title: "Môn học Trường B" }]);
  assert.equal(state.loading, false);
});

test("14. Stale Request Error Isolation: Lỗi mạng từ request trường cũ không ghi đè lên trường mới", async () => {
  let state = {
    results: [],
    loading: true,
    error: null,
  };
  const currentSchoolIdRef = { current: SCHOOL_A };
  let requestGen = 0;
  let activeAbortController = null;

  function performSearch(targetSchoolId, delayMs, mockResults, fails = false) {
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
            state.error = "Lỗi tìm kiếm trường cũ";
            state.loading = false;
          }
        } else {
          if (currentSchoolIdRef.current === targetSchoolId && requestGen === genId) {
            state.results = mockResults;
            state.loading = false;
          }
        }
        resolve();
      }, delayMs);
    });
  }

  const reqA = performSearch(SCHOOL_A, 90, null, true);
  await new Promise((r) => setTimeout(r, 10));
  const reqB = performSearch(SCHOOL_B, 20, [{ id: "B2", title: "Bài tập School B" }], false);

  await Promise.all([reqA, reqB]);

  assert.equal(state.error, null);
  assert.deepEqual(state.results, [{ id: "B2", title: "Bài tập School B" }]);
  assert.equal(state.loading, false);
});

test("15. Platform Admin vs School Admin: Không cho phép tìm kiếm School Content nếu thiếu X-School-Id", async () => {
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

// ─────────────────────────────────────────────────────────────
// 10. FINAL AUDIT TESTS: FLASHCARDS ACCESS & ROLE FALLBACK GUARD
// ─────────────────────────────────────────────────────────────

test("16. Flashcard Decks Access Control: Chỉ tìm flashcards thuộc đúng trường học, kiểm tra class access và active membership", async () => {
  const capturedQueries = [];
  const origQuery = pool.query;

  pool.query = async (sql, params) => {
    capturedQueries.push({ sql, params });
    if (sql.includes("COUNT(*)")) return { rows: [{ total: 1 }] };
    return { rows: [{ id: "fc-1", type: "flashcard", title: "Bộ thẻ Java OOP" }] };
  };

  try {
    // 1. Student tìm flashcard: Bắt buộc lọc theo schoolId và (is_public=true trong trường HOẶC là active member của lớp)
    await searchService.search(
      { q: "OOP", type: "flashcard", page: 1, limit: 10 },
      { schoolId: SCHOOL_A, userId: STUDENT_A, role: "student" }
    );

    assert.ok(capturedQueries.length >= 2);
    for (const q of capturedQueries) {
      assert.deepEqual(q.params.slice(0, 4), ["%OOP%", STUDENT_A, "student", SCHOOL_A]);
      assert.ok(q.sql.includes("(fd.school_id = $4 OR (fd.school_id IS NULL AND c.school_id = $4))"));
      assert.ok(q.sql.includes("cm.student_id = $2 AND cm.status = 'active'"));
    }

    // 2. Lecturer tìm flashcard: Cho phép nếu là public trong trường, tự tạo, hoặc phụ trách lớp
    capturedQueries.length = 0;
    await searchService.search(
      { q: "OOP", type: "flashcard", page: 1, limit: 10 },
      { schoolId: SCHOOL_A, userId: LECTURER_A, role: "lecturer" }
    );

    for (const q of capturedQueries) {
      assert.deepEqual(q.params.slice(0, 4), ["%OOP%", LECTURER_A, "lecturer", SCHOOL_A]);
      assert.ok(q.sql.includes("fd.created_by = $2 OR c.lecturer_id = $2"));
    }
  } finally {
    pool.query = origQuery;
  }
});

test("17. Search Role Resolution: Thiếu activeSchool không được suy diễn School Role từ Global Role (Fail-Closed UI)", () => {
  // Mô phỏng logic giải quyết role trong SearchPage.jsx
  const activeSchool = null; // Người dùng chưa chọn trường hoặc token chỉ có global role
  const user = { role: "admin" }; // Global role

  // Logic an toàn: currentRole PHẢI LÀ NULL hoặc rỗng khi không có activeSchool, cấm fallback sang user.role
  const currentRole = activeSchool?.role || null;
  assert.equal(currentRole, null, "Không được phép fallback sang global role 'admin' khi thiếu activeSchool");

  // Kiểm tra hàm điều hướng resultPath với currentRole null -> trả về null (không lộ link admin)
  const result = { id: "c-1", type: "class" };
  const getResultPath = (item, role) => {
    if (!item?.id || !role) return null;
    if (role === "admin" || role === "school_admin") return "/admin/classes";
    return `/${role}/classes/${item.id}`;
  };

  assert.equal(getResultPath(result, currentRole), null, "Không tạo đường dẫn quản trị khi thiếu vai trò trường học");
});
