const usersService = require("./users.service");

class UsersController {
  async getMe(req, res, next) {
    try {
      const userId = req.user.id;
      const user = await usersService.getMe(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
      
      // Xoá password_hash nếu vô tình bị rò rỉ
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

  async updateProfile(req, res, next) {
    try {
      const userId = req.user.id;
      const role = req.user.role;
      const updateData = req.body;
      
      const updatedUser = await usersService.updateProfile(userId, role, updateData);
      
      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      delete updatedUser.password_hash;

      res.status(200).json({
        success: true,
        message: "User profile updated successfully",
        data: updatedUser,
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

      await usersService.changePassword(userId, old_password, new_password);
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

module.exports = new UsersController();
