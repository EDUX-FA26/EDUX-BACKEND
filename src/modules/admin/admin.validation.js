const { z } = require("zod");


const optionalCode = z
  .union([
    z.string().trim().min(1).max(100),
    z.literal(""),
  ])
  .nullable()
  .optional()
  .transform((value) =>
    value === "" ? null : value
  );

const createUserSchema = z.object({
  email: z.string().trim().email(),

  username: z
    .union([
      z.string().trim().min(3),
      z.literal(""),
    ])
    .optional(),

  // Required for new accounts only.
  // Existing accounts keep their old password.
  password: z.string().min(6).optional(),

  role: z.enum([
    "student",
    "lecturer",
    "admin",
    "school_admin",
  ]),

  full_name: z.string().trim().min(1),

  student_code: optionalCode,

  staff_code: optionalCode,

  department_id: z
    .string()
    .uuid()
    .nullable()
    .optional(),
}).strict();

const updateUserSchema = z.object({
  // Global fields accepted only if unchanged.
  email: z.string().trim().email().optional(),

  full_name: z
    .string()
    .trim()
    .min(1)
    .optional(),

  role: z.enum([
    "student",
    "lecturer",
    "admin",
    "school_admin",
  ]).optional(),

  student_code: optionalCode,

  staff_code: optionalCode,

  department_id: z
    .string()
    .uuid()
    .nullable()
    .optional(),
}).strict().refine(
  (data) => Object.keys(data).length > 0,
  { message: "Không có thông tin cần cập nhật" }
);

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

const updateClassSlotsSchema = z.object({
  schedule_text: z.string().trim().min(1).max(255).optional(),
  start_date: z.string().trim().min(1).optional(),
  total_slots: z.coerce.number().int().min(1).max(60).optional(),
  slots: z.array(z.object({
    slot_number: z.coerce.number().int().min(1).max(60),
    date: z.union([z.string().trim().min(1), z.coerce.date()]).optional(),
    time: z.string().trim().min(1).max(100).optional(),
    title: z.string().trim().max(255).optional(),
    content: z.string().max(5000).optional(),
    note: z.string().max(5000).optional(),
  }).strict()).max(60).optional(),
}).strict().refine(
  (data) => Object.keys(data).length > 0,
  { message: "Không có dữ liệu lịch học cần cập nhật" }
);


const updateClassSchema = z.object({
  class_code: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional(),

  semester_id: z.string().uuid().optional(),
  subject_id: z.string().uuid().optional(),
  lecturer_id: z.string().uuid().optional(),

  max_students: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .optional(),

  schedule_text: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional(),

  is_active: z.boolean().optional(),
})
.strict()
.refine(
  data => Object.keys(data).length > 0,
  { message: "Không có dữ liệu cần cập nhật" }
);

module.exports = {
  createUserSchema,
  updateUserSchema,
  broadcastNotificationSchema,
  createDepartmentSchema,
  updateDepartmentSchema,
  createClassSchema,
  updateClassSchema,
  addClassStudentSchema,
  updateClassSlotsSchema,
};
