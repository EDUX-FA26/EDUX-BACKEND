const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const authRepository = require("./auth.repository");
const { redis } = require("../../config/redis.config");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET;
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "7d";

class AuthService {
  async register(userData) {
    // 1. Kiểm tra trùng lặp
    const duplicates = await authRepository.checkDuplication(
      userData.email,
      userData.username,
      userData.student_code
    );
    if (duplicates && duplicates.length > 0) {
      const error = new Error(`Conflict: ${duplicates.join(", ")} already exists`);
      error.status = 409;
      throw error;
    }

    // 2. Hash password
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    const userToCreate = {
      ...userData,
      password_hash: hashedPassword,
    };

    // 3. Tạo user
    const newUser = await authRepository.createUser(userToCreate);
    return newUser;
  }

  async login(identifier, password) {
    // 1. Tìm user
    const user = await authRepository.findUserByEmailOrUsername(identifier);
    if (!user) {
      const error = new Error("Invalid credentials");
      error.status = 401;
      throw error;
    }

    // 2. Kiểm tra is_active
    if (!user.is_active) {
      const error = new Error("Account is inactive");
      error.status = 403;
      throw error;
    }

    // 3. So khớp password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      const error = new Error("Invalid credentials");
      error.status = 401;
      throw error;
    }

    return this._createSession(user);
  }

  async googleLogin(credential) {
    const googleProfile = await this._verifyGoogleCredential(credential);
    const user = await authRepository.findUserByEmailForLogin(googleProfile.email);

    if (!user) {
      const error = new Error("Tài khoản Google chưa được đăng ký trong hệ thống EDUX");
      error.status = 403;
      throw error;
    }

    if (!user.is_active) {
      const error = new Error("Tài khoản EDUX đã bị khóa hoặc ngừng hoạt động");
      error.status = 403;
      throw error;
    }

    return this._createSession(user);
  }

  async _verifyGoogleCredential(credential) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      const error = new Error("Google login is not configured");
      error.status = 503;
      throw error;
    }

    const allowedDomains = (process.env.GOOGLE_ALLOWED_DOMAINS || "")
      .split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);
    if (allowedDomains.length === 0) {
      const error = new Error("Google Workspace domain is not configured");
      error.status = 503;
      throw error;
    }

    let profile;
    try {
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });
      profile = ticket.getPayload();
    } catch {
      const error = new Error("Google credential is invalid or expired");
      error.status = 401;
      throw error;
    }

    if (!profile?.email || profile.email_verified !== true) {
      const error = new Error("Google credential is invalid or expired");
      error.status = 401;
      throw error;
    }

    const emailDomain = profile.email.split("@").pop().toLowerCase();
    const workspaceDomain = profile.hd?.toLowerCase();
    if (
      !workspaceDomain ||
      !allowedDomains.includes(workspaceDomain) ||
      !allowedDomains.includes(emailDomain)
    ) {
      const error = new Error("Chỉ tài khoản Google Workspace do nhà trường cấp mới được đăng nhập");
      error.status = 403;
      throw error;
    }

    return { email: profile.email };
  }

  async _createSession(user) {
    authRepository.updateLastLogin(user.id).catch((err) => {
      console.error("Failed to update last login:", err);
    });

    const payload = { userId: user.id, role: user.role };
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });
    const ttlSeconds = this._parseExpireString(JWT_REFRESH_EXPIRES_IN);
    await redis.set(`refresh_token:${user.id}`, refreshToken, { EX: ttlSeconds });

    const { password_hash, ...userInfo } = user;
    return { accessToken, refreshToken, user: userInfo };
  }

  async refreshToken(token) {
    try {
      // 1. Verify token signature
      const decoded = jwt.verify(token, JWT_REFRESH_SECRET);
      const userId = decoded.userId;

      // 2. Lấy token đang lưu trong Redis
      const storedToken = await redis.get(`refresh_token:${userId}`);
      if (!storedToken || storedToken !== token) {
        throw new Error("Refresh token expired or revoked");
      }

      // 3. Sinh Access Token mới
      const payload = { userId, role: decoded.role };
      const newAccessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      
      // Xoay vòng Refresh Token
      const newRefreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });
      const ttlSeconds = this._parseExpireString(JWT_REFRESH_EXPIRES_IN);
      await redis.set(`refresh_token:${userId}`, newRefreshToken, {
        EX: ttlSeconds,
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (err) {
      const error = new Error("Refresh token expired or revoked");
      error.status = 401;
      throw error;
    }
  }

  async logout(userId) {
    await redis.del(`refresh_token:${userId}`);
    return { success: true };
  }

  async changePassword(userId, oldPassword, newPassword) {
    // 1. Lấy thông tin user hiện tại (chứa password_hash)
    const user = await authRepository.findUserByIdWithPassword(userId);
    if (!user) {
      const error = new Error("User not found");
      error.status = 404;
      throw error;
    }

    // 2. Kiểm tra mật khẩu cũ
    const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isMatch) {
      const error = new Error("Invalid old password");
      error.status = 400; 
      throw error;
    }

    // 3. Hash mật khẩu mới và cập nhật DB
    const newHash = await bcrypt.hash(newPassword, 10);
    await authRepository.updatePassword(userId, newHash);

    // 4. Thu hồi Refresh Token cũ bắt buộc login lại
    await redis.del(`refresh_token:${userId}`);
    
    return { success: true };
  }

  async forgotPassword(email) {
    const user = await authRepository.findUserByEmail(email);
    // Luôn trả về thành công dù user có tồn tại hay không để tránh enumerate email
    if (!user || !user.is_active) {
      return { success: true };
    }

    // Sinh token ngẫu nhiên
    const resetToken = crypto.randomBytes(32).toString("hex");

    // Lưu vào Redis (TTL 15 phút)
    await redis.set(`password_reset:${resetToken}`, user.id, {
      EX: 900
    });

    // Theo yêu cầu của user, in mock ra console thay vì gửi email thật
    console.log(`\n[MOCK EMAIL] Reset Token for user (${email}): ${resetToken}\n`);

    return { success: true };
  }

  async resetPassword(token, newPassword) {
    // 1. Kiểm tra token trong Redis
    const userId = await redis.get(`password_reset:${token}`);
    if (!userId) {
      const error = new Error("Invalid or expired reset token");
      error.status = 400;
      throw error;
    }

    // 2. Hash mật khẩu mới
    const newHash = await bcrypt.hash(newPassword, 10);

    // 3. Cập nhật password
    await authRepository.updatePassword(userId, newHash);

    // 4. Xóa token reset và refresh token để bắt đăng nhập lại
    await redis.del(`password_reset:${token}`);
    await redis.del(`refresh_token:${userId}`);

    return { success: true };
  }

  /**
   * Helper chuyển đổi chuỗi expire sang giây cho Redis
   */
  _parseExpireString(expireString) {
    if (!isNaN(expireString)) return Number(expireString);
    const match = expireString.match(/^(\d+)([dhms])$/);
    if (!match) return 7 * 24 * 60 * 60; 
    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 60 * 60;
      case 'd': return value * 24 * 60 * 60;
      default: return 7 * 24 * 60 * 60;
    }
  }
}

module.exports = new AuthService();
