/**
 * studyPlanAi.provider.js
 * Adapter tương tác với Google Gemini cho Phase 5C với strict timeout, feature flag và schema validation.
 */
const { GoogleGenAI } = require('@google/genai');
const { normalizeGeminiModel } = require('../../config/gemini.config');
const {
  geminiPlanOutputSchema,
  geminiDayFeedbackOutputSchema,
} = require('./studyPlanAi.schema');
const {
  buildPlanInsightsPrompt,
  buildDayFeedbackPrompt,
} = require('./studyPlanAi.prompt');

let geminiClientInstance = null;

function getClient(apiKey) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!geminiClientInstance) {
    geminiClientInstance = new GoogleGenAI({ apiKey: key });
  }
  return geminiClientInstance;
}

function parseJsonCleanly(rawText) {
  if (typeof rawText !== 'string') return null;
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    return null;
  }
}

const CIRCUIT_BREAKER = {
  state: 'CLOSED', // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  consecutiveFailures: 0,
  lastFailureTime: 0,
  FAILURE_THRESHOLD: 3,
  COOLDOWN_MS: Number(process.env.STUDY_PLAN_AI_COOLDOWN_MS) || 60000, // 60 seconds
};

function canAttemptAiCall() {
  if (CIRCUIT_BREAKER.state === 'OPEN') {
    const elapsed = Date.now() - CIRCUIT_BREAKER.lastFailureTime;
    if (elapsed > CIRCUIT_BREAKER.COOLDOWN_MS) {
      CIRCUIT_BREAKER.state = 'HALF_OPEN';
      return true;
    }
    return false;
  }
  return true;
}

function recordAiSuccess() {
  CIRCUIT_BREAKER.state = 'CLOSED';
  CIRCUIT_BREAKER.consecutiveFailures = 0;
}

function recordAiFailure(err) {
  CIRCUIT_BREAKER.consecutiveFailures++;
  CIRCUIT_BREAKER.lastFailureTime = Date.now();
  if (CIRCUIT_BREAKER.consecutiveFailures >= CIRCUIT_BREAKER.FAILURE_THRESHOLD) {
    CIRCUIT_BREAKER.state = 'OPEN';
    console.warn(`[StudyPlanAiProvider] Circuit breaker TRIPPED to OPEN (${CIRCUIT_BREAKER.consecutiveFailures} failures). Fast-failing to rule-based for ${CIRCUIT_BREAKER.COOLDOWN_MS}ms.`);
  }
}

function sanitizeLogMessage(msg) {
  if (typeof msg !== 'string') return '';
  return msg.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_KEY]');
}

async function callWithTimeout(promiseFn, timeoutMs) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('AI_TIMEOUT');
      err.code = 'ETIMEDOUT';
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promiseFn(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

const StudyPlanAiProvider = {
  isAiEnabled() {
    return process.env.STUDY_PLAN_AI_ENABLED === 'true' && Boolean(process.env.GEMINI_API_KEY);
  },

  getModelName() {
    const raw = process.env.STUDY_PLAN_AI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    return normalizeGeminiModel(raw.trim(), 'gemini-2.5-flash');
  },

  getTimeoutMs() {
    return Number(process.env.STUDY_PLAN_AI_TIMEOUT_MS) || 4000;
  },

  getCircuitBreakerStatus() {
    return {
      state: CIRCUIT_BREAKER.state,
      consecutiveFailures: CIRCUIT_BREAKER.consecutiveFailures,
    };
  },

  resetCircuitBreakerForTesting() {
    CIRCUIT_BREAKER.state = 'CLOSED';
    CIRCUIT_BREAKER.consecutiveFailures = 0;
    CIRCUIT_BREAKER.lastFailureTime = 0;
  },

  async generatePlanInsights(sanitizedContext) {
    if (!this.isAiEnabled()) {
      return null;
    }

    if (!canAttemptAiCall()) {
      console.warn('[StudyPlanAiProvider] Circuit breaker is OPEN. Skipping Gemini network call and falling back directly to rule-based.');
      return null;
    }

    const ai = getClient();
    if (!ai) return null;

    const prompt = buildPlanInsightsPrompt(sanitizedContext);
    const baseModel = this.getModelName();
    const candidateModels = Array.from(new Set([
      baseModel,
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
    ]));
    const timeoutMs = this.getTimeoutMs();
    let lastErr = null;

    for (const model of candidateModels) {
      try {
        const response = await callWithTimeout(
          () => ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          }),
          timeoutMs
        );

        const parsed = parseJsonCleanly(response?.text);
        if (!parsed) {
          console.warn(`[StudyPlanAiProvider] Failed to parse JSON response from Gemini model ${model}`);
          continue;
        }

        const validated = geminiPlanOutputSchema.safeParse(parsed);
        if (!validated.success) {
          console.warn(`[StudyPlanAiProvider] Gemini output (${model}) failed Zod schema validation:`, validated.error.issues);
          continue;
        }

        recordAiSuccess();
        return validated.data;
      } catch (err) {
        lastErr = err;
        console.warn(`[StudyPlanAiProvider] Gemini model ${model} call failed (${sanitizeLogMessage(err.message)}), trying next candidate...`);
      }
    }

    if (lastErr) {
      recordAiFailure(lastErr);
      console.warn(`[StudyPlanAiProvider] All Gemini candidates failed (${sanitizeLogMessage(lastErr.message)}), falling back to rule-based`);
    }
    return null;
  },

  async generateDayFeedback(sanitizedFeedbackContext) {
    if (!this.isAiEnabled()) {
      return null;
    }

    if (!canAttemptAiCall()) {
      console.warn('[StudyPlanAiProvider] Circuit breaker is OPEN for day feedback. Fast-falling back directly to rule-based.');
      return null;
    }

    const ai = getClient();
    if (!ai) return null;

    const prompt = buildDayFeedbackPrompt(sanitizedFeedbackContext);
    const baseModel = this.getModelName();
    const candidateModels = Array.from(new Set([
      baseModel,
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
    ]));
    const timeoutMs = this.getTimeoutMs();
    let lastErr = null;

    for (const model of candidateModels) {
      try {
        const response = await callWithTimeout(
          () => ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          }),
          timeoutMs
        );

        const parsed = parseJsonCleanly(response?.text);
        if (!parsed) {
          console.warn(`[StudyPlanAiProvider] Failed to parse day feedback JSON from Gemini model ${model}`);
          continue;
        }

        const validated = geminiDayFeedbackOutputSchema.safeParse(parsed);
        if (!validated.success) {
          console.warn(`[StudyPlanAiProvider] Day feedback output (${model}) failed Zod schema validation:`, validated.error.issues);
          continue;
        }

        recordAiSuccess();
        return validated.data;
      } catch (err) {
        lastErr = err;
        console.warn(`[StudyPlanAiProvider] Gemini day feedback (${model}) call failed (${sanitizeLogMessage(err.message)}), trying next candidate...`);
      }
    }

    if (lastErr) {
      recordAiFailure(lastErr);
      console.warn(`[StudyPlanAiProvider] All Gemini day feedback candidates failed (${sanitizeLogMessage(lastErr.message)}), falling back to rule-based`);
    }
    return null;
  },
};

module.exports = StudyPlanAiProvider;
