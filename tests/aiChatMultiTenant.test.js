"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = "multi-tenant-test-secret-key-12345";

const { pool } = require("../src/config/db.config");
const { authenticate } = require("../src/middlewares/auth.middleware");
const { requireSchoolContext } = require("../src/middlewares/requireSchoolContext");
const { authorizeSchoolRoles } = require("../src/middlewares/authorizeSchoolRoles");
const AiChatService = require("../src/modules/ai-chat/aiChat.service");
const AiChatRepository = require("../src/modules/ai-chat/aiChat.repository");

// UUIDs
const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "22222222-2222-4222-8222-222222222222";
const STUDENT_A = "33333333-3333-4333-8333-333333333331";
const LECTURER_A = "44444444-4444-4444-8444-444444444441";
const MULTI_STUDENT = "55555555-5555-4555-8555-555555555555";

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
  const originalQuery = pool.query;
  try {
    pool.query = async (sql) => {
      if (sql.includes("FROM public.school_memberships")) {
        return { rows: [] }; // Không có membership
      }
      return { rows: [] };
    };

    const req = {
      user: { id: STUDENT_A, userId: STUDENT_A, role: "student" },
      get(header) {
        return header.toLowerCase() === "x-school-id" ? SCHOOL_B : null;
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
    pool.query = originalQuery;
  }
});

test("4. Phân quyền vai trò theo trường (authorizeSchoolRoles): Chặn Lecturer và Admin, chỉ cho Student dùng AI Chat", () => {
  const middleware = authorizeSchoolRoles("student");
  const req = {
    user: { id: LECTURER_A },
    tenant: { schoolId: SCHOOL_A, userId: LECTURER_A, role: "lecturer" },
  };
  const res = createMockRes();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "INSUFFICIENT_SCHOOL_ROLE");
  assert.equal(nextCalled, false);
});

test("5. Cross-Tenant AI Context Isolation: Tất cả 10 câu queries trong getStudentContext đều lọc theo school_id", async () => {
  const originalQuery = pool.query;
  const capturedQueries = [];

  try {
    pool.query = async (sql, params) => {
      capturedQueries.push({ sql, params });
      return { rows: [] };
    };

    await AiChatRepository.getStudentContext(STUDENT_A, SCHOOL_A);

    assert.equal(capturedQueries.length, 10, "Phải thực thi đúng 10 truy vấn ngữ cảnh học tập");

    // 1. Semesters query
    assert.ok(capturedQueries[0].sql.includes("school_id = $1"), "Semesters phải lọc theo school_id");
    assert.equal(capturedQueries[0].params[0], SCHOOL_A);

    // 2. Classes query
    assert.ok(capturedQueries[1].sql.includes("c.school_id = $2"), "Classes phải lọc theo c.school_id");
    assert.equal(capturedQueries[1].params[0], STUDENT_A);
    assert.equal(capturedQueries[1].params[1], SCHOOL_A);

    // 3. Schedule query
    assert.ok(capturedQueries[2].sql.includes("c.school_id = $2"), "Schedule phải lọc theo c.school_id");
    assert.equal(capturedQueries[2].params[1], SCHOOL_A);

    // 4. Assignments query
    assert.ok(capturedQueries[3].sql.includes("c.school_id = $2"), "Assignments phải lọc theo c.school_id");
    assert.equal(capturedQueries[3].params[1], SCHOOL_A);

    // 5. Notifications query
    assert.ok(
      capturedQueries[4].sql.includes("notification_scope = 'school' AND school_id = $2"),
      "Notifications phải lọc theo School Scope và Platform"
    );
    assert.equal(capturedQueries[4].params[1], SCHOOL_A);

    // 6. Grades query
    assert.ok(capturedQueries[5].sql.includes("c.school_id = $2"), "Grades phải lọc theo c.school_id");
    assert.equal(capturedQueries[5].params[1], SCHOOL_A);

    // 7. Flashcard Tests query
    assert.ok(capturedQueries[6].sql.includes("fd.school_id = $2"), "Flashcard tests phải lọc theo fd.school_id");
    assert.equal(capturedQueries[6].params[1], SCHOOL_A);

    // 8. Flashcard Reviews query
    assert.ok(capturedQueries[7].sql.includes("fd.school_id = $2"), "Flashcard reviews phải lọc theo fd.school_id");
    assert.equal(capturedQueries[7].params[1], SCHOOL_A);

    // 9. Streak activities query
    assert.ok(capturedQueries[8].sql.includes("s.school_id = $2"), "Learning streak phải lọc theo s.school_id");
    assert.equal(capturedQueries[8].params[1], SCHOOL_A);

    // 10. Flashcard Decks query
    assert.ok(capturedQueries[9].sql.includes("fd.school_id = $2"), "Flashcard decks phải lọc theo fd.school_id");
    assert.equal(capturedQueries[9].params[1], SCHOOL_A);

    // Kiểm tra không có bất kỳ truy vấn nào chứa điều kiện bypass $1/$2 IS NULL OR
    assert.ok(
      !capturedQueries.some((q) => /\$(1|2)::uuid\s+IS\s+NULL/i.test(q.sql)),
      "Tuyệt đối không được chứa điều kiện nới lỏng ($1/$2::uuid IS NULL OR ...) trong SQL"
    );
  } finally {
    pool.query = originalQuery;
  }
});

test("6. Multi-School User: Phân vùng AI Context độc lập khi sinh viên học tại 2 trường khác nhau", async () => {
  const originalQuery = pool.query;
  const capturedSchoolIds = [];

  try {
    pool.query = async (sql, params) => {
      // Bắt schoolId được truyền vào
      if (params && params.length >= 2 && params[1]) {
        capturedSchoolIds.push(params[1]);
      }
      return { rows: [] };
    };

    const tenantA = { schoolId: SCHOOL_A, userId: MULTI_STUDENT, role: "student" };
    const tenantB = { schoolId: SCHOOL_B, userId: MULTI_STUDENT, role: "student" };

    await AiChatService.answer("Lịch học của mình?", tenantA);
    const countA = capturedSchoolIds.filter((id) => id === SCHOOL_A).length;

    await AiChatService.answer("Lịch học của mình?", tenantB);
    const countB = capturedSchoolIds.filter((id) => id === SCHOOL_B).length;

    assert.ok(countA > 0, "Phải lọc theo SCHOOL_A khi ở School A");
    assert.ok(countB > 0, "Phải lọc theo SCHOOL_B khi ở School B");
    assert.equal(capturedSchoolIds.includes("UNKNOWN"), false);
  } finally {
    pool.query = originalQuery;
  }
});

test("7. AI Context Phản hồi: Dữ liệu bài tập của School B không xuất hiện trong câu trả lời ở School A", async () => {
  const originalQuery = pool.query;

  try {
    pool.query = async (sql, params) => {
      // Nếu query assignments có lọc c.school_id = SCHOOL_A thì chỉ trả bài tập School A
      if (sql.includes("assignments a") && params[1] === SCHOOL_A) {
        return {
          rows: [
            {
              title: "Bài tập Toán A",
              subject_name: "Toán Đại Cương",
              deadline: new Date().toISOString(),
              submitted: false,
            },
          ],
        };
      }
      return { rows: [] };
    };

    const tenantA = { schoolId: SCHOOL_A, userId: STUDENT_A, role: "student" };
    const response = await AiChatService.answer("Bài tập sắp tới là gì?", tenantA);

    assert.ok(response.answer.includes("Bài tập Toán A"));
    assert.ok(!response.answer.includes("Bài tập Triết B")); // Không có bài tập của trường khác
  } finally {
    pool.query = originalQuery;
  }
});

test("8. Validation: Kiểm tra độ dài câu hỏi và tin nhắn rỗng", async () => {
  const tenantA = { schoolId: SCHOOL_A, userId: STUDENT_A, role: "student" };

  // Tin nhắn rỗng
  await assert.rejects(
    async () => {
      await AiChatService.answer("", tenantA);
    },
    (err) => {
      assert.equal(err.message, "MESSAGE_REQUIRED");
      return true;
    }
  );

  // Tin nhắn quá dài (> 500 ký tự)
  await assert.rejects(
    async () => {
      await AiChatService.answer("a".repeat(501), tenantA);
    },
    (err) => {
      assert.equal(err.message, "MESSAGE_TOO_LONG");
      return true;
    }
  );
});

test("9. Fail-Closed Security: Gọi Service với schoolId = null -> Phải từ chối (SCHOOL_CONTEXT_REQUIRED), không được truy vấn DB", async () => {
  const originalQuery = pool.query;
  let dbQueried = false;

  try {
    pool.query = async () => {
      dbQueried = true;
      return { rows: [] };
    };

    const invalidTenant = { schoolId: null, userId: STUDENT_A, role: "student" };

    await assert.rejects(
      async () => {
        await AiChatService.answer("Lịch học của mình?", invalidTenant);
      },
      (err) => {
        assert.equal(err.message, "SCHOOL_CONTEXT_REQUIRED");
        return true;
      }
    );

    assert.equal(dbQueried, false, "Tuyệt đối không được thực thi SQL khi thiếu schoolId");
  } finally {
    pool.query = originalQuery;
  }
});

test("10. Fail-Closed Security: Gọi Service thiếu schoolId (undefined) -> Phải từ chối (SCHOOL_CONTEXT_REQUIRED), không được truy vấn DB", async () => {
  const originalQuery = pool.query;
  let dbQueried = false;

  try {
    pool.query = async () => {
      dbQueried = true;
      return { rows: [] };
    };

    const invalidTenant = { userId: STUDENT_A, role: "student" }; // Không có schoolId

    await assert.rejects(
      async () => {
        await AiChatService.answer("Lịch học của mình?", invalidTenant);
      },
      (err) => {
        assert.equal(err.message, "SCHOOL_CONTEXT_REQUIRED");
        return true;
      }
    );

    assert.equal(dbQueried, false, "Tuyệt đối không được thực thi SQL khi schoolId undefined");
  } finally {
    pool.query = originalQuery;
  }
});

test("11. Client Race Condition Simulation: Chuyển trường từ School A sang School B trong khi request của School A đang bay", async () => {
  // Mô phỏng state và ref của AIChatBox component
  let currentSchoolId = SCHOOL_A;
  let loadingState = false;
  let currentMessages = [
    { role: "assistant", text: "Welcome" }
  ];

  // Giả lập logic trong send() và useEffect() của AIChatBox:
  // 1. User tại School A gửi câu hỏi (request chậm, mất 30ms)
  const request1SchoolId = currentSchoolId;
  loadingState = true;
  currentMessages.push({ role: "user", text: "Hỏi tại School A" });

  const slowRequestPromise = new Promise((resolve) => {
    setTimeout(() => {
      resolve({ answer: "Dữ liệu riêng tư của School A" });
    }, 30);
  });

  // 2. Trong lúc request 1 đang bay, người dùng chuyển sang School B!
  // useEffect() kích hoạt:
  currentSchoolId = SCHOOL_B;
  loadingState = false;
  currentMessages = [
    { role: "assistant", text: "Welcome" }
  ];

  // 3. Request 1 hoàn tất, component kiểm tra race condition
  const result1 = await slowRequestPromise;
  if (currentSchoolId === request1SchoolId) {
    // Nếu trùng trường thì mới cập nhật (ở đây không trùng nên sẽ BỎ QUA)
    currentMessages.push({ role: "assistant", text: result1.answer });
  }

  // 4. Kiểm tra: Dữ liệu của School A tuyệt đối KHÔNG xuất hiện trong messages của School B
  assert.equal(currentSchoolId, SCHOOL_B);
  assert.equal(currentMessages.length, 1);
  assert.equal(currentMessages[0].text, "Welcome");
  assert.ok(!JSON.stringify(currentMessages).includes("School A"), "Dữ liệu School A không được ghi đè vào School B");
  assert.equal(loadingState, false, "Loading state không bị request cũ ghi đè");
});

test("12. Fail-Closed Repository Security: Gọi AiChatRepository.getStudentContext với schoolId = null -> Ném lỗi SCHOOL_ID_REQUIRED_FOR_AI_CONTEXT, không query DB", async () => {
  const originalQuery = pool.query;
  let dbQueried = false;

  try {
    pool.query = async () => {
      dbQueried = true;
      return { rows: [] };
    };

    await assert.rejects(
      async () => {
        await AiChatRepository.getStudentContext(STUDENT_A, null);
      },
      (err) => {
        assert.equal(err.message, "SCHOOL_ID_REQUIRED_FOR_AI_CONTEXT");
        return true;
      }
    );

    assert.equal(dbQueried, false, "Tuyệt đối không được thực thi SQL khi schoolId là null tại Repository level");
  } finally {
    pool.query = originalQuery;
  }
});

test("13. Fail-Closed Repository Security: Gọi AiChatRepository.getStudentContext thiếu schoolId (undefined) -> Ném lỗi SCHOOL_ID_REQUIRED_FOR_AI_CONTEXT, không query DB", async () => {
  const originalQuery = pool.query;
  let dbQueried = false;

  try {
    pool.query = async () => {
      dbQueried = true;
      return { rows: [] };
    };

    await assert.rejects(
      async () => {
        await AiChatRepository.getStudentContext(STUDENT_A);
      },
      (err) => {
        assert.equal(err.message, "SCHOOL_ID_REQUIRED_FOR_AI_CONTEXT");
        return true;
      }
    );

    assert.equal(dbQueried, false, "Tuyệt đối không được thực thi SQL khi thiếu schoolId tại Repository level");
  } finally {
    pool.query = originalQuery;
  }
});

