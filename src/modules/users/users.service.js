
const usersRepository = require("./users.repository");

const authService = require("../auth/auth.service");

class UsersService {
  // =========================================
  // GET MY SCHOOL PROFILE
  // =========================================

  async getMe({
    userId,
    schoolId,
  }) {
    return usersRepository.findUserByIdWithProfile({
      userId,
      schoolId,
    });
  }

  // =========================================
  // UPDATE MY PROFILE
  // =========================================

  async updateProfile({
    userId,
    schoolId,
    role,
    updateData,
  }) {
    const data = { ...updateData };

    // Preserve the existing EDUX rule:
    // Only lecturers may self-update department.
    //
    // This is checked again against the current
    // DB membership inside the repository transaction.

    if (
      data.department_id !== undefined &&
      role !== "lecturer"
    ) {
      const error = new Error(
        "Only lecturers can update their department"
      );

      error.status = 403;
      throw error;
    }

    await usersRepository.updateUserProfile({
      userId,
      schoolId,
      updateData: data,
    });

    return this.getMe({
      userId,
      schoolId,
    });
  }

  // =========================================
  // GLOBAL PASSWORD CHANGE
  // =========================================

  async changePassword(
    userId,
    oldPassword,
    newPassword
  ) {
    return authService.changePassword(
      userId,
      oldPassword,
      newPassword
    );
  }
}

module.exports = new UsersService();
