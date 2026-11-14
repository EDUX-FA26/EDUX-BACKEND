"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = "multi-tenant-test-secret-key-12345";

const { pool } = require("../src/config/db.config");
const { requireSchoolContext } = require("../src/middlewares/requireSchoolContext");
const { authorizeSchoolRoles } = require("../src/middlewares/authorizeSchoolRoles");
const NotificationsService = require("../src/modules/notifications/notifications.service");
const NotificationsRepository = require("../src/modules/notifications/notifications.repository");
const { emitCreatedNotifications } = require("../src/modules/notifications/notifications.realtime");
const socketConfig = require("../src/config/socket.config");

// UUIDs
const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "22222222-2222-4222-8222-222222222222";
const USER_A1 = "33333333-3333-4333-8333-333333333331";
const USER_B1 = "33333333-3333-4333-8333-333333333332";
const MULTI_USER = "44444444-4444-4444-8444-444444444444";

const NOTIF_SCHOOL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOTIF_SCHOOL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOTIF_PLATFORM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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

  authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
  assert.equal(nextCalled, false);
});

test("2. Không có School Context (thiếu header X-School-Id) -> Bị từ chối (400)", async () => {
  const req = {
    user: { id: USER_A1, userId: USER_A1, role: "student" },
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
      user: { id: USER_A1, userId: USER_A1, role: "student" },
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

test("4. Phân quyền vai trò theo trường (authorizeSchoolRoles) chặn truy cập sai vai trò", () => {
  const middleware = authorizeSchoolRoles("school_admin");
  const req = {
    user: { id: USER_A1 },
    tenant: { schoolId: SCHOOL_A, userId: USER_A1, role: "student" },
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

test("5. Lấy danh sách notifications: Lọc đúng Tenant Scope (School A + Platform), loại trừ School B", async () => {
  const originalQuery = pool.query;
  let executedQuery = null;
  let executedParams = null;

  try {
    pool.query = async (sql, params) => {
      executedQuery = sql;
      executedParams = params;
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ count: "2" }] };
      }
      return {
        rows: [
          {
            id: NOTIF_SCHOOL_A,
            user_id: USER_A1,
            title: "School A notif",
            school_id: SCHOOL_A,
            notification_scope: "school",
            is_read: false,
          },
          {
            id: NOTIF_PLATFORM,
            user_id: USER_A1,
            title: "Platform notif",
            school_id: null,
            notification_scope: "platform",
            is_read: false,
          },
        ],
      };
    };

    const tenantA = { schoolId: SCHOOL_A, userId: USER_A1, role: "student" };
    const result = await NotificationsService.getNotifications({ page: 1, limit: 10 }, tenantA);

    assert.equal(result.data.length, 2);
    // Query phải lọc user_id và kết hợp scope school_id = SCHOOL_A HOẶC platform
    assert.ok(executedQuery.includes("user_id = $1"));
    assert.ok(executedQuery.includes("notification_scope = 'school' AND school_id = $2"));
    assert.ok(executedQuery.includes("notification_scope = 'platform'"));
    assert.equal(executedParams[0], USER_A1);
    assert.equal(executedParams[1], SCHOOL_A);
  } finally {
    pool.query = originalQuery;
  }
});

test("6. Đếm unread: Chỉ đếm trong Tenant Scope của School A + Platform", async () => {
  const originalQuery = pool.query;
  let executedQuery = null;
  let executedParams = null;

  try {
    pool.query = async (sql, params) => {
      executedQuery = sql;
      executedParams = params;
      return { rows: [{ count: "3" }] };
    };

    const count = await NotificationsRepository.countUnread(USER_A1, SCHOOL_A);

    assert.equal(count, 3);
    assert.ok(executedQuery.includes("user_id = $1 AND is_read = false"));
    assert.ok(executedQuery.includes("school_id = $2"));
    assert.equal(executedParams[0], USER_A1);
    assert.equal(executedParams[1], SCHOOL_A);
  } finally {
    pool.query = originalQuery;
  }
});

test("7. User School A cố truy cập Notification thuộc School B -> Bị từ chối (404 NOTIFICATION_NOT_FOUND)", async () => {
  const originalQuery = pool.query;

  try {
    pool.query = async (sql, params) => {
      // Giả lập SQL lọc theo School A không thấy Notification thuộc School B
      if (sql.includes("WHERE id = $1") && sql.includes("school_id = $2")) {
        return { rows: [] }; // Không tìm thấy vì khác school_id
      }
      return { rows: [] };
    };

    const tenantA = { schoolId: SCHOOL_A, userId: USER_A1, role: "student" };

    await assert.rejects(
      async () => {
        await NotificationsService.getNotificationById(NOTIF_SCHOOL_B, tenantA);
      },
      (err) => {
        assert.equal(err.message, "NOTIFICATION_NOT_FOUND");
        return true;
      }
    );
  } finally {
    pool.query = originalQuery;
  }
});

test("8. User cố truy cập Notification của User khác trong cùng trường -> Bị từ chối (403 FORBIDDEN)", async () => {
  const originalQuery = pool.query;

  try {
    pool.query = async (sql, params) => {
      return {
        rows: [
          {
            id: NOTIF_SCHOOL_A,
            user_id: USER_B1, // Notification thuộc user khác
            school_id: SCHOOL_A,
            notification_scope: "school",
          },
        ],
      };
    };

    const tenantA = { schoolId: SCHOOL_A, userId: USER_A1, role: "student" };

    await assert.rejects(
      async () => {
        await NotificationsService.getNotificationById(NOTIF_SCHOOL_A, tenantA);
      },
      (err) => {
        assert.equal(err.message, "FORBIDDEN");
        return true;
      }
    );
  } finally {
    pool.query = originalQuery;
  }
});

test("9. Mark all as read: Chỉ cập nhật các thông báo thuộc School hiện tại + Platform", async () => {
  const originalQuery = pool.query;
  let executedQuery = null;
  let executedParams = null;

  try {
    pool.query = async (sql, params) => {
      executedQuery = sql;
      executedParams = params;
      return { rowCount: 5 };
    };

    const tenantA = { schoolId: SCHOOL_A, userId: USER_A1, role: "student" };
    const result = await NotificationsService.markAllAsRead(tenantA);

    assert.equal(result.updated, 5);
    assert.ok(executedQuery.includes("UPDATE notifications"));
    assert.ok(executedQuery.includes("user_id = $1 AND is_read = false"));
    assert.ok(executedQuery.includes("school_id = $2"));
    assert.equal(executedParams[0], USER_A1);
    assert.equal(executedParams[1], SCHOOL_A);
  } finally {
    pool.query = originalQuery;
  }
});

test("10. Multi-School User: Phân vùng độc lập khi chuyển giữa School A và School B", async () => {
  const originalQuery = pool.query;
  const capturedSchoolIds = [];

  try {
    pool.query = async (sql, params) => {
      if (sql.includes("COUNT(*)") && params && params[1]) {
        capturedSchoolIds.push(params[1]);
      }
      return { rows: [{ count: "1" }] };
    };

    const tenantA = { schoolId: SCHOOL_A, userId: MULTI_USER, role: "student" };
    const tenantB = { schoolId: SCHOOL_B, userId: MULTI_USER, role: "lecturer" };

    await NotificationsService.getNotifications({ page: 1, limit: 10 }, tenantA);
    await NotificationsService.getNotifications({ page: 1, limit: 10 }, tenantB);

    assert.equal(capturedSchoolIds[0], SCHOOL_A);
    assert.equal(capturedSchoolIds[1], SCHOOL_B);
  } finally {
    pool.query = originalQuery;
  }
});

test("11. Realtime Socket.IO: Phân vùng phòng theo Tenant Scope (school:${schoolId}:user:${userId})", () => {
  const emittedRooms = [];
  const emittedEvents = [];

  const http = require("http");
  const server = http.createServer();
  const io = socketConfig.initializeSocket(server);

  const originalTo = io.to.bind(io);
  io.to = (room) => {
    emittedRooms.push(room);
    return {
      emit(event, payload) {
        emittedEvents.push({ event, payload });
      },
    };
  };

  try {
    // 1. School Notification
    emitCreatedNotifications([
      {
        id: NOTIF_SCHOOL_A,
        user_id: USER_A1,
        school_id: SCHOOL_A,
        notification_scope: "school",
        title: "Test school notif",
        message: "Hello",
      },
    ]);

    // 2. Platform Notification
    emitCreatedNotifications([
      {
        id: NOTIF_PLATFORM,
        user_id: USER_A1,
        school_id: null,
        notification_scope: "platform",
        title: "Test platform notif",
        message: "System maintenance",
      },
    ]);

    // Kiểm tra: School notification phải emit vào room có tenant scope
    assert.equal(emittedRooms[0], `school:${SCHOOL_A}:user:${USER_A1}`);
    assert.notEqual(emittedRooms[0], `user:${USER_A1}`); // Không bao giờ emit vào room global
    assert.equal(emittedEvents[0].payload.school_id, SCHOOL_A);

    // Platform notification emit vào room platform
    assert.equal(emittedRooms[1], `platform:user:${USER_A1}`);
    assert.notEqual(emittedRooms[1], `user:${USER_A1}`);
    assert.equal(emittedEvents[1].payload.notification_scope, "platform");
  } finally {
    io.to = originalTo;
  }
});

test("12. Create Notification: Bắt buộc schoolId khi scope='school', cấm fallback ngầm; Platform Notification school_id=NULL", async () => {
  const originalQuery = pool.query;
  let capturedInsertParams = null;

  try {
    pool.query = async (sql, params) => {
      capturedInsertParams = params;
      return { rows: [{ id: "new-notif-1", user_id: params[0], school_id: params[1], notification_scope: params[2] }] };
    };

    // 1. School notification không có schoolId -> Phải throw error ngay lập tức
    await assert.rejects(
      async () => {
        await NotificationsRepository.create({
          userId: USER_A1,
          scope: "school",
          schoolId: null, // Không có schoolId
          title: "Test",
          message: "No school ID",
          type: "system_announcement",
        });
      },
      (err) => {
        assert.equal(err.message, "SCHOOL_ID_REQUIRED_FOR_SCHOOL_NOTIFICATION");
        return true;
      }
    );

    // 2. Platform notification -> Bắt buộc school_id = NULL
    const platformNotif = await NotificationsRepository.create({
      userId: USER_A1,
      scope: "platform",
      schoolId: null,
      title: "Bảo trì",
      message: "Toàn hệ thống",
      type: "system_announcement",
    });

    assert.equal(capturedInsertParams[1], null); // school_id = NULL
    assert.equal(capturedInsertParams[2], "platform"); // notification_scope = 'platform'
  } finally {
    pool.query = originalQuery;
  }
});

test("13. Socket.IO Security Assessment: Đánh giá nguy cơ client giả mạo socket room khi socket.config.js chưa có Join Authorization", () => {
  // Mô phỏng socket connection handler hiện tại của socket.config.js
  const joinedRooms = [];
  const mockSocket = {
    id: "socket-client-malicious",
    join(room) {
      joinedRooms.push(room);
    },
    on(event, handler) {
      if (event === "join") {
        this.joinHandler = handler;
      }
    },
  };

  // Giả lập logic trong socket.config.js hiện tại:
  // socket.on("join", (room) => { if (room) socket.join(room); });
  mockSocket.on("join", (room) => {
    if (room) {
      mockSocket.join(room);
    }
  });

  // Client thuộc School A cố tình join phòng của User tại School B
  const targetVictimRoom = `school:${SCHOOL_B}:user:${USER_B1}`;
  mockSocket.joinHandler(targetVictimRoom);

  // Xác nhận lỗ hổng: socket hiện tại cho phép gia nhập room mà không có kiểm tra quyền
  assert.ok(joinedRooms.includes(targetVictimRoom), "LỖ HỔNG XÁC NHẬN: Client tự do join phòng của trường khác");
});
