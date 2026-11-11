const { z } = require('zod');
const { BACKGROUND_IDS, SOUND_IDS } = require('./focus.constants');

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng phải là YYYY-MM-DD')
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'Ngày không hợp lệ');

const int = (min, max) => z.number().int().min(min).max(max);

const pomodoroConfig = {
  focusMinutes: int(1, 180).optional(),
  shortBreakMinutes: int(1, 60).optional(),
  longBreakMinutes: int(1, 120).optional(),
  longBreakEvery: int(2, 12).optional(),
};

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const sessionStatus = z.enum(['IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED']);
const timerModeEnum = z.enum(['pomodoro', 'stopwatch']);

const schemas = {
  idParams: z.object({ id: z.string().uuid('id phải là UUID hợp lệ') }),

  startSession: z
    .object({
      timerMode: timerModeEnum.default('pomodoro').optional(),
      todoId: z.string().uuid('todoId phải là UUID hợp lệ').nullish(),
      note: z.string().trim().max(1000).optional(),
      ...pomodoroConfig,
    })
    .strict(),

  adjustSession: z
    .object({
      deltaMinutes: z.number().int().min(-60).max(60),
    })
    .strict(),

  patchSession: z
    .object({
      todoId: z.string().uuid('todoId phải là UUID hợp lệ').nullable().optional(),
      note: z.string().trim().max(1000).optional(),
      status: z.literal('CANCELLED').optional(),
      resetPhase: z.literal(true).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Cần ít nhất một trường để cập nhật'),

  finishSession: z
    .object({ note: z.string().trim().max(1000).optional() })
    .strict(),

  emptyBody: z.object({}).strict(),

  listSessionsQuery: z.object({
    status: sessionStatus.optional(),
    todoId: z.string().uuid().optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
    page,
    limit,
  }),

  historyQuery: z.object({
    todoId: z.string().uuid().optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
    page,
    limit,
  }),

  summaryQuery: z.object({
    from: dateStr.optional(),
    to: dateStr.optional(),
  }),
  dailyQuery: z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }),
  weeklyQuery: z.object({ weeks: z.coerce.number().int().min(1).max(26).default(8) }),

  // ── Thống kê chuyên sâu (Statistics Dashboard) ────────
  overviewQuery: z.object({
    timeframe: z.enum(['today', 'last_7_days', 'last_30_days', 'this_semester', 'all_time']).default('last_7_days'),
    from: dateStr.optional(),
    to: dateStr.optional(),
  }),
  statsDailyQuery: z.object({
    timeframe: z.enum(['today', 'last_7_days', 'last_30_days', 'this_semester', 'all_time']).default('last_7_days'),
    days: z.coerce.number().int().min(1).max(90).optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
  }),
  statsHeatmapQuery: z.object({
    days: z.coerce.number().int().min(30).max(365).default(120),
  }),
  statsDistributionQuery: z.object({
    timeframe: z.enum(['today', 'last_7_days', 'last_30_days', 'this_semester', 'all_time']).default('last_7_days'),
  }),
  statsTodosQuery: z.object({
    timeframe: z.enum(['today', 'last_7_days', 'last_30_days', 'this_semester', 'all_time']).default('last_7_days'),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }),
  statsInsightsQuery: z.object({
    timeframe: z.enum(['today', 'last_7_days', 'last_30_days', 'this_semester', 'all_time']).default('last_7_days'),
  }),

  putPreferences: z
    .object({
      backgroundId: z.enum(BACKGROUND_IDS).optional(),
      masterVolume: z.number().min(0).max(1).optional(),
      sounds: z
        .array(
          z
            .object({
              id: z.enum(SOUND_IDS),
              enabled: z.boolean(),
              volume: z.number().min(0).max(1),
            })
            .strict()
        )
        .max(SOUND_IDS.length)
        .refine((arr) => new Set(arr.map((s) => s.id)).size === arr.length, 'Âm thanh bị trùng')
        .optional(),
      autoStartNext: z.boolean().optional(),
      ...pomodoroConfig,
    })
    .strict(),
};

module.exports = schemas;
