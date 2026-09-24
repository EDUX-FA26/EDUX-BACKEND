const { z } = require('zod');

const fields = {
  code: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(255),
  description: z.string().max(10000),
  department_id: z.uuid().nullable(),
  credits: z.number().int().min(0),
};

const createSubject = z.object({
  code: fields.code,
  name: fields.name,
  description: fields.description.optional(),
  department_id: fields.department_id.optional(),
  credits: fields.credits.optional(),
}).strict();
const updateSubject = z.object(Object.fromEntries(
  Object.entries(fields).map(([key, schema]) => [key, schema.optional()])
)).strict().refine(value => Object.keys(value).length > 0, 'At least one field is required');
const listSubjects = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  department_id: z.uuid().optional(),
  include_inactive: z.enum(['true', 'false']).default('false'),
}).strict();

module.exports = { createSubject, updateSubject, listSubjects };
