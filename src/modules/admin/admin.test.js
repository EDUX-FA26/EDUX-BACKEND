const request = require("supertest");
const app = require("../../app");
const jwt = require("jsonwebtoken");
const { pool } = require("../../config/db.config");

const JWT_SECRET = process.env.JWT_SECRET;

let adminToken;
let studentToken;
let testUserId;

beforeAll(async () => {
  // Sinh token giả không cần user thật trong DB (giống pattern dự án)
  adminToken = jwt.sign({ userId: 9999, role: "admin" }, JWT_SECRET, { expiresIn: "1h" });
  studentToken = jwt.sign({ userId: 8888, role: "student" }, JWT_SECRET, { expiresIn: "1h" });
});

afterAll(async () => {
  // Cleanup: xóa user test nếu đã tạo
  if (testUserId) {
    await pool.query("DELETE FROM user_profiles WHERE user_id = $1", [testUserId]);
    await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
  }
  await pool.end();
});

describe("Admin User Module — /api/admin/users (UC 86–89)", () => {

  // ─── Auth & Authorization ──────────────────────────────────────────────────

  it("UC: Phải trả về 401 nếu không có token", async () => {
    const res = await request(app).post("/api/admin/users").send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("UC: Phải trả về 403 nếu không có quyền admin (role = student)", async () => {
    const res = await request(app)
      .post("/api/admin/users")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // ─── UC 86 — POST /api/admin/users (Create User) ──────────────────────────

  describe("UC 86 — POST /api/admin/users", () => {
    it("Tạo user mới thành công với role lecturer", async () => {
      const res = await request(app)
        .post("/api/admin/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          email: "testlecturer.admin@example.com",
          username: "testlecturer_admin",
          password: "password123",
          role: "lecturer",
          full_name: "Giảng viên Test",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBeDefined();
      expect(res.body.data.email).toBe("testlecturer.admin@example.com");
      expect(res.body.data.role).toBe("lecturer");
      expect(res.body.data.full_name).toBe("Giảng viên Test");

      testUserId = res.body.data.id;
    });

    it("Trả về 409 nếu email đã tồn tại", async () => {
      const res = await request(app)
        .post("/api/admin/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          email: "testlecturer.admin@example.com", // email đã tạo ở trên
          password: "password123",
          role: "student",
          full_name: "Người Dùng Khác",
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it("Trả về 400 nếu dữ liệu không hợp lệ (Zod validation)", async () => {
      const res = await request(app)
        .post("/api/admin/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          email: "invalidemail",       // sai format
          password: "123",             // quá ngắn
          role: "superadmin",          // không hợp lệ
          full_name: "",               // bắt buộc
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toBeDefined();
      expect(Array.isArray(res.body.errors)).toBe(true);
    });
  });

  // ─── UC 87 — PATCH /api/admin/users/:id (Update User) ────────────────────

  describe("UC 87 — PATCH /api/admin/users/:id", () => {
    it("Cập nhật thông tin user thành công", async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${testUserId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          full_name: "Giảng Viên Đã Sửa",
          role: "admin",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBeDefined();
      expect(res.body.data.full_name).toBe("Giảng Viên Đã Sửa");
      expect(res.body.data.role).toBe("admin");
    });

    it("Trả về 404 nếu user không tồn tại", async () => {
      const res = await request(app)
        .patch(`/api/admin/users/00000000-0000-0000-0000-000000000000`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ full_name: "Test" });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── UC 88 — PATCH /api/admin/users/:id/suspend (Suspend User) ───────────

  describe("UC 88 — PATCH /api/admin/users/:id/suspend", () => {
    it("Tạm khóa user thành công", async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${testUserId}/suspend`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBeDefined();
      expect(res.body.data).toBeNull();

      // Xác minh trong DB
      const { rows } = await pool.query("SELECT is_active FROM users WHERE id = $1", [testUserId]);
      expect(rows[0].is_active).toBe(false);
    });

    it("Trả về 404 khi suspend user không tồn tại", async () => {
      const res = await request(app)
        .patch(`/api/admin/users/00000000-0000-0000-0000-000000000000/suspend`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── UC 89 — PATCH /api/admin/users/:id/activate (Activate User) ─────────

  describe("UC 89 — PATCH /api/admin/users/:id/activate", () => {
    it("Kích hoạt lại user thành công", async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${testUserId}/activate`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBeDefined();
      expect(res.body.data).toBeNull();

      // Xác minh trong DB
      const { rows } = await pool.query("SELECT is_active FROM users WHERE id = $1", [testUserId]);
      expect(rows[0].is_active).toBe(true);
    });

    it("Trả về 404 khi activate user không tồn tại", async () => {
      const res = await request(app)
        .patch(`/api/admin/users/00000000-0000-0000-0000-000000000000/activate`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── GET /api/admin/users (Get All Users) ─────────────────────────────────

  describe("GET /api/admin/users", () => {
    it("Lấy danh sách users thành công", async () => {
      const res = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
