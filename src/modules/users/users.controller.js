
const usersService = require("./users.service");

class UsersController {
  // =========================================
  // GET /api/users/me
  // =========================================

  async getMe(req, res, next) {
    try {
      const {
        userId,
        schoolId,
      } = req.tenant;

      const user = await usersService.getMe({
        userId,
        schoolId,
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User profile not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "User profile fetched successfully",
        data: user,
      });

    } catch (error) {
      next(error);
    }
  }

  // =========================================
  // PATCH /api/users/me
  // =========================================

  async updateProfile(req, res, next) {
    try {
      const {
        userId,
        schoolId,
        role,
      } = req.tenant;

      const updatedUser =
        await usersService.updateProfile({
          userId,
          schoolId,
          role,
          updateData: req.body,
        });

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: "User profile not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "User profile updated successfully",
        data: updatedUser,
      });

    } catch (error) {
      next(error);
    }
  }

  // =========================================
  // PATCH /api/users/me/password
  // =========================================

  async changePassword(req, res, next) {
    try {
      const userId = req.user.id;

      const {
        old_password,
        new_password,
      } = req.body;

      await usersService.changePassword(
        userId,
        old_password,
        new_password
      );

      return res.status(200).json({
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
