const usersRepository = require("./users.repository");
const authService = require("../auth/auth.service");

class UsersService {
  async getMe(userId) {
    return await usersRepository.findUserByIdWithProfile(userId);
  }

  async updateProfile(userId, role, updateData) {
    // Chỉ cho phép lecturer cập nhật department_id
    if (role !== "lecturer" && updateData.department_id !== undefined) {
      delete updateData.department_id;
    }

    // Các trường khác (full_name, avatar_url) đã được validate bởi Zod và validate.middleware, 
    // chặn bất kỳ trường nào lạ.
    await usersRepository.updateUserProfile(userId, updateData);

    // Trả về profile mới
    const updatedUser = await this.getMe(userId);
    return updatedUser;
  }

  async changePassword(userId, oldPassword, newPassword) {
    // Alias sang logic của Auth Service
    return await authService.changePassword(userId, oldPassword, newPassword);
  }
}

module.exports = new UsersService();
