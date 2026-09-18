const { z } = require("zod");

const registerSchema = z.object({
  email: z.string().email("Định dạng email không hợp lệ"),
  username: z.string().min(3, "Username phải có ít nhất 3 ký tự").optional(),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
  full_name: z.string().min(1, "Họ và tên là bắt buộc"),
  student_code: z.string().min(1, "Mã số sinh viên là bắt buộc"),
  // Chỉ cho phép truyền 'student' hoặc không truyền (mặc định là student)
  role: z.literal("student").optional().default("student"),
});

const loginSchema = z.object({
  identifier: z.string().min(1, "Vui lòng nhập Email hoặc Username"),
  password: z.string().min(1, "Vui lòng nhập mật khẩu"),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

const changePasswordSchema = z.object({
  old_password: z.string().min(1, "Old password is required"),
  new_password: z.string().min(6, "New password must be at least 6 characters"),
});

module.exports = {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
};
