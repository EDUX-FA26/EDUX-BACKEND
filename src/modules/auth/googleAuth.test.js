process.env.JWT_SECRET = "test-jwt-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_ALLOWED_DOMAINS = "fpt.edu.vn";

jest.mock("./auth.repository", () => ({
  findUserByEmailForLogin: jest.fn(),
  updateLastLogin: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../config/redis.config", () => ({
  redis: {
    set: jest.fn().mockResolvedValue("OK"),
  },
}));

const authService = require("./auth.service");
const authRepository = require("./auth.repository");
const { redis } = require("../../config/redis.config");
const { OAuth2Client } = require("google-auth-library");
const authRouter = require("./auth.routes");

describe("Auth routes", () => {
  test("exposes Google login and does not expose public registration", () => {
    const routePaths = authRouter.stack
      .filter((layer) => layer.route)
      .map((layer) => layer.route.path);

    expect(routePaths).toContain("/google");
    expect(routePaths).not.toContain("/register");
  });
});

describe("AuthService.googleLogin", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("verifies the Google ID token for the configured OAuth client", async () => {
    const verifyIdToken = jest
      .spyOn(OAuth2Client.prototype, "verifyIdToken")
      .mockResolvedValue({
        getPayload: () => ({
          email: "verified@fpt.edu.vn",
          email_verified: true,
          hd: "fpt.edu.vn",
        }),
      });

    await expect(authService._verifyGoogleCredential("signed-token")).resolves.toEqual({
      email: "verified@fpt.edu.vn",
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: "signed-token",
      audience: process.env.GOOGLE_CLIENT_ID,
    });
  });

  test("rejects a Google profile whose email is not verified", async () => {
    jest.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValue({
      getPayload: () => ({
        email: "unverified@fpt.edu.vn",
        email_verified: false,
      }),
    });

    await expect(authService._verifyGoogleCredential("signed-token")).rejects.toMatchObject({
      status: 401,
    });
  });

  test("rejects a verified Google account outside the school Workspace", async () => {
    jest.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValue({
      getPayload: () => ({
        email: "student@gmail.com",
        email_verified: true,
      }),
    });

    await expect(authService._verifyGoogleCredential("signed-token")).rejects.toMatchObject({
      status: 403,
      message: "Chỉ tài khoản Google Workspace do nhà trường cấp mới được đăng nhập",
    });
  });

  test("rejects an invalid Google credential before querying the database", async () => {
    const error = new Error("Google credential is invalid or expired");
    error.status = 401;
    jest.spyOn(authService, "_verifyGoogleCredential").mockRejectedValue(error);

    await expect(authService.googleLogin("invalid-token")).rejects.toMatchObject({
      status: 401,
    });
    expect(authRepository.findUserByEmailForLogin).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  test("does not create a session when the Google email is absent from EDUX", async () => {
    jest.spyOn(authService, "_verifyGoogleCredential").mockResolvedValue({
      email: "missing@fpt.edu.vn",
    });
    authRepository.findUserByEmailForLogin.mockResolvedValue(null);

    await expect(authService.googleLogin("valid-token")).rejects.toMatchObject({
      status: 403,
      message: "Tài khoản Google chưa được đăng ký trong hệ thống EDUX",
    });
    expect(authRepository.findUserByEmailForLogin).toHaveBeenCalledWith(
      "missing@fpt.edu.vn"
    );
    expect(redis.set).not.toHaveBeenCalled();
  });

  test("rejects an inactive existing EDUX account", async () => {
    jest.spyOn(authService, "_verifyGoogleCredential").mockResolvedValue({
      email: "inactive@fpt.edu.vn",
    });
    authRepository.findUserByEmailForLogin.mockResolvedValue({
      id: "user-inactive",
      email: "inactive@fpt.edu.vn",
      username: "inactive",
      role: "student",
      is_active: false,
    });

    await expect(authService.googleLogin("valid-token")).rejects.toMatchObject({
      status: 403,
      message: "Tài khoản EDUX đã bị khóa hoặc ngừng hoạt động",
    });
    expect(redis.set).not.toHaveBeenCalled();
  });

  test("creates a session only for an active existing EDUX account", async () => {
    const user = {
      id: "user-active",
      email: "active@fpt.edu.vn",
      username: "active",
      role: "student",
      is_active: true,
    };
    jest.spyOn(authService, "_verifyGoogleCredential").mockResolvedValue({
      email: user.email,
    });
    authRepository.findUserByEmailForLogin.mockResolvedValue(user);

    const result = await authService.googleLogin("valid-token");

    expect(result.user).toEqual(user);
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(authRepository.updateLastLogin).toHaveBeenCalledWith(user.id);
    expect(redis.set).toHaveBeenCalledWith(
      `refresh_token:${user.id}`,
      result.refreshToken,
      { EX: 7 * 24 * 60 * 60 }
    );
  });
});
