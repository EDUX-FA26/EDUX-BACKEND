const { z } = require('zod');

const STATUSES = ['TODO', 'IN_PROGRESS', 'COMPLETED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
const SOURCES = ['MANUAL', 'AI_SUGGESTED', 'STUDY_PLANNER'];

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng phải là YYYY-MM-DD')
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'Ngày không hợp lệ');

/** "TODO,IN_PROGRESS" → ['TODO','IN_PROGRESS'] */
const csvEnum = (values) =>
  z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1).max(values.length));

const title = z.string().trim().min(1, 'Tiêu đề không được trống').max(200);
const description = z.string().trim().max(2000);

const refs = {
  subjectId: z.uuid(),
  topicId: z.uuid(),
  flashcardDeckId: z.uuid(),
  studyPlanDayId: z.uuid(),
};

const schemas = {
  STATUSES,
  PRIORITIES,
  SOURCES,

  idParams: z.object({ id: z.uuid('id phải là UUID hợp lệ') }),

  createTodo: z
    .object({
      title,
      description: description.optional(),
      priority: z.enum(PRIORITIES).optional(),
      status: z.enum(STATUSES).optional(),
      dueDate: dateStr.nullish(),
      subjectId: refs.subjectId.nullish(),
      topicId: refs.topicId.nullish(),
      flashcardDeckId: refs.flashcardDeckId.nullish(),
      studyPlanDayId: refs.studyPlanDayId.nullish(),
    })
    .strict(),

  updateTodo: z
    .object({
      title: title.optional(),
      description: description.optional(),
      priority: z.enum(PRIORITIES).optional(),
      dueDate: dateStr.nullable().optional(),
      subjectId: refs.subjectId.nullable().optional(),
      topicId: refs.topicId.nullable().optional(),
      flashcardDeckId: refs.flashcardDeckId.nullable().optional(),
      studyPlanDayId: refs.studyPlanDayId.nullable().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Cần ít nhất một trường để cập nhật'),

  changeStatus: z.object({ status: z.enum(STATUSES) }).strict(),

  fromStudyPlan: z.object({ planDayId: z.uuid() }).strict(),

  listQuery: z.object({
    status: csvEnum(STATUSES).optional(),
    priority: csvEnum(PRIORITIES).optional(),
    sourceType: csvEnum(SOURCES).optional(),
    dueDate: dateStr.optional(),
    dueFrom: dateStr.optional(),
    dueTo: dateStr.optional(),
    overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    subjectId: z.uuid().optional(),
    topicId: z.uuid().optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),

  suggestionsQuery: z.object({ subjectId: z.uuid().optional() }),
};

module.exports = schemas;

