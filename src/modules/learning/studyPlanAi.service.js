/**
 * studyPlanAi.service.js
 * Service lớp AI Personalization (Read-only Learning Coach) cho Phase 5C.
 * Tuyệt đối không ghi/sửa database, hoàn toàn read-only và có cache + fallback.
 */

const crypto = require('crypto');
const { pool } = require('../../config/db.config');
const { redis } = require('../../config/redis.config');
const LearningRepository = require('./learning.repository');
const StudyPlanAiProvider = require('./studyPlanAi.provider');
const {
  sanitizeText,
  buildRuleBasedPlanInsights,
  buildRuleBasedDayFeedback,
} = require('./studyPlanAi.prompt');

function makeError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.code = message;
  return error;
}

// In-memory cache fallback khi Redis không khả dụng
const memoryCache = new Map();
const inFlightRequests = new Map();

const DEFAULT_CACHE_TTL_SEC = Number(process.env.STUDY_PLAN_AI_CACHE_TTL_SEC) || 21600; // 6 hours

async function getCached(key) {
  try {
    if (redis && redis.isOpen) {
      const data = await redis.get(key);
      if (data) return JSON.parse(data);
    }
  } catch (_) {}

  const mem = memoryCache.get(key);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.data;
  }
  return null;
}

async function setCached(key, data, ttlSeconds = DEFAULT_CACHE_TTL_SEC) {
  try {
    if (redis && redis.isOpen) {
      await redis.setEx(key, ttlSeconds, JSON.stringify(data));
      return;
    }
  } catch (_) {}

  memoryCache.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

const StudyPlanAiService = {
  buildCacheKey(schoolId, studentId, planId, fingerprint, locale = 'vi-VN') {
    return `studyplan_ai:v1:${schoolId}:${studentId}:${planId}:${locale}:${fingerprint}`;
  },

  buildPlanFingerprint(plan, days) {
    const planId = plan.id || plan.planId || '';
    const planStatus = plan.status || '';
    const subjectId = plan.subject_id || plan.subjectId || '';
    const overviewSnap = JSON.stringify(plan.analyticsSnapshot?.overview || {});
    const daysFingerprintData = days
      .map(d => [
        d.day || d.day_number,
        d.topicId || d.topic_id,
        d.topicName || d.topic_name,
        d.activity,
        d.masteryStatus || d.mastery_status || '',
        d.masteryEstimate ?? d.mastery_estimate ?? '',
        Boolean(d.submitted || d.completed || d.isCompleted),
        d.scorePercent ?? d.score_percent ?? '',
        d.contentStatus || d.content_status || ''
      ].join(':'))
      .join('|');
    return crypto
      .createHash('sha256')
      .update(`${planId}:${planStatus}:${subjectId}:${overviewSnap}:${daysFingerprintData}`)
      .digest('hex')
      .slice(0, 16);
  },

  buildFeedbackFingerprint(day, submission) {
    const dayId = day.planDayId || day.id || '';
    const topicId = day.topicId || day.topic_id || '';
    const activity = day.activity || '';
    const scorePercent = submission.scorePercent ?? submission.score_percent ?? 0;
    const correctAnswers = submission.correctAnswers ?? submission.correct_answers ?? 0;
    const totalQuestions = submission.totalQuestions ?? submission.total_questions ?? 0;
    const submittedAt = submission.submittedAt ?? submission.submitted_at ?? '';
    return crypto
      .createHash('sha256')
      .update(`${dayId}:${topicId}:${activity}:${scorePercent}:${correctAnswers}:${totalQuestions}:${submittedAt}`)
      .digest('hex')
      .slice(0, 16);
  },

  clearCacheForTesting() {
    memoryCache.clear();
    inFlightRequests.clear();
  },

  /**
   * 5C.1: Lấy giải thích và hướng dẫn 7 ngày cho một Kế hoạch học tập
   */
  async getPlanAiInsights(planId, studentId, schoolId, options = {}) {
    const { forceRefresh = false } = options;
    if (!planId || !studentId || !schoolId) {
      throw makeError('INVALID_REQUEST_PARAMETERS', 400);
    }

    // 1. Kiểm tra quyền sở hữu plan và thuộc đúng school
    const planResult = await pool.query(
      `SELECT
         sp.id AS "planId",
         sp.subject_id AS "subjectId",
         s.name AS "subjectName",
         sp.starts_on AS "startsOn",
         sp.status,
         sp.analytics_snapshot AS "analyticsSnapshot"
       FROM study_plans sp
       JOIN subjects s ON s.id = sp.subject_id
       WHERE sp.id = $1
         AND sp.student_id = $2
         AND s.school_id = $3`,
      [planId, studentId, schoolId]
    );

    const plan = planResult.rows[0];
    if (!plan) {
      throw makeError('PLAN_NOT_FOUND', 404);
    }

    // 2. Kiểm tra sinh viên có đang tham gia môn học hay không
    const hasAccess = await LearningRepository.isStudentActiveInSubject(
      studentId,
      plan.subjectId,
      schoolId
    );
    if (!hasAccess) {
      throw makeError('SUBJECT_ACCESS_FORBIDDEN', 403);
    }

    // 3. Lấy 7 ngày học từ DB
    const daysResult = await pool.query(
      `SELECT
         spd.id AS "planDayId",
         spd.day_number AS "day",
         spd.topic_id AS "topicId",
         t.name AS "topicName",
         t.code AS "topicCode",
         spd.activity,
         spd.duration_minutes AS "durationMinutes",
         spd.target_questions AS "targetQuestions",
         spd.reason,
         spd.content_status AS "contentStatus",
         (
           SELECT COUNT(1)
           FROM study_plan_day_submissions sub
           WHERE sub.plan_day_id = spd.id
             AND sub.student_id = $2
         ) > 0 AS "submitted"
       FROM study_plan_days spd
       JOIN topics t ON t.id = spd.topic_id
       WHERE spd.plan_id = $1
       ORDER BY spd.day_number ASC`,
      [planId, studentId]
    );

    const days = daysResult.rows;
    if (days.length !== 7) {
      throw makeError('PLAN_NOT_READY', 400);
    }

    // 4. Tạo fingerprint để cache an toàn theo dữ liệu
    const fingerprint = this.buildPlanFingerprint(plan, days);
    const cacheKey = this.buildCacheKey(schoolId, studentId, planId, fingerprint);

    // Kiểm tra cache (Bảo đảm khi tắt Gemini không được trả cache Gemini cũ)
    const isAiActive = StudyPlanAiProvider.isAiEnabled();
    if (!forceRefresh) {
      const cached = await getCached(cacheKey);
      if (cached) {
        if (!isAiActive && cached.source === 'gemini') {
          // Bỏ qua cache Gemini cũ nếu feature flag hiện đang tắt
        } else {
          return cached;
        }
      }
    }

    // Single-flight deduplication để tránh spam concurrent
    if (inFlightRequests.has(cacheKey)) {
      return await inFlightRequests.get(cacheKey);
    }

    const flightPromise = (async () => {
      try {
        // 5. Chuẩn hóa ngữ cảnh tối thiểu (Data minimization)
        const sanitizedContext = {
          schemaVersion: '5c-1',
          locale: 'vi-VN',
          subjectName: sanitizeText(plan.subjectName, 80),
          studyPlan: {
            durationDays: 7,
            days: days.map(d => ({
              day: d.day,
              activity: d.activity,
              topicCode: sanitizeText(d.topicCode || '', 50),
              topicName: sanitizeText(d.topicName || '', 80),
              masteryStatus: d.activity === 'practice' ? 'developing' : (d.activity === 'diagnostic' ? 'not_assessed' : 'mastered'),
              durationMinutes: Number(d.durationMinutes) || 15,
              targetQuestions: Number(d.targetQuestions) || 5,
              reason: sanitizeText(d.reason || '', 120),
              submitted: Boolean(d.submitted),
              contentStatus: d.contentStatus,
            })),
          },
          analyticsOverview: {
            evaluatedTopics: Number(plan.analyticsSnapshot?.overview?.evaluatedTopics) || 0,
            unassessedTopics: Number(plan.analyticsSnapshot?.overview?.unassessedTopics) || 0,
            unclassifiedEvents: Number(plan.analyticsSnapshot?.overview?.unclassifiedEvents) || 0,
          },
        };

        // 6. Gọi AI Provider hoặc fallback
        let insights = await StudyPlanAiProvider.generatePlanInsights(sanitizedContext);
        let source = 'gemini';

        if (!insights) {
          insights = buildRuleBasedPlanInsights(plan, days, plan.subjectName);
          source = 'rule_based';
        }

        // 7. Gắn ID và cấu trúc kết quả từ dữ liệu xác minh DB (Model không được tự sinh ID)
        // Áp dụng sanitizeText lên toàn bộ output từ LLM để ngăn chặn prompt leakage & injection
        const result = {
          planId: plan.planId,
          source,
          schemaVersion: '5c-1',
          generatedAt: new Date().toISOString(),
          summary: sanitizeText(insights.summary, 320) || 'Kế hoạch học tập tuần này được phân bổ nhằm củng cố kiến thức.',
          dayInsights: days.map(d => {
            const match = Array.isArray(insights.days)
              ? insights.days.find(id => id.day === d.day)
              : null;
            const rawWhy = match?.why || d.reason;
            const rawSteps = Array.isArray(match?.steps) && match.steps.length >= 2
              ? match.steps
              : ['Đọc lại tài liệu trọng tâm', 'Làm bài tập đầy đủ'];
            return {
              planDayId: d.planDayId,
              day: d.day,
              why: sanitizeText(rawWhy, 240),
              steps: rawSteps.map(s => sanitizeText(s, 120)).slice(0, 4),
            };
          }),
        };

        await setCached(cacheKey, result);
        return result;
      } finally {
        inFlightRequests.delete(cacheKey);
      }
    })();

    inFlightRequests.set(cacheKey, flightPromise);
    return await flightPromise;
  },

  /**
   * 5C.3: Lấy phản hồi AI sau khi sinh viên đã nộp bài một ngày học
   */
  async getDayAiFeedback(planDayId, studentId, schoolId, options = {}) {
    const { forceRefresh = false } = options;
    if (!planDayId || !studentId || !schoolId) {
      throw makeError('INVALID_REQUEST_PARAMETERS', 400);
    }

    // 1. Kiểm tra ngày học thuộc sinh viên và trường
    const dayResult = await pool.query(
      `SELECT
         spd.id AS "planDayId",
         spd.day_number AS "day",
         spd.topic_id AS "topicId",
         t.name AS "topicName",
         t.code AS "topicCode",
         spd.activity,
         spd.target_questions AS "targetQuestions",
         spd.content_status AS "contentStatus",
         sp.id AS "planId",
         sp.subject_id AS "subjectId",
         s.name AS "subjectName"
       FROM study_plan_days spd
       JOIN study_plans sp ON sp.id = spd.plan_id
       JOIN subjects s ON s.id = sp.subject_id
       JOIN topics t ON t.id = spd.topic_id
       WHERE spd.id = $1
         AND sp.student_id = $2
         AND s.school_id = $3`,
      [planDayId, studentId, schoolId]
    );

    const day = dayResult.rows[0];
    if (!day) {
      throw makeError('PLAN_DAY_NOT_FOUND', 404);
    }

    // 2. Kiểm tra quyền môn học
    const hasAccess = await LearningRepository.isStudentActiveInSubject(
      studentId,
      day.subjectId,
      schoolId
    );
    if (!hasAccess) {
      throw makeError('SUBJECT_ACCESS_FORBIDDEN', 403);
    }

    // 3. Kiểm tra bài nộp thực tế (bắt buộc phải có submission)
    const subResult = await pool.query(
      `SELECT
         id,
         score_percent AS "scorePercent",
         correct_answers AS "correctAnswers",
         total_questions AS "totalQuestions",
         submitted_at AS "submittedAt"
       FROM study_plan_day_submissions
       WHERE plan_day_id = $1
         AND student_id = $2`,
      [planDayId, studentId]
    );

    const submission = subResult.rows[0];
    if (!submission) {
      // Chưa nộp bài -> từ chối, không gọi AI
      throw makeError('FEEDBACK_NOT_AVAILABLE', 409);
    }

    // 4. Lấy bằng chứng theo câu hỏi (Question-level Grounding) nếu có
    let questionBreakdown = [];
    try {
      const answersResult = await pool.query(
        `SELECT
           q.question_order AS "questionOrder",
           a.is_correct AS "isCorrect"
         FROM study_plan_day_answers a
         JOIN study_plan_questions q ON q.id = a.question_id
         WHERE a.submission_id = $1
         ORDER BY q.question_order ASC`,
        [submission.id]
      );
      questionBreakdown = answersResult.rows.map(r => ({
        questionOrder: Number(r.questionOrder),
        isCorrect: Boolean(r.isCorrect),
      }));
    } catch (_) {
      questionBreakdown = [];
    }

    // 5. Cache key dựa trên submission fingerprint toàn diện
    const fingerprint = this.buildFeedbackFingerprint(day, submission);
    const cacheKey = `studyplan_ai_fb:v1:${schoolId}:${studentId}:${planDayId}:${fingerprint}`;

    const isAiActive = StudyPlanAiProvider.isAiEnabled();
    if (!forceRefresh) {
      const cached = await getCached(cacheKey);
      if (cached) {
        if (!isAiActive && cached.source === 'gemini') {
          // Bỏ qua cache Gemini cũ nếu feature flag hiện đang tắt
        } else {
          return cached;
        }
      }
    }

    // 6. Chuẩn bị context tối thiểu đã xác minh kèm bằng chứng Grounding
    const sanitizedFeedbackContext = {
      topicName: sanitizeText(day.topicName, 80),
      activity: day.activity,
      scorePercent: Number(submission.scorePercent),
      correctAnswers: Number(submission.correctAnswers),
      totalQuestions: Number(submission.totalQuestions),
      hasQuestionBreakdown: questionBreakdown.length > 0,
      questionBreakdown,
    };

    // 7. Gọi AI Provider hoặc fallback
    let feedback = await StudyPlanAiProvider.generateDayFeedback(sanitizedFeedbackContext);
    let source = 'gemini';

    if (!feedback) {
      feedback = buildRuleBasedDayFeedback(day, submission);
      source = 'rule_based';
    }

    // 8. Sanitize output từ LLM để đảm bảo tính an toàn và chống injection
    const rawNextSteps = Array.isArray(feedback.nextSteps) && feedback.nextSteps.length >= 2
      ? feedback.nextSteps
      : ['Xem lại lời giải chi tiết cho các câu chưa đúng', 'Ôn tập thêm các flashcard liên quan đến chủ đề này'];

    const result = {
      planDayId,
      source,
      generatedAt: new Date().toISOString(),
      scoreSummary: {
        scorePercent: Number(submission.scorePercent),
        correctAnswers: Number(submission.correctAnswers),
        totalQuestions: Number(submission.totalQuestions),
        submittedAt: submission.submittedAt,
      },
      whatWentWell: sanitizeText(feedback.whatWentWell, 220),
      nextSteps: rawNextSteps.map(s => sanitizeText(s, 140)).slice(0, 3),
    };

    await setCached(cacheKey, result);
    return result;
  },
};

module.exports = StudyPlanAiService;
