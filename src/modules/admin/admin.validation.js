const { z } = require("zod");

// UC 86 — Create User
const createUserSchema = z.object({
  email: z.string().email("Định dạng email không hợp lệ"),
  username: z.string().min(3, "Username phải có ít nhất 3 ký tự").optional(),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
  role: z.enum(["student", "lecturer", "admin"], {
    errorMap: () => ({ message: "Role không hợp lệ. Chỉ chấp nhận: student, lecturer, admin" }),
  }),
  full_name: z.string().min(1, "Họ và tên là bắt buộc"),
  student_code: z.string().optional(),
  department_id: z.string().uuid("ID khoa không hợp lệ").optional().nullable(),
});

// UC 87 — Update User
const updateUserSchema = z.object({
  email: z.string().email("Định dạng email không hợp lệ").optional(),
  role: z.enum(["student", "lecturer", "admin"], {
    errorMap: () => ({ message: "Role không hợp lệ. Chỉ chấp nhận: student, lecturer, admin" }),
  }).optional(),
  full_name: z.string().min(1, "Họ và tên không được để trống").optional(),
  student_code: z.string().optional().nullable(),
  department_id: z.string().uuid("ID khoa không hợp lệ").optional().nullable(),
});

const broadcastNotificationSchema = z.object({
  title: z.string().min(1, "Tiêu đề không được để trống"),
  message: z.string().min(1, "Nội dung không được để trống"),
  target: z.enum(["all", "student", "lecturer"], {
    errorMap: () => ({ message: "Target không hợp lệ. Chỉ chấp nhận: all, student, lecturer" }),
  }),
});

module.exports = {
  createUserSchema,
  updateUserSchema,
  broadcastNotificationSchema,
};
