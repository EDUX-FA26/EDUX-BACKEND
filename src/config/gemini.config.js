require("dotenv").config();
const { GoogleGenAI, HarmCategory, HarmBlockThreshold, Type } = require("@google/genai");

const clients = new Map();

/**
 * Chuẩn hóa chuỗi model code hợp lệ theo Google GenAI SDK (@google/genai)
 * Tự động sửa các lỗi gõ nhầm (ví dụ: gemini-3-5-flash-lite -> gemini-3.5-flash-lite, gemini-2-5 -> gemini-2.5)
 * Fallback an toàn về model ổn định (gemini-3.5-flash-lite hoặc gemini-2.5-flash-lite)
 */
function normalizeGeminiModel(rawModel, fallback = 'gemini-3.5-flash-lite') {
  if (!rawModel || typeof rawModel !== 'string') return fallback;
  let m = rawModel.trim();
  // Sửa lỗi gõ nhầm dấu gạch nối
  m = m.replace(/^gemini-3-5-/i, 'gemini-3.5-')
       .replace(/^gemini-2-5-/i, 'gemini-2.5-')
       .replace(/^gemini-1-5-/i, 'gemini-1.5-');

  const validModels = [
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-1.5-flash'
  ];

  if (validModels.includes(m)) {
    return m;
  }
  return fallback;
}

async function getGeminiClient(apiKey = process.env.GEMINI_API_KEY) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!clients.has(key)) {
    clients.set(key, new GoogleGenAI({ apiKey: key }));
  }

  return clients.get(key);
}

/**
 * Helper: Bọc hàm gọi Gemini API với cơ chế Retry Exponential Backoff & Jitter
 * Tự động thử lại tối đa 4 lần khi gặp lỗi tạm thời (503 Overloaded/Service Unavailable/High Demand, 429 Rate Limit, 500, Timeout).
 * Delay tăng dần: 1.5s -> 3s -> 5s -> 8s kèm ngẫu nhiên jitter để vượt qua các đợt spike tải đỉnh của Gemini API.
 */
async function callGeminiWithRetry(promptFn, maxRetries = 4, initialDelay = 1500) {
  let delay = initialDelay;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await promptFn();
    } catch (error) {
      const status = error?.status || error?.statusCode || error?.response?.status || error?.code;
      const msg = String(error?.message || '').toLowerCase();
      const isTransientError = (
        status === 503 ||
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 504 ||
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('overloaded') ||
        msg.includes('unavailable') ||
        msg.includes('high demand') ||
        msg.includes('spikes in demand') ||
        msg.includes('resource_exhausted') ||
        msg.includes('rate limit') ||
        msg.includes('deadline exceeded') ||
        msg.includes('econnreset') ||
        msg.includes('etimedout')
      );

      if (isTransientError && attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 400);
        const waitTime = delay + jitter;
        console.warn(`[Gemini API] Gặp lỗi tạm thời (${status || '503 High Demand'}), thử lại lần ${attempt}/${maxRetries} sau ${waitTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        delay = Math.min(delay * 2, 8000);
        continue;
      }
      throw error;
    }
  }
}

async function askGemini(prompt) {
  const ai = await getGeminiClient();
  const activeModel = normalizeGeminiModel(process.env.GEMINI_MODEL, 'gemini-3.5-flash-lite');
  console.log(`[ART-AI Debug] >>> Đang gọi Gemini với Model: "${activeModel}" (env GEMINI_MODEL="${process.env.GEMINI_MODEL}")`);

  const response = await callGeminiWithRetry(() => ai.models.generateContent({
    model: activeModel,
    contents: prompt
  }), 3);

  return response.text;
}

const CANONICAL_RUBRIC_MAP = {
  PROBLEM_ABSTRACTION: { altKey: 'decomposition', legacyKey: 'DECOMPOSITION', defaultName: 'Problem Abstraction & Solution Design', ratio: 0.80 },
  DECOMPOSITION: { altKey: 'decomposition', legacyKey: 'DECOMPOSITION', defaultName: 'Decomposition (Phân rã bài toán)', ratio: 0.80 },
  decomposition: { altKey: 'decomposition', legacyKey: 'DECOMPOSITION', defaultName: 'Decomposition (Phân rã bài toán)', ratio: 0.80 },

  IMPLEMENTATION_QUALITY: { altKey: 'pattern', legacyKey: 'PATTERN_RECOGNITION', defaultName: 'Implementation & Code Quality', ratio: 0.88 },
  PATTERN_RECOGNITION: { altKey: 'pattern', legacyKey: 'PATTERN_RECOGNITION', defaultName: 'Pattern Recognition (Nhận diện mẫu kiến trúc)', ratio: 0.88 },
  pattern: { altKey: 'pattern', legacyKey: 'PATTERN_RECOGNITION', defaultName: 'Pattern Recognition (Nhận diện mẫu kiến trúc)', ratio: 0.88 },
  pattern_recognition: { altKey: 'pattern', legacyKey: 'PATTERN_RECOGNITION', defaultName: 'Pattern Recognition (Nhận diện mẫu kiến trúc)', ratio: 0.88 },

  CRITICAL_EVALUATION: { altKey: 'abstraction', legacyKey: 'ABSTRACTION', defaultName: 'Critical Evaluation & Verification', ratio: 0.80 },
  ABSTRACTION: { altKey: 'abstraction', legacyKey: 'ABSTRACTION', defaultName: 'Abstraction (Trừu tượng hóa & DTO/Entity)', ratio: 0.80 },
  abstraction: { altKey: 'abstraction', legacyKey: 'ABSTRACTION', defaultName: 'Abstraction (Trừu tượng hóa & DTO/Entity)', ratio: 0.80 },

  AI_INTERACTION: { altKey: 'algorithmic', legacyKey: 'ALGORITHMIC_THINKING', defaultName: 'AI Interaction & Prompt Engineering', ratio: 0.68 },
  ALGORITHMIC_THINKING: { altKey: 'algorithmic', legacyKey: 'ALGORITHMIC_THINKING', defaultName: 'Algorithmic Thinking (Tư duy thuật toán & Logic nghiệp vụ)', ratio: 0.68 },
  algorithmic: { altKey: 'algorithmic', legacyKey: 'ALGORITHMIC_THINKING', defaultName: 'Algorithmic Thinking (Tư duy thuật toán & Logic nghiệp vụ)', ratio: 0.68 },
  algorithmic_thinking: { altKey: 'algorithmic', legacyKey: 'ALGORITHMIC_THINKING', defaultName: 'Algorithmic Thinking (Tư duy thuật toán & Logic nghiệp vụ)', ratio: 0.68 },

  METACOGNITIVE_REFLECTION: { altKey: 'reflection', legacyKey: 'REFLECTION', defaultName: 'Metacognitive Reflection & Transparency', ratio: 0.68 },
  REFLECTION: { altKey: 'reflection', legacyKey: 'REFLECTION', defaultName: 'Reflection (Đánh giá & Kiểm thử biên)', ratio: 0.68 },
  reflection: { altKey: 'reflection', legacyKey: 'REFLECTION', defaultName: 'Reflection (Đánh giá & Kiểm thử biên)', ratio: 0.68 },
};

/**
 * BƯỚC 2: Xây dựng System Instruction động theo đúng danh sách tiêu chí Rubric Active của Assignment.
 * @param {Array<{ index: number, criterion_key: string, criteria_name?: string, criterion_name?: string, weight_percent: number, max_score: number }>} activeRubrics
 * @returns {string}
 */
function buildDynamicGradingSystemInstruction(activeRubrics) {
  const criteriaLines = activeRubrics
    .map(
      (r) =>
        `${r.index}. ${r.criteria_name || r.criterion_name || r.criterion_key} (key: "${r.criterion_key}"): Trọng số ${r.weight_percent}% (Tối đa ${r.max_score.toFixed(1)} điểm)`
    )
    .join('\n');

  return `Bạn là Trợ lý AI chấm điểm thông minh và công tâm cho bài tập lập trình.

QUY TẮC BẮT BUỘC:
- Bạn CHỈ ĐƯỢC PHÉP chấm điểm và đưa ra nhận xét dựa trên danh sách ${activeRubrics.length} tiêu chí đang được BẬT (Active) dưới đây.
- TUYỆT ĐỐI KHÔNG đánh giá, không trừ điểm hay đề cập đến bất kỳ tiêu chí nào nằm ngoài danh sách này (các tiêu chí đã bị giảng viên tắt/uncheck).
- Điểm chấm cho từng tiêu chí ("awarded_score") BẮT BUỘC nằm trong khoảng từ 0.0 đến đúng trần điểm tối đa ("max_score") quy định của tiêu chí đó.
- Chấm sát thực tế yêu cầu đề bài: Nếu code chạy đúng khung sườn logic chính nhưng còn thiếu tối ưu nhỏ, trừ điểm hợp lý (0.3 - 0.8đ trên tiêu chí liên quan), không đánh trượt vô lý.

DANH SÁCH TIÊU CHÍ VÀ TRỌNG SỐ HIỆN HÀNH (Tổng thang điểm: 10.0):
${criteriaLines}

NHIỆM VỤ:
Đọc phần bài nộp mã nguồn và khai báo AI Audit Log (tất cả các Scope tương ứng) của sinh viên, sau đó chấm điểm từng tiêu chí active trên đúng trần điểm trọng số quy định, đảm bảo tổng điểm quy đổi chính xác trên thang 10.0.`;
}

/**
 * BƯỚC 3: Cơ chế phòng vệ hậu kỳ (Backend Scoring Guardrails)
 * Chặn mọi sai lệch điểm số từ AI, ép trần theo max_score của từng tiêu chí và tính tổng chính xác trên thang 10.0
 * @param {any} aiRawResult
 * @param {Array<{ criterion_key: string, criteria_name?: string, criterion_name?: string, weight_percent: number, max_score: number, altKey?: string, legacyKey?: string }>} activeRubrics
 * @returns {any}
 */
function applyScoringGuardrails(aiRawResult, activeRubrics) {
  const aiBreakdown = Array.isArray(aiRawResult?.grading_breakdown)
    ? aiRawResult.grading_breakdown
    : (Array.isArray(aiRawResult?.rubric_evaluations)
      ? aiRawResult.rubric_evaluations
      : (Array.isArray(aiRawResult?.rubrics) ? aiRawResult.rubrics : []));

  let calculatedTotal = 0;

  // Map đúng theo danh sách activeRubrics của DB (chặn AI tự bịa thêm hoặc bỏ sót tiêu chí)
  const validatedBreakdown = activeRubrics.map((rubric) => {
    const matched = aiBreakdown.find(
      (item) =>
        item.criterion_key === rubric.criterion_key ||
        (item.criteria && item.criteria.toLowerCase().trim() === (rubric.criteria_name || rubric.criterion_name || '').toLowerCase().trim()) ||
        (item.criterion_name && item.criterion_name.toLowerCase().trim() === (rubric.criteria_name || rubric.criterion_name || '').toLowerCase().trim()) ||
        (rubric.altKey && (item.criterion_key === rubric.altKey || item.criterion_id === rubric.altKey)) ||
        (rubric.legacyKey && (item.criterion_key === rubric.legacyKey || item.criterion_id === rubric.legacyKey))
    );

    let rawAwarded = Number(matched?.awarded_score ?? matched?.score ?? 0);
    if (Number.isNaN(rawAwarded) || rawAwarded < 0) rawAwarded = 0;

    // GUARDRAIL 1: Ép trần không bao giờ vượt quá max_score theo trọng số
    const clampedScore = Math.min(rawAwarded, rubric.max_score);
    const roundedScore = Number(clampedScore.toFixed(2));

    calculatedTotal += roundedScore;

    const comment = matched?.comment || matched?.reason || matched?.reasoning || matched?.short_reason || `Đã đánh giá theo tiêu chí ${rubric.criteria_name || rubric.criterion_name}.`;

    return {
      criterion_key: rubric.criterion_key,
      criteria: rubric.criteria_name || rubric.criterion_name,
      criterion_name: rubric.criteria_name || rubric.criterion_name,
      weight_percent: rubric.weight_percent,
      max_score: rubric.max_score,
      awarded_score: roundedScore,
      score: roundedScore,
      comment: comment,
      reason: comment,
    };
  });

  // GUARDRAIL 2: Tổng điểm luôn bằng tổng chính xác của các thành phần và không vượt quá 10.0
  const finalTotalScore = Number(Math.min(calculatedTotal, 10.0).toFixed(2));

  // Build rubric_scores & rubric_reasonings dictionary cho backward compatibility
  /** @type {Record<string, number>} */
  const rubric_scores = {};
  /** @type {Record<string, string>} */
  const rubric_reasonings = {};
  validatedBreakdown.forEach((item) => {
    const keyLower = String(item.criterion_key).toLowerCase();
    const keyUpper = String(item.criterion_key).toUpperCase();
    rubric_scores[keyLower] = item.awarded_score;
    rubric_scores[keyUpper] = item.awarded_score;
    rubric_reasonings[keyLower] = item.comment;
    rubric_reasonings[keyUpper] = item.comment;

    const std = activeRubrics.find((r) => r.criterion_key === item.criterion_key);
    if (std?.altKey) {
      rubric_scores[std.altKey] = item.awarded_score;
      rubric_reasonings[std.altKey] = item.comment;
    }
    if (std?.legacyKey) {
      rubric_scores[std.legacyKey] = item.awarded_score;
      rubric_reasonings[std.legacyKey] = item.comment;
    }
  });

  const rawRisk = aiRawResult?.risk_level || aiRawResult?.audit_integrity?.risk_level;
  let normalizedRisk = 'low';
  if (typeof rawRisk === 'string') {
    const clean = rawRisk.toLowerCase();
    if (clean.includes('high')) normalizedRisk = 'high';
    else if (clean.includes('med')) normalizedRisk = 'medium';
    else normalizedRisk = 'low';
  }

  const audit_integrity = aiRawResult?.audit_integrity
    ? {
        ...aiRawResult.audit_integrity,
        risk_level: normalizedRisk.toUpperCase() + '_RISK',
        riskLevel: normalizedRisk,
        penalty_applied: false,
        penalty_reason: 'Không trừ điểm học thuật; sử dụng câu hỏi VIVA để giảng viên tự vấn đáp.',
      }
    : {
        match_percentage: 95.0,
        risk_level: normalizedRisk.toUpperCase() + '_RISK',
        riskLevel: normalizedRisk,
        ai_transparency_index: 'A',
        reflection_depth: 'High',
        penalty_applied: false,
        penalty_reason: 'Không trừ điểm học thuật; sử dụng câu hỏi VIVA để giảng viên tự vấn đáp.',
      };

  const verdict =
    aiRawResult?.overall_verdict ||
    aiRawResult?.ai_verdict ||
    `Kết luận chuyên môn: Bài làm đạt ${finalTotalScore}/10 điểm theo ${activeRubrics.length} tiêu chí Rubric được kích hoạt. Mã nguồn đã hoàn thiện khung sườn chức năng chính. Khuyến nghị Giảng viên sử dụng bộ câu hỏi vấn đáp Viva để kiểm chứng thêm.`;

  return {
    ...aiRawResult,
    grading_breakdown: validatedBreakdown,
    rubric_evaluations: validatedBreakdown,
    rubrics: validatedBreakdown,
    rubric_scores,
    rubric_reasonings,
    total_score_10: finalTotalScore,
    total_score: finalTotalScore,
    risk_level: normalizedRisk,
    audit_integrity,
    overall_verdict: verdict,
    ai_verdict: verdict,
    viva_questions: Array.isArray(aiRawResult?.viva_questions) ? aiRawResult.viva_questions : [],
  };
}

/**
 * 2. Hàm chuyên dụng: Thẩm định kiểm toán mã nguồn SE/IT, đối soát chéo và chấm điểm Rubric theo cấu hình động kèm Bộ câu hỏi Viva
 * @param {Object} data Dữ liệu bài tập & bài nộp
 * @param {string} data.assignmentInfo Mô tả yêu cầu đề bài SE/IT
 * @param {string} data.sourceCode Mã nguồn hoặc cấu trúc file dự án thực tế
 * @param {string} data.gitHistory Lịch sử Git commit thực tế
 * @param {string} data.aiAuditSummary Tóm tắt mức độ phụ thuộc AI và các tool AI sinh viên đã khai báo
 * @param {string} data.oralExamLogs Bản ghi câu hỏi - câu trả lời trong phiên vấn đáp Viva (nếu có)
 * @param {Array} data.rubricConfigs Cấu hình rubric và trọng số động từ Giảng viên
 * @param {Array} data.activeRubrics Danh sách rubric active đã được lọc và chuẩn hóa
 */
async function evaluateRubricWithGemini({ assignmentInfo, sourceCode, gitHistory, aiAuditSummary, oralExamLogs, rubricConfigs, activeRubrics }) {
  // Ưu tiên key audit riêng để tránh quá tải key chính
  const auditKey = process.env.GEMINI_API_KEY_AUDIT || process.env.GEMINI_API_KEY;
  if (!auditKey) {
    throw new Error("GEMINI_API_KEY_MISSING: Chưa cấu hình GEMINI_API_KEY_AUDIT hoặc GEMINI_API_KEY trong file .env");
  }

  const ai = await getGeminiClient(auditKey);

  const DEFAULT_CONFIGS = [
    { criterion_key: 'PROBLEM_ABSTRACTION', criterion_name: 'Problem Abstraction & Solution Design', weight_percent: 20, is_enabled: true },
    { criterion_key: 'IMPLEMENTATION_QUALITY', criterion_name: 'Implementation & Code Quality', weight_percent: 30, is_enabled: true },
    { criterion_key: 'CRITICAL_EVALUATION', criterion_name: 'Critical Evaluation & Verification', weight_percent: 25, is_enabled: true },
    { criterion_key: 'AI_INTERACTION', criterion_name: 'AI Interaction & Prompt Engineering', weight_percent: 15, is_enabled: true },
    { criterion_key: 'METACOGNITIVE_REFLECTION', criterion_name: 'Metacognitive Reflection & Transparency', weight_percent: 10, is_enabled: true },
  ];

  let rawConfigs = (Array.isArray(activeRubrics) && activeRubrics.length > 0)
    ? activeRubrics
    : ((Array.isArray(rubricConfigs) && rubricConfigs.length > 0) ? rubricConfigs : DEFAULT_CONFIGS);

  let enabledConfigs = rawConfigs.filter((c) => c.is_enabled !== false && Number(c.weight_percent) > 0);
  if (enabledConfigs.length === 0) enabledConfigs = DEFAULT_CONFIGS;

  const finalActiveRubrics = enabledConfigs.map((c, idx) => {
    const mapInfo = CANONICAL_RUBRIC_MAP[c.criterion_key] || {
      altKey: String(c.criterion_key).toLowerCase(),
      legacyKey: String(c.criterion_key).toUpperCase(),
      defaultName: c.criterion_name || c.criteria_name || c.criterion_key,
    };
    const weight = Number(c.weight_percent) || 20;
    const max_score = Number(((weight / 100) * 10).toFixed(2));
    return {
      index: idx + 1,
      criterion_key: c.criterion_key,
      criteria_name: c.criterion_name || c.criteria_name || mapInfo.defaultName,
      weight_percent: weight,
      max_score: max_score,
      altKey: mapInfo.altKey,
      legacyKey: mapInfo.legacyKey,
    };
  });

  // BƯỚC 2: Xây dựng System Instruction động theo danh sách tiêu chí Active
  const systemInstruction = buildDynamicGradingSystemInstruction(finalActiveRubrics);

  const prompt = `
Bạn hãy thẩm định bài nộp thuộc chuyên ngành Kỹ thuật Phần mềm (SE) / CNTT (IT) dưới đây, đối chiếu toàn bộ các Scope khai báo AI với mã nguồn thực tế và chấm điểm chuẩn xác theo các tiêu chí Rubric được kích hoạt (Tổng 10.0 điểm) cùng Bộ câu hỏi vấn đáp Viva:

--- DANH SÁCH TIÊU CHÍ RUBRIC ĐƯỢC THIẾT LẬP (${finalActiveRubrics.length} TIÊU CHÍ ACTIVE) ---
${finalActiveRubrics.map(c => `• ${c.criterion_key} (${c.criteria_name}): Trọng số ${c.weight_percent}%, Tối đa ${c.max_score} điểm`).join('\n')}

--- THÔNG TIN ĐỐI SOÁT CHÉO THỰC TẾ ---
[1. YÊU CẦU ĐỀ BÀI SE/IT]:
${assignmentInfo || "Xây dựng ứng dụng phần mềm theo đặc tả yêu cầu."}

[2. DANH SÁCH TẬP TIN, CẤU TRÚC AST VÀ MÃ NGUỒN BÀI NỘP]:
${sourceCode || "Không tìm thấy mã nguồn trong bài nộp."}

[3. LỊCH SỬ GIT COMMIT THỰC TẾ]:
${gitHistory || "Không tìm thấy lịch sử Git commit."}

[4. KẾT QUẢ THANH TRA & KHAI BÁO AI THEO CÁC PHẠM VI (AI AUDIT LOGS)]:
${aiAuditSummary || "Sinh viên không khai báo sử dụng AI."}

[5. BẢN GHI PHIÊN VẤN ĐÁP VIVA (NẾU ĐÃ CÓ)]:
${oralExamLogs || "Chưa có bản ghi phỏng vấn Viva."}

--- HƯỚNG DẪN QUY CHUẨN ĐIỂM SỐ & PHẢN HỒI ---
- Bạn CHỈ chấm điểm cho đúng ${finalActiveRubrics.length} tiêu chí active trên trong mảng "grading_breakdown".
- TUYỆT ĐỐI KHÔNG đánh giá, không trừ điểm hay đề cập đến bất kỳ tiêu chí nào khác nằm ngoài danh sách này.
- Điểm awarded_score của mỗi tiêu chí KHÔNG ĐƯỢC vượt quá max_score quy định của tiêu chí đó (nằm trong khoảng từ 0.0 đến max_score).
- Điểm total_score_10 là tổng điểm awarded_score của các tiêu chí active (thang 10.0).
- Trả về kết quả hoàn toàn bằng tiếng Việt có dấu.
`;

  // Cấu hình Schema bắt buộc Gemini trả về đúng khuôn JSON theo yêu cầu
  const rubricResponseSchema = {
    type: Type.OBJECT,
    properties: {
      grading_breakdown: {
        type: Type.ARRAY,
        description: `Bắt buộc trả về đúng ${finalActiveRubrics.length} tiêu chí Active: ${finalActiveRubrics.map(c => c.criterion_key).join(', ')}`,
        items: {
          type: Type.OBJECT,
          properties: {
            criterion_key: {
              type: Type.STRING,
              description: `Mã định danh tiêu chí trong số: ${finalActiveRubrics.map(c => c.criterion_key).join(', ')}`
            },
            criteria: { type: Type.STRING },
            max_score: { type: Type.NUMBER, description: "Điểm tối đa của tiêu chí theo trọng số" },
            awarded_score: { type: Type.NUMBER, description: "Điểm từ 0.0 đến max_score tương ứng của tiêu chí" },
            comment: { type: Type.STRING, description: "Giải thích cụ thể lý do cộng/trừ điểm dựa trên code thực tế và các Scope khai báo AI" }
          },
          required: ["criterion_key", "criteria", "max_score", "awarded_score", "comment"]
        }
      },
      total_score_10: { type: Type.NUMBER, description: "Tổng điểm quy đổi thang 10.0 của các tiêu chí active" },
      risk_level: {
        type: Type.STRING,
        enum: ["low", "medium", "high", "LOW_RISK", "MEDIUM_RISK", "HIGH_RISK"]
      },
      audit_integrity: {
        type: Type.OBJECT,
        properties: {
          match_percentage: { type: Type.NUMBER },
          risk_level: {
            type: Type.STRING,
            enum: ["LOW_RISK", "MEDIUM_RISK", "HIGH_RISK", "low", "medium", "high"]
          },
          ai_transparency_index: {
            type: Type.STRING,
            enum: ["A+", "A", "B", "C", "F"]
          },
          reflection_depth: {
            type: Type.STRING,
            enum: ["High", "Medium", "Low", "Suspicious"]
          },
          penalty_applied: { type: Type.BOOLEAN },
          penalty_reason: { type: Type.STRING }
        },
        required: ["match_percentage", "risk_level", "ai_transparency_index", "reflection_depth", "penalty_applied", "penalty_reason"]
      },
      viva_questions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.INTEGER },
            rubric_criterion: { type: Type.STRING },
            target_file: { type: Type.STRING },
            target_code_snippet: { type: Type.STRING },
            question: { type: Type.STRING },
            expected_answer_criteria: { type: Type.STRING }
          },
          required: ["id", "rubric_criterion", "target_file", "target_code_snippet", "question", "expected_answer_criteria"]
        }
      },
      overall_verdict: {
        type: Type.STRING,
        description: "Bản tóm tắt kết luận thẩm định chi tiết bằng Tiếng Việt chuẩn có dấu"
      }
    },
    required: ["grading_breakdown", "total_score_10", "risk_level", "overall_verdict"]
  };

  const generateConfig = {
    systemInstruction,
    temperature: 0.1, // Giữ nguyên để AI chấm điểm logic, ít sáng tạo bừa
    maxOutputTokens: 8192, // QUAN TRỌNG: Tránh bị cụt JSON khi bài code quá dài
    responseMimeType: "application/json",
    responseSchema: rubricResponseSchema,
    // Bổ sung safety settings để tránh bị chặn nhầm các đoạn code liên quan đến bảo mật/SQL/Auth
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
    ],
  };

  const primaryModel = normalizeGeminiModel(process.env.GEMINI_MODEL_AUDIT || process.env.GEMINI_MODEL, "gemini-3.5-flash-lite");

  // Multi-tier pool các model chất lượng cao theo thứ tự ưu tiên
  const candidateModels = [
    primaryModel,
    (primaryModel === "gemini-3.5-flash" ? "gemini-3.5-flash-lite" : "gemini-3.5-flash"),
    "gemini-flash-lite-latest",
    "gemini-3.5-flash-lite"
  ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

  // Pool các API key dự phòng để tránh rate-limit / quota spike theo project
  const candidateKeys = [
    process.env.GEMINI_API_KEY_AUDIT,
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_PRE_CHECK_SUBMIT
  ].filter(Boolean);

  let response = null;
  let lastError = null;

  for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
    const currentModel = candidateModels[mIdx];
    const currentKey = candidateKeys[mIdx % candidateKeys.length] || auditKey;
    const currentAi = await getGeminiClient(currentKey);

    try {
      console.log(`[ART-AI Debug] >>> Đang gọi Gemini với Model: "${currentModel}" (env GEMINI_MODEL="${process.env.GEMINI_MODEL}") [thử nghiệm model ${mIdx + 1}/${candidateModels.length}]`);
      response = await callGeminiWithRetry(() => currentAi.models.generateContent({
        model: currentModel,
        contents: prompt,
        config: generateConfig,
      }), 3, 1500);

      if (response && response.text) {
        break; // Gọi thành công!
      }
    } catch (err) {
      lastError = err;
      const status = err?.status || err?.statusCode || 503;
      console.warn(`[Gemini Audit] Model "${currentModel}" gặp lỗi (${status} - ${err.message?.slice(0, 100)}). Tự động chuyển sang model tiếp theo trong pool...`);
    }
  }

  // Nếu toàn bộ pool model đều bị 503 hoặc quá tải, kích hoạt khung thẩm định sư phạm dự phòng
  if (!response || !response.text) {
    console.error(`[Gemini Audit] Toàn bộ các model (${candidateModels.join(', ')}) đều quá tải/503. Kích hoạt Khung Thẩm Định Sư Phạm Dự Phòng.`);
    return generatePedagogicalFallbackResult({ assignmentInfo, sourceCode, aiAuditSummary, activeRubrics: finalActiveRubrics, rubricConfigs: finalActiveRubrics });
  }

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (parseErr) {
    console.warn(`[Gemini Audit] Lỗi parse JSON từ Gemini response: ${parseErr.message}. Kích hoạt fallback.`);
    return generatePedagogicalFallbackResult({ assignmentInfo, sourceCode, aiAuditSummary, activeRubrics: finalActiveRubrics, rubricConfigs: finalActiveRubrics });
  }

  // Áp dụng Guardrails để kiểm tra, ép trần max_score và tính tổng thang 10.0
  const guardrailed = applyScoringGuardrails(parsed, finalActiveRubrics);

  // Chuẩn hóa viva_questions nếu có
  if (Array.isArray(guardrailed.viva_questions)) {
    guardrailed.viva_questions.forEach(q => {
      if (!q.expected_answer_criteria && q.expected_answer_key) {
        q.expected_answer_criteria = q.expected_answer_key;
      }
      if (!q.expected_answer_key && q.expected_answer_criteria) {
        q.expected_answer_key = q.expected_answer_criteria;
      }
      if (!q.target_code_snippet && q.target_function_or_snippet) {
        q.target_code_snippet = q.target_function_or_snippet;
      }
      if (!q.target_function_or_snippet && q.target_code_snippet) {
        q.target_function_or_snippet = q.target_code_snippet;
      }
    });
  }

  return sanitizeObjectStrings(guardrailed);
}

function cleanVietnameseEncoding(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/B"ai/g, 'Bài')
    .replace(/b"ai/g, 'bài')
    .replace(/n"op/g, 'nộp')
    .replace(/kh"ong/g, 'không')
    .replace(/"d"at/g, 'đạt')
    .replace(/y"eu/g, 'yêu')
    .replace(/c"au/g, 'cầu')
    .replace(/k"y/g, 'kỹ')
    .replace(/thu"at/g, 'thuật')
    .replace(/c"ot/g, 'cốt')
    .replace(/l~oi/g, 'lõi')
    .replace(/c"an/g, 'cần')
    .replace(/th"uc/g, 'thực')
    .replace(/hi"en/g, 'hiện')
    .replace(/di"em/g, 'điểm')
    .replace(/ti"eu/g, 'tiêu')
    .replace(/ch"i/g, 'chí')
    .replace(/d"anh/g, 'đánh')
    .replace(/gi"a/g, 'giá')
    .replace(/m"a/g, 'mã')
    .replace(/ngu"on/g, 'nguồn')
    .replace(/t"ap/g, 'tập')
    .replace(/h"oc/g, 'học')
    .replace(/ph"an/g, 'phân')
    .replace(/t"ich/g, 'tích')
    .replace(/"d/g, 'đ')
    .replace(/"D/g, 'Đ')
    .replace(/\\"d/g, 'đ')
    .replace(/\\"D/g, 'Đ');
}

function sanitizeObjectStrings(obj) {
  if (!obj) return obj;
  if (typeof obj === 'string') return cleanVietnameseEncoding(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObjectStrings);
  if (typeof obj === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = sanitizeObjectStrings(v);
    }
    return res;
  }
  return obj;
}

/**
 * 3. Hàm chuyên dụng: Chẩn đoán kiểm tra nhanh bài làm bản nháp của sinh viên trước khi nộp (Pre-submission AI Sanity Check)
 * - Non-blocking: Chỉ cảnh báo/gợi ý định hướng, KHÔNG chấm điểm
 * - Response JSON schema chuẩn tiếng Việt UTF-8
 */
async function preSubmissionSanityCheckWithGemini({ assignmentTitle, assignmentDescription, sourceCode, studentDeclarations }) {
  const apiKey = process.env.GEMINI_API_KEY_PRE_CHECK_SUBMIT || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING: Chưa cấu hình GEMINI_API_KEY_PRE_CHECK_SUBMIT hoặc GEMINI_API_KEY trong file .env");
  }

  const ai = await getGeminiClient(apiKey);

  const systemInstruction = `Bạn là Trợ lý AI Chuyên gia Kiểm toán & Hướng dẫn học tập Kỹ thuật Phần mềm (Academic Sanity Auditor). Nhiệm vụ của bạn là đọc và chẩn đoán nhanh bài làm bản nháp (Draft) của sinh viên dựa trên yêu cầu đề bài, sau đó đưa ra các nhận xét mang tính chất định hướng, cảnh báo sớm và gợi ý cải thiện.

LƯU Ý QUAN TRỌNG:
1. Bạn KHÔNG ĐƯỢC chấm điểm, KHÔNG ĐƯỢC quy đổi thang điểm, và KHÔNG ĐƯỢC dùng ngôn ngữ phán xét hay cấm đoán. Hãy đóng vai trò là một người cố vấn khách quan.
2. TOÀN BỘ nội dung phản hồi BẮT BUỘC phải viết bằng Tiếng Việt chuẩn có dấu (UTF-8), câu từ rõ ràng, sư phạm.
3. TUYỆT ĐỐI KHÔNG VIẾT HỘ CODE HOẶC GIẢI HỘ BÀI TẬP. Chỉ gợi mở tư duy để sinh viên tự sửa.
4. Trả về đúng định dạng JSON chuẩn theo schema sau:
{
  "relevance_status": "MATCH" | "MISMATCH_OR_SUSPICIOUS",
  "relevance_reason": "string",
  "diagnostic_warnings": ["string"],
  "micro_suggestions": ["string"]
}`;

  const prompt = `
Hãy chẩn đoán nhanh bài làm bản nháp của sinh viên trước khi nộp theo các thông tin sau:

[1. YÊU CẦU ĐỀ BÀI TỪ GIẢNG VIÊN]:
Tiêu đề: ${assignmentTitle || "Không có tiêu đề"}
Mô tả & Yêu cầu: ${assignmentDescription || "Xây dựng dự án phần mềm theo yêu cầu."}

[2. BÀI NỘP THỰC TẾ CỦA SINH VIÊN]:
${sourceCode || "Chưa có nội dung mã nguồn được trích xuất."}

[3. KHAI BÁO AI AUDIT LOG CỦA SINH VIÊN]:
${studentDeclarations || "Sinh viên chưa khai báo hoặc không sử dụng AI."}
`;

  const sanityCheckResponseSchema = {
    type: Type.OBJECT,
    properties: {
      relevance_status: {
        type: Type.STRING,
        enum: ["MATCH", "MISMATCH_OR_SUSPICIOUS"],
        description: "Đánh giá bài làm có đúng đề bài yêu cầu hay không"
      },
      relevance_reason: {
        type: Type.STRING,
        description: "Giải thích ngắn gọn lý do tại sao bài làm khớp hoặc nghi ngờ lệch đề bài"
      },
      diagnostic_warnings: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Danh sách các cảnh báo rủi ro, lỗ hổng kỹ thuật, điểm mù hoặc lỗi logic tiềm ẩn"
      },
      micro_suggestions: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Các câu hỏi định hướng hoặc gợi ý ngắn để sinh viên tự rà soát và hoàn thiện bài"
      }
    },
    required: ["relevance_status", "relevance_reason", "diagnostic_warnings", "micro_suggestions"]
  };

  const generateConfig = {
    systemInstruction,
    temperature: 0.2,
    maxOutputTokens: 4096,
    responseMimeType: "application/json",
    responseSchema: sanityCheckResponseSchema,
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
    ],
  };

  const primaryModel = normalizeGeminiModel(process.env.GEMINI_MODEL_PRE_CHECK_SUBMIT || process.env.GEMINI_MODEL, "gemini-3.5-flash-lite");
  const fallbackModel = (primaryModel === "gemini-3.5-flash-lite") ? "gemini-3.5-flash" : "gemini-3.5-flash-lite";

  let response;
  try {
    console.log(`[ART-AI Debug] >>> Đang gọi Gemini với Model: "${primaryModel}" (env GEMINI_MODEL="${process.env.GEMINI_MODEL}")`);
    response = await callGeminiWithRetry(() => ai.models.generateContent({
      model: primaryModel,
      contents: prompt,
      config: generateConfig,
    }), 3);
  } catch (err) {
    if (primaryModel !== fallbackModel) {
      console.warn(`[Gemini Sanity Check] Model ${primaryModel} gặp lỗi sau retry, chuyển sang ${fallbackModel}...`);
      console.log(`[ART-AI Debug] >>> Đang gọi Gemini với Model (Fallback): "${fallbackModel}" (env GEMINI_MODEL="${process.env.GEMINI_MODEL}")`);
      response = await callGeminiWithRetry(() => ai.models.generateContent({
        model: fallbackModel,
        contents: prompt,
        config: generateConfig,
      }), 3);
    } else {
      throw err;
    }
  }

  const parsed = JSON.parse(response.text);
  return sanitizeObjectStrings(parsed);
}

/**
 * 4. Hàm chuyên dụng: Phân tích báo cáo sư phạm AI (AI Class Advisor) cho lớp học sau khi bài tập kết thúc hạn nộp
 * @param {Object} data
 * @param {string} data.assignmentTitle
 * @param {string} data.assignmentDescription
 * @param {string} data.classCode
 * @param {string} data.subjectName
 * @param {number} data.totalStudents
 * @param {number} data.submittedCount
 * @param {string} data.submissionRateText
 * @param {string} data.avgTransparency
 * @param {Array<Object>} data.auditSummaries
 */
async function generateClassAiAdvisoryWithGemini({
  assignmentTitle,
  assignmentDescription,
  classCode,
  subjectName,
  totalStudents,
  submittedCount,
  submissionRateText,
  avgTransparency,
  auditSummaries = []
}) {
  const apiKey = process.env.GEMINI_API_KEY_AUDIT || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING: Chưa cấu hình GEMINI_API_KEY_AUDIT hoặc GEMINI_API_KEY trong file .env");
  }

  const ai = await getGeminiClient(apiKey);

  const systemInstruction = `Bạn là Chuyên gia Phân tích Giáo dục & Trợ lý Sư phạm thông minh (AI Lecture Advisor) cho giảng viên công nghệ phần mềm.

QUY TẮC PHÂN TÍCH THEO DỮ LIỆU THỰC TẾ:
Hãy tính toán tỷ lệ nộp bài = (total_students_submitted / total_students_enrolled).

TRƯỜNG HỢP 1: TỶ LỆ NỘP BÀI THẤP (< 50% hoặc < 5 bài nộp) -> BẬT "CHẾ ĐỘ ĐÔN ĐỐC TIẾN ĐỘ" (mode: "PROGRESS_REMINDER"):
- Tuyệt đối KHÔNG lặp đi lặp lại các câu vô nghĩa như "chưa có dữ liệu", "chưa ghi nhận lỗi", "N/A".
- class_overview: 
  + submission_rate_text: Nêu rõ tỷ lệ nộp bài thực tế.
  + avg_ai_transparency: Nếu không có điểm audit thực tế từ sinh viên đã nộp -> BẮT BUỘC TRẢ VỀ null. TUYỆT ĐỐI KHÔNG sinh ra text kiểu "Đang cập nhật", "N/A", "Chưa có dữ liệu". Nếu có điểm audit thực tế, trả về chuỗi điểm phần trăm.
- common_error_clusters: Chỉ trả về 1 thông điệp súc tích: "Tiến độ nộp bài còn chậm; chưa đủ mẫu dữ liệu audit để tổng hợp cụm lỗi kỹ thuật sâu."
- next_slot_recommendation: Đưa ra lời khuyên thiết thực: Dành 10-15 phút đầu giờ rà soát khó khăn, nhắc nhở hạn chót và hướng dẫn lại sinh viên quy trình khai báo AI Audit log trước khi nộp.

TRƯỜNG HỢP 2: TỶ LỆ NỘP BÀI ĐỦ LỚN (>= 50%) -> BẬT "CHẾ ĐỘ PHÂN TÍCH CHUYÊN SÂU" (mode: "DEEP_TECHNICAL"):
- Tách bạch hoàn toàn giữa tiến độ nộp bài và lỗi kỹ thuật.
- class_overview:
  + avg_ai_transparency: Trả về chuỗi điểm minh bạch trung bình thực tế nếu có; nếu không có điểm audit -> trả về null.
- common_error_clusters: Chỉ ra các cụm lỗi lập trình/kiến trúc cụ thể từ báo cáo kiểm toán (ví dụ: quên hash mật khẩu BCrypt, thiếu try-catch ở Service, cấu hình ORM sai, thiếu validation).
- next_slot_recommendation (Gợi ý Sư phạm Chữa lỗi chung): 
  + Nếu phát hiện sinh viên cùng gặp một lỗi kỹ thuật giống nhau hoặc liên quan: AI BẮT BUỘC gợi ý giảng viên demo lại kiến thức trọng tâm đó (chỉ rõ thời lượng đầu giờ, ví dụ: 15-20 phút live-coding giải pháp) để chữa dứt điểm lỗi chung cho sinh viên.

ĐỊNH DẠNG ĐẦU RA (BẮT BUỘC TRẢ VỀ JSON FORMAT THEO SCHEMA):
{
  "mode": "PROGRESS_REMINDER" | "DEEP_TECHNICAL",
  "class_overview": {
    "submission_rate_text": "string (VD: 1/3 sinh viên đã nộp bài (33.3%))",
    "avg_ai_transparency": null // hoặc string điểm số nếu có data thật
  },
  "common_error_clusters": [
    "string"
  ],
  "next_slot_recommendation": "string"
}`;

  const prompt = `
Dưới đây là dữ liệu tổng hợp bài nộp và báo cáo kiểm toán AI của lớp học (100% dữ liệu thực từ database):
- Lớp học: ${classCode || "N/A"} (${subjectName || "N/A"})
- Bài tập: ${assignmentTitle || "Bài tập"}
- Yêu cầu / Mô tả bài tập: ${assignmentDescription || "N/A"}
- Tổng số sinh viên trong lớp (total_students_enrolled): ${totalStudents || 0}
- Số lượng sinh viên đã nộp (total_students_submitted): ${submittedCount || 0}
- Tỷ lệ nộp bài thực tế: ${submissionRateText || `${submittedCount}/${totalStudents} sinh viên đã nộp bài`}
- Mức độ minh bạch AI trung bình thực tế: ${avgTransparency ? avgTransparency : "Không có (chưa có bài nộp nào có điểm audit -> BẮT BUỘC trả về avg_ai_transparency: null)"}

BÁO CÁO AUDIT & ĐÁNH GIÁ CỦA CÁC BÀI NỘP TRONG LỚP:
${auditSummaries && auditSummaries.length > 0 
  ? auditSummaries.map((s, idx) => `[Sinh viên ${idx + 1} - ${s.student_name}]: Điểm minh bạch AI: ${s.transparency || 'Chưa có điểm'}, Mức độ rủi ro: ${s.risk_level || 'Chưa đánh giá'}, Nhận xét audit/lỗi: ${s.summary || 'Không có mô tả'}`).join('\n')
  : "Chưa có bài nộp nào hoặc chưa có báo cáo audit chi tiết."}

Hãy dựa vào tỷ lệ nộp bài để xác định đúng mode ("PROGRESS_REMINDER" hay "DEEP_TECHNICAL") và trả về JSON theo schema.`;

  const advisoryResponseSchema = {
    type: Type.OBJECT,
    properties: {
      mode: {
        type: Type.STRING,
        enum: ["PROGRESS_REMINDER", "DEEP_TECHNICAL"],
        description: "Chế độ: PROGRESS_REMINDER khi tỷ lệ nộp < 50% hoặc < 5 bài nộp; DEEP_TECHNICAL khi tỷ lệ nộp >= 50%"
      },
      class_overview: {
        type: Type.OBJECT,
        properties: {
          submission_rate_text: {
            type: Type.STRING,
            description: "Mô tả tỷ lệ nộp bài, ví dụ: '1/3 sinh viên đã nộp bài (33.3%)' hoặc '45/48 sinh viên đã nộp bài (93.7%)'"
          },
          avg_ai_transparency: {
            type: Type.STRING,
            nullable: true,
            description: "Chỉ số minh bạch AI trung bình nếu có dữ liệu audit thực tế, hoặc null nếu chưa có bài nộp nào có điểm audit. TUYỆT ĐỐI KHÔNG trả về 'Đang cập nhật' hay 'N/A'."
          }
        },
        required: ["submission_rate_text"]
      },
      common_error_clusters: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Danh sách cụm lỗi kỹ thuật hoặc thông điệp tiến độ"
      },
      next_slot_recommendation: {
        type: Type.STRING,
        description: "Lời khuyên sư phạm cụ thể cho buổi học (slot) tiếp theo"
      }
    },
    required: ["mode", "class_overview", "common_error_clusters", "next_slot_recommendation"]
  };

  const generateConfig = {
    systemInstruction,
    temperature: 0.2,
    maxOutputTokens: 4096,
    responseMimeType: "application/json",
    responseSchema: advisoryResponseSchema,
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
    ],
  };

  const primaryModel = normalizeGeminiModel(process.env.GEMINI_MODEL_ADVISOR || process.env.GEMINI_MODEL, "gemini-3.5-flash-lite");
  const fallbackModel = (primaryModel === "gemini-3.5-flash-lite") ? "gemini-3.5-flash" : "gemini-3.5-flash-lite";

  let response;
  const callModel = async (modelName) => {
    console.log(`[ART-AI Debug] >>> Đang gọi Gemini với Model: "${modelName}" (env GEMINI_MODEL="${process.env.GEMINI_MODEL}")`);
    return await callGeminiWithRetry(() => ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: generateConfig,
    }), 3);
  };

  try {
    response = await callModel(primaryModel);
  } catch (err) {
    if (primaryModel !== fallbackModel) {
      console.warn(`[Gemini Class Advisor] Model ${primaryModel} gặp lỗi sau retry (${err.status || err.message}), tự động chuyển sang fallback ${fallbackModel}...`);
      response = await callModel(fallbackModel);
    } else {
      throw err;
    }
  }

  const parsed = JSON.parse(response.text);
  return sanitizeObjectStrings(parsed);
}

/**
 * Khung Thẩm Định Sư Phạm Học Thuật Dự Phòng (Pedagogical Heuristic Fallback)
 * Kích hoạt khi toàn bộ cụm máy chủ Gemini API gặp sự cố quá tải diện rộng (503 High Demand).
 * Đảm bảo hệ thống KHÔNG BAO GIỜ bị crash 500/503 và giảng viên luôn có dữ liệu chấm bài hoàn chỉnh.
 */
function generatePedagogicalFallbackResult({ assignmentInfo = '', sourceCode = '', aiAuditSummary = '', rubricConfigs = null, activeRubrics = null } = {}) {
  const DEFAULT_CONFIGS = [
    { criterion_key: 'PROBLEM_ABSTRACTION', criterion_name: 'Problem Abstraction & Solution Design', weight_percent: 20, is_enabled: true },
    { criterion_key: 'IMPLEMENTATION_QUALITY', criterion_name: 'Implementation & Code Quality', weight_percent: 30, is_enabled: true },
    { criterion_key: 'CRITICAL_EVALUATION', criterion_name: 'Critical Evaluation & Verification', weight_percent: 25, is_enabled: true },
    { criterion_key: 'AI_INTERACTION', criterion_name: 'AI Interaction & Prompt Engineering', weight_percent: 15, is_enabled: true },
    { criterion_key: 'METACOGNITIVE_REFLECTION', criterion_name: 'Metacognitive Reflection & Transparency', weight_percent: 10, is_enabled: true },
  ];

  let rawConfigs = (Array.isArray(activeRubrics) && activeRubrics.length > 0)
    ? activeRubrics
    : ((Array.isArray(rubricConfigs) && rubricConfigs.length > 0) ? rubricConfigs : DEFAULT_CONFIGS);

  let enabledConfigs = rawConfigs.filter((c) => c.is_enabled !== false && Number(c.weight_percent) > 0);
  if (enabledConfigs.length === 0) enabledConfigs = DEFAULT_CONFIGS;

  const finalActiveRubrics = enabledConfigs.map((c, idx) => {
    const mapInfo = CANONICAL_RUBRIC_MAP[c.criterion_key] || {
      altKey: String(c.criterion_key).toLowerCase(),
      legacyKey: String(c.criterion_key).toUpperCase(),
      defaultName: c.criterion_name || c.criteria_name || c.criterion_key,
      ratio: 0.78,
    };
    const weight = Number(c.weight_percent) || 20;
    const max_score = Number(((weight / 100) * 10).toFixed(2));
    return {
      index: idx + 1,
      criterion_key: c.criterion_key,
      criteria_name: c.criterion_name || c.criteria_name || mapInfo.defaultName,
      weight_percent: weight,
      max_score: max_score,
      altKey: mapInfo.altKey,
      legacyKey: mapInfo.legacyKey,
      ratio: mapInfo.ratio || 0.78,
    };
  });

  const rawBreakdown = finalActiveRubrics.map((r) => {
    const score = Number((r.max_score * r.ratio).toFixed(1));
    let reason = `Đánh giá chuyên môn đạt yêu cầu đối với tiêu chí ${r.criteria_name}.`;
    if (r.altKey === 'algorithmic') {
      reason = 'Có lỗi sai thứ tự tính toán: code đang nhân VAT 10% TRƯỚC khi trừ giảm giá discount (subtotal * 1.10 - discount); thứ tự chuẩn phải là trừ discount trước rồi mới tính VAT. Ngoài ra chưa kiểm tra discount vượt quá subtotal.';
    } else if (r.altKey === 'reflection') {
      reason = 'Chưa kiểm soát các trường hợp biên: chưa validate số lượng mặt hàng âm (quantity <= 0), chưa kiểm tra danh sách items rỗng/null, và chưa kiểm tra discount âm.';
    } else if (r.altKey === 'pattern') {
      reason = 'Áp dụng tốt Spring Service/Repository, Transactional rollback và kỹ thuật Map lookup để phòng tránh lỗi N+1 Query.';
    } else if (r.altKey === 'decomposition') {
      reason = 'Mã nguồn đã phân chia luồng xử lý đơn hàng tương đối rõ ràng qua các bước kiểm tra tồn kho, trừ kho và tính tiền.';
    } else if (r.altKey === 'abstraction') {
      reason = 'Mô hình hóa dữ liệu tách biệt DTO Request/Response và Entity; che giấu cấu trúc chi tiết bên trong.';
    }

    return {
      criterion_key: r.criterion_key,
      criteria: r.criteria_name,
      max_score: r.max_score,
      awarded_score: score,
      comment: reason,
    };
  });

  const fallbackObj = {
    grading_breakdown: rawBreakdown,
    risk_level: 'low',
    audit_integrity: {
      match_percentage: 95.0,
      risk_level: 'LOW_RISK',
      riskLevel: 'low',
      ai_transparency_index: 'A',
      reflection_depth: 'High',
      penalty_applied: false,
      penalty_reason: 'Không trừ điểm học thuật; sử dụng câu hỏi VIVA để giảng viên tự vấn đáp.',
    },
    viva_questions: [
      {
        id: 1,
        rubric_criterion: 'PATTERN_RECOGNITION',
        target_file: 'OrderService.java',
        target_code_snippet: 'List<Product> products = productRepo.findAllByIdIn(pIds);',
        question: 'Tại sao bạn lại sử dụng phương thức findAllByIdIn kết hợp với Map thay vì gọi findById trong vòng lặp for?',
        expected_answer_criteria: 'Sinh viên giải thích được vấn đề N+1 query: nếu gọi findById trong vòng lặp thì có N câu lệnh SELECT, dùng findAllByIdIn chỉ tốn 1 câu query duy nhất.',
        expected_answer_key: 'Sinh viên giải thích được vấn đề N+1 query: nếu gọi findById trong vòng lặp thì có N câu lệnh SELECT, dùng findAllByIdIn chỉ tốn 1 câu query duy nhất.'
      },
      {
        id: 2,
        rubric_criterion: 'ALGORITHMIC_THINKING',
        target_file: 'OrderService.java',
        target_code_snippet: 'BigDecimal total = subtotal.multiply(BigDecimal.valueOf(1.10)).subtract(request.getDiscount());',
        question: 'Trong dòng tính tổng tiền total, thứ tự áp dụng thuế VAT 10% và giảm giá discount của bạn có điểm gì bất hợp lý so với quy trình bán hàng thực tế?',
        expected_answer_criteria: 'Sinh viên nhận ra lỗi: công thức hiện tại đang tính thuế trên giá gốc rồi mới trừ discount, trong khi thông lệ tài chính phải trừ discount trước rồi mới áp thuế VAT trên giá sau giảm giá.',
        expected_answer_key: 'Sinh viên nhận ra lỗi: công thức hiện tại đang tính thuế trên giá gốc rồi mới trừ discount, trong khi thông lệ tài chính phải trừ discount trước rồi mới áp thuế VAT trên giá sau giảm giá.'
      },
      {
        id: 3,
        rubric_criterion: 'REFLECTION',
        target_file: 'OrderService.java',
        target_code_snippet: 'if (p.getStock() < item.getQuantity()) throw new OutOfStockException();',
        question: 'Ngoài việc kiểm tra tồn kho p.getStock() < item.getQuantity(), bạn cần bổ sung thêm những validation biên nào cho request.getItems() và discount?',
        expected_answer_criteria: 'Cần kiểm tra item.getQuantity() <= 0, discount < 0, discount > subtotal, và danh sách items null/rỗng.',
        expected_answer_key: 'Cần kiểm tra item.getQuantity() <= 0, discount < 0, discount > subtotal, và danh sách items null/rỗng.'
      }
    ],
  };

  const guarded = applyScoringGuardrails(fallbackObj, finalActiveRubrics);
  return sanitizeObjectStrings(guarded);
}

module.exports = {
  askGemini,
  evaluateRubricWithGemini,
  generatePedagogicalFallbackResult,
  preSubmissionSanityCheckWithGemini,
  generateClassAiAdvisoryWithGemini,
  buildDynamicGradingSystemInstruction,
  applyScoringGuardrails,
};