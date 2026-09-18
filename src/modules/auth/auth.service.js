const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
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

    // 4. Cập nhật last_login_at (bất đồng bộ)
    authRepository.updateLastLogin(user.id).catch((err) => {
      console.error("Failed to update last login:", err);
    });

    // 5. Sinh token
    const payload = { userId: user.id, role: user.role };
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });

    // 6. Lưu Refresh Token vào Redis
    const ttlSeconds = this._parseExpireString(JWT_REFRESH_EXPIRES_IN);
    await redis.set(`refresh_token:${user.id}`, refreshToken, {
      EX: ttlSeconds,
    });

    // Trả về dữ liệu không có password_hash
    const { password_hash, ...userInfo } = user;
    return {
      accessToken,
      refreshToken,
      user: userInfo,
    };
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