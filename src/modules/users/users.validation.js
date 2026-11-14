
const { z } = require("zod");

const updateProfileSchema = z
  .object({
    full_name: z
      .string()
      .trim()
      .min(1, "Họ và tên không được để trống")
      .optional(),

    avatar_url: z
      .union([
        z.string().url(
          "Định dạng URL avatar không hợp lệ"
        ),
        z.literal(""),
      ])
      .optional(),

    department_id: z
      .string()
      .uuid("Department ID không hợp lệ")
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message: "No profile fields provided",
    }
  );

module.exports = {
  updateProfileSchema,
};
