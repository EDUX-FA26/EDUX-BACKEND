const { z } = require("zod");

const updateProfileSchema = z.object({
  full_name: z.string().min(1, "Họ và tên không được để trống").optional(),
  avatar_url: z.string().url("Định dạng URL avatar không hợp lệ").optional().or(z.literal("")),
  department_id: z.string().uuid("Department ID không hợp lệ").optional(),
});

module.exports = {
  updateProfileSchema,
};
