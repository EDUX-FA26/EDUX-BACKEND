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

const createDepartmentSchema = z.object({
  code: z.string().trim().min(1, "Mã khoa không được để trống").max(100),
  name: z.string().trim().min(1, "Tên khoa không được để trống").max(255),
  is_active: z.boolean().optional(),
});

const updateDepartmentSchema = z.object({
  code: z.string().trim().min(1, "Mã khoa không được để trống").max(100).optional(),
  name: z.string().trim().min(1, "Tên khoa không được để trống").max(255).optional(),
  is_active: z.boolean().optional(),
});

const createClassSchema = z.object({
  class_code: z.string().trim().min(1, "Mã lớp không được để trống").max(100),
  semester_id: z.string().uuid("ID học kỳ không hợp lệ"),
  subject_id: z.string().uuid("ID môn học không hợp lệ"),
  lecturer_id: z.string().uuid("ID giảng viên không hợp lệ"),
  max_students: z.coerce.number().int().min(1, "Sĩ số tối đa phải lớn hơn 0").max(500).default(30),
  schedule_text: z.string().trim().max(255).optional(),
  start_date: z.string().trim().optional(),
  total_slots: z.coerce.number().int().min(1).max(60).default(20).optional(),
});

const addClassStudentSchema = z.object({
  student_id: z.string().uuid("ID sinh viên không hợp lệ").optional(),
  identifier: z.string().trim().min(1).optional(),
}).refine(data => Boolean(data.student_id || data.identifier), {
  message: "Vui lòng chọn sinh viên hoặc nhập MSSV / Email",
});

module.exports = {
  createUserSchema,
  updateUserSchema,
  broadcastNotificationSchema,
  createDepartmentSchema,
  updateDepartmentSchema,
  createClassSchema,
  addClassStudentSchema,
};
