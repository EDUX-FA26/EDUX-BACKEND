const { z } = require('zod');

// Query và params validation cho route
const studyPlanAiQuerySchema = z.object({
  planId: z.string().uuid('planId phải là UUID hợp lệ'),
}).strict();

const studyPlanDayAiParamsSchema = z.object({
  planDayId: z.string().uuid('planDayId phải là UUID hợp lệ'),
}).strict();

// Schema cho output từ model Gemini (7-day insights)
const geminiPlanOutputSchema = z.object({
  summary: z.string().min(1).max(320),
  days: z.array(
    z.object({
      day: z.number().int().min(1).max(7),
      why: z.string().min(1).max(240),
      steps: z.array(z.string().min(1).max(120)).min(2).max(4),
    }).strict()
  ).length(7),
}).strict();

// Schema cho output từ model Gemini (post-submission feedback)
const geminiDayFeedbackOutputSchema = z.object({
  whatWentWell: z.string().min(1).max(220),
  nextSteps: z.array(z.string().min(1).max(140)).min(2).max(3),
}).strict();

module.exports = {
  studyPlanAiQuerySchema,
  studyPlanDayAiParamsSchema,
  geminiPlanOutputSchema,
  geminiDayFeedbackOutputSchema,
};
