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

  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      await authService.forgotPassword(email);
      res.status(200).json({
        success: true,
        message: "If your email is registered, you will receive reset instructions",
      });
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req, res, next) {
    try {
      const { token, new_password } = req.body;
      await authService.resetPassword(token, new_password);
      res.status(200).json({
        success: true,
        message: "Password has been reset successfully",
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