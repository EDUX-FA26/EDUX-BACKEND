const authService = require("./auth.service");
const authRepository = require("./auth.repository");

class AuthController {
  async register(req, res, next) {
    try {
      const user = await authService.register(req.body);
      res.status(201).json({
        success: true,
        message: "User registered successfully",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  async login(req, res, next) {
    try {
      const { identifier, password } = req.body;
      const result = await authService.login(identifier, password);
      res.status(200).json({
        success: true,
        message: "Logged in successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: "Refresh token is required",
        });
      }
      
      const result = await authService.refreshToken(refreshToken);
      res.status(200).json({
        success: true,
        message: "Token refreshed successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(req, res, next) {
    try {
      const userId = req.user.id;
      await authService.logout(userId);
      res.status(200).json({
        success: true,
        message: "Logged out successfully",
        data: null,
      });
    } catch (error) {
      next(error);
    }
  }

  async getMe(req, res, next) {
    try {
      const userId = req.user.id;
      const user = await authRepository.findUserByIdWithProfile(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
      
      // Xoá password_hash nếu vô tình bị rò rỉ (mặc định truy vấn đã không chọn password_hash, nhưng clear cho chắc)
      delete user.password_hash;

      res.status(200).json({
        success: true,
        message: "User profile fetched successfully",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  async changePassword(req, res, next) {
    try {
      const userId = req.user.id;
      const { old_password, new_password } = req.body;
      
      if (!old_password || !new_password) {
        return res.status(400).json({
          success: false,
          message: "Both old_password and new_password are required",
        });
      }

      await authService.changePassword(userId, old_password, new_password);
      res.status(200).json({
        success: true,
        message: "Password changed successfully",
        data: null,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();