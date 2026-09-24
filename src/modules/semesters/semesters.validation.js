const { z } = require('zod');

const date = z.iso.datetime({ offset: true });
const fields = {
  code: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(255),
  academic_year: z.string().trim().min(1).max(100),
  start_date: date,
  end_date: date,
};

const createSemester = z.object(fields).strict().refine(
  value => Date.parse(value.start_date) < Date.parse(value.end_date),
  { path: ['end_date'], message: 'end_date must be after start_date' }
);
const updateSemester = z.object(Object.fromEntries(
  Object.entries(fields).map(([key, schema]) => [key, schema.optional()])
)).strict().refine(value => Object.keys(value).length > 0, 'At least one field is required');
const listSemesters = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  is_active: z.enum(['true', 'false']).optional(),
  is_current: z.enum(['true', 'false']).optional(),
}).strict();

module.exports = { createSemester, updateSemester, listSemesters };
