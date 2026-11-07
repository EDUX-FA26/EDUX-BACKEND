require("dotenv").config();
const { GoogleGenAI, HarmCategory, HarmBlockThreshold, Type } = require("@google/genai");

const clients = new Map();

async function getGeminiClient(apiKey = process.env.GEMINI_API_KEY) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!clients.has(key)) {
    clients.set(key, new GoogleGenAI({ apiKey: key }));
  }

  return clients.get(key);
}

async function askGemini(prompt) {
  const ai = await getGeminiClient();

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL,
    contents: prompt
  });

  return response.text;
}

/**
 * 2. Hàm chuyên dụng: Thẩm định kiểm toán mã nguồn SE/IT, đối soát chéo và chấm điểm Rubric 5 tiêu chí kèm Bộ câu hỏi Viva
 * @param {Object} data Dữ liệu bài tập & bài nộp
 * @param {string} data.assignmentInfo Mô tả yêu cầu đề bài SE/IT
 * @param {string} data.sourceCode Mã nguồn hoặc cấu trúc file dự án thực tế
 * @param {string} data.gitHistory Lịch sử Git commit thực tế
 * @param {string} data.aiAuditSummary Tóm tắt mức độ phụ thuộc AI và các tool AI sinh viên đã khai báo
 * @param {string} data.oralExamLogs Bản ghi câu hỏi - câu trả lời trong phiên vấn đáp Viva (nếu có)
 */
async function evaluateRubricWithGemini({ assignmentInfo, sourceCode, gitHistory, aiAuditSummary, oralExamLogs }) {
  // Lấy SDK Type từ import động


  // Ưu tiên key audit riêng để tránh quá tải key chính
  const auditKey = process.env.GEMINI_API_KEY_AUDIT || process.env.GEMINI_API_KEY;
  if (!auditKey) {
    throw new Error("GEMINI_API_KEY_MISSING: Chưa cấu hình GEMINI_API_KEY_AUDIT hoặc GEMINI_API_KEY trong file .env");
  }

  const ai = await getGeminiClient(auditKey);

  const systemInstruction = `Bạn là Hội đồng Khảo thí & Chuyên gia Kỹ thuật Phần mềm (Senior Software Architect / Academic Auditor).
Bạn CHỈ đánh giá các đồ án, bài tập thực hành thuộc ngành Kỹ thuật Phần mềm (SE) và Công nghệ thông tin (IT) (Web, Mobile, Backend, Frontend, Cloud/DevOps, System Tools, Thuật toán, Database).

A. NGUYÊN TẮC CHẤM ĐIỂM & ĐỐI CHIẾU AI AUDIT ĐA PHÂN RÃ (MULTI-SCOPE HEURISTICS):
1. QUY MÔ BÀI TOÁN & TÍNH PHÂN RÃ (DECOMPOSITION BONUS):
   - Nếu bài toán quy mô lớn (fullstack, web, app nhiều luồng, microservices) mà sinh viên biết chủ động phân rã thành các Scope kỹ thuật rõ ràng (Backend, Frontend, DB, Architecture):
     -> Đánh giá rất cao tư duy kiến trúc phần mềm, ưu tiên cho điểm tối đa ở tiêu chí 'decomposition' (2.0/2.0) và 'abstraction' (2.0/2.0).
   - Nếu đề bài yêu cầu hệ thống lớn nhưng sinh viên chỉ khai báo 1 scope chung chung, gom mờ nhạt:
     -> Trừ 30% - 50% điểm ở tiêu chí 'decomposition' vì thiếu năng lực phân rã bài toán kỹ thuật.
   - LƯU Ý QUAN TRỌNG: Nếu đề bài thực tế là bài tập nhỏ / chức năng đơn lẻ (Single Scope Task), sinh viên khai báo 1 scope là hoàn toàn phù hợp và KHÔNG bị trừ điểm phân rã.

2. THANH TRA CHI TIẾT TỪNG SCOPE:
   - Kiểm tra xem mô tả 'scope_description' có khớp với mã nguồn thực tế của từng thư mục trong dự án hay không (ví dụ: BE khớp với controllers/services; FE khớp với components/pages; DB khớp với migrations/schemas).
   - Đối chiếu tool và phản tư ở từng scope tương ứng với đặc thù kỹ thuật.

3. TRƯỜNG HỢP KIỂM TOÁN TƯƠNG TÁC AI:
   - Dùng AI nhiều (> 60% code do AI sinh): Hoàn toàn hợp lệ nếu sinh viên minh bạch qua từng Scope. Trọng tâm câu hỏi Viva xoáy sâu vào "Code Ownership & Architectural Decisions", yêu cầu giải thích luồng dữ liệu (data flow) và bảo mật.
   - Dùng AI ít hoặc tự code 100%: Đối chiếu với AST Code. Nếu code có pattern điển hình của LLM mà không khai báo -> Gắn cờ "Suspicious Discrepancy", trừ mạnh điểm 'reflection'.
   - Khai báo Prompt sơ sài, lặp lại giữa các Scope: Kỹ năng prompt engineering kém, trừ điểm tiêu chí 'reflection' và 'decomposition'.

B. BỘ CÂU HỎI VẤN ĐÁP VIVA (BẮT BUỘC ĐÚNG FILE & CODE THỰC TẾ):
- Sinh chính xác 3 câu hỏi vấn đáp Viva kỹ thuật:
  + CÂU HỎI 1 (Architecture & Scope Interconnection / Decomposition): Nhắm vào ranh giới giữa các Scope, cấu trúc thư mục, Clean Architecture, hoặc luồng truyền dữ liệu liên kết giữa các module.
  + CÂU HỎI 2 (Code Logic & Edge Cases): Nhắm vào đoạn logic phức tạp nhất hoặc xử lý ngoại lệ trong file code chính (async/await, transaction, validation, state management).
  + CÂU HỎI 3 (AI Reflection & Trade-offs): Nhắm trực tiếp vào phần code sinh viên khai báo AI hỗ trợ (hoặc đoạn code nghi vấn) để hỏi về đánh đổi hiệu năng (time/space complexity) và phương án tối ưu.
- RÀNG BUỘC ĐỊNH DẠNG:
  + Mỗi câu hỏi phải chỉ rõ: Tên file chính xác (target_file), đoạn mã nguồn ngắn gọn tối đa 3-5 dòng (target_code_snippet), nội dung câu hỏi (question), và gợi ý câu trả lời kỳ vọng (expected_answer_criteria).
  + KHÔNG ĐƯỢC sinh câu hỏi về các công nghệ không có trong bài nộp.

C. BỘ TIÊU CHÍ RUBRIC ĐÁNH GIÁ (Thang điểm 10):
Chấm điểm 5 tiêu chí Rubric dựa trên sự phối hợp của tất cả các Scope đã khai báo so với mã nguồn thực tế:
1. decomposition: Problem Decomposition & Scope Architecture (Max: 2.0) - Khả năng chia tách bài toán thành các module kỹ thuật logic.
   * QUY ĐỊNH 'reasoning': Nêu rõ nhận xét về cách sinh viên chia Scope có khớp với cấu trúc thư mục thực tế hay không.
2. pattern_recognition: Pattern Recognition & Architecture Patterns (Max: 2.0) - Nhận diện mẫu kiến trúc và thiết kế phù hợp (Repository, MVC, Component-driven...).
3. abstraction: Abstraction & System Modeling (Max: 2.0) - Mô hình hóa thực thể, giao diện API, lược đồ C4/ERD tương ứng.
4. algorithmic_thinking: Algorithmic Thinking, Logic & Data Flow (Max: 2.5) - Luồng dữ liệu, thuật toán xử lý nghiệp vụ cụ thể trong từng module.
5. reflection: Reflection, Trade-offs & Code Ownership (Max: 1.5) - Khả năng phản tư, đánh giá trade-off khi ứng dụng AI, mức độ làm chủ code.
- Reasoning: Nêu rõ bằng chứng cụ thể từ bài làm (file, hàm, scope log) lý giải điểm số.

D. QUY ĐỊNH NGÔN NGỮ TIẾNG VIỆT CÓ DẤU 100% (BẮT BUỘC):
- TOÀN BỘ nội dung phản hồi (bao gồm overall_verdict, reasoning, question, expected_answer_criteria, penalty_reason) BẮT BUỘC phải viết bằng Tiếng Việt chuẩn có dấu (UTF-8), hành văn học thuật, sư phạm, chuyên nghiệp.
- Tuyệt đối KHÔNG trả về tiếng Việt không dấu (như 'Khong dat', 'Bai nop khong dat yeu cau', 'Pass', 'Fail' trơ trọi).
- Tuyệt đối KHÔNG dùng ký tự viết tắt, telex, ký hiệu VIQR, hoặc ký tự escape TeX (như B\"ai, n\"op, \"d\"at, kh\"ong, y\"eu, c\"au). Toàn bộ dấu tiếng Việt phải là ký tự Unicode chuẩn tự nhiên (ví dụ: 'Bài nộp đạt yêu cầu', 'Kiến trúc phân tầng rõ ràng', 'Không phát hiện sai lệch').

E. CẤU TRÚC BẮT BUỘC CỦA 'overall_verdict' (KẾT LUẬN THANH TRA & VẤN ĐÁP):
- TUYỆT ĐỐI KHÔNG chỉ trả về mỗi trạng thái (Pass/Fail) đơn lẻ hoặc câu ngắn cụt lủn (ví dụ: cấm trả về 'Khong dat (Fail)' hoặc 'Dat (Pass)').
- BẮT BUỘC trả về một bản tóm tắt phân tích hoàn chỉnh từ 3 đến 5 câu văn rõ ràng, liên kết mạch lạc, hành văn học thuật chuẩn mực theo đúng cấu trúc 3 phần sau:
  1. [Kết luận & Trạng thái]: Đánh giá tổng quan bài nộp Đạt (Pass) hay Chưa đạt (Fail / Flagged) kèm mức độ rủi ro liêm chính học thuật (Rủi ro Thấp / Trung bình / Cao).
  2. [Phân tích đối soát]: So sánh cụ thể giữa mã nguồn thực tế trong dự án và nội dung sinh viên đã khai báo trong nhật ký AI Audit Log (các scope, prompt, phản tư) — chỉ ra các điểm khớp nhau hay có mâu thuẫn/dấu hiệu bất thường.
  3. [Điểm cần lưu ý & Khuyến nghị vấn đáp]: Chỉ rõ đoạn code, module, file hoặc chức năng nghi vấn mà Giảng viên nên hỏi trực tiếp sinh viên khi vấn đáp để thẩm định tính trung thực và mức độ làm chủ mã nguồn.`;

  const prompt = `
Bạn hãy thẩm định bài nộp thuộc chuyên ngành Kỹ thuật Phần mềm (SE) / CNTT (IT) dưới đây, đối chiếu toàn bộ các Scope khai báo AI với mã nguồn thực tế và chấm điểm Rubric 5 tiêu chí cùng Bộ 3 câu hỏi vấn đáp Viva:

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
`;

  // Cấu hình Schema bắt buộc Gemini trả về đúng khuôn JSON theo yêu cầu
  const rubricResponseSchema = {
    type: Type.OBJECT,
    properties: {
      audit_integrity: {
        type: Type.OBJECT,
        properties: {
          match_percentage: { type: Type.NUMBER },
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
        required: ["match_percentage", "ai_transparency_index", "reflection_depth", "penalty_applied", "penalty_reason"]
      },
      viva_questions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.INTEGER },
            rubric_criterion: {
              type: Type.STRING,
              enum: [
                "decomposition",
                "pattern_recognition",
                "abstraction",
                "algorithmic_thinking",
                "reflection",
                "implementation",
                "verification",
                "ai_interaction"
              ]
            },
            target_file: { type: Type.STRING },
            target_code_snippet: { type: Type.STRING },
            question: { type: Type.STRING },
            expected_answer_criteria: { type: Type.STRING }
          },
          required: ["id", "rubric_criterion", "target_file", "target_code_snippet", "question", "expected_answer_criteria"]
        }
      },
      rubrics: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            criterion_id: { type: Type.STRING },
            criterion_name: { type: Type.STRING },
            score: { type: Type.NUMBER },
            max_score: { type: Type.NUMBER },
            reasoning: { type: Type.STRING }
          },
          required: ["criterion_id", "criterion_name", "score", "max_score", "reasoning"]
        }
      },
      total_score: { type: Type.NUMBER },
      overall_verdict: {
        type: Type.STRING,
        description: "Bản tóm tắt kết luận thanh tra & vấn đáp chi tiết từ 3-5 câu văn rõ ràng bằng Tiếng Việt chuẩn có dấu (UTF-8), phân tích đối soát mã nguồn và khuyến nghị vấn đáp cho giảng viên."
      }
    },
    required: ["audit_integrity", "viva_questions", "rubrics", "total_score", "overall_verdict"]
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

  const primaryModel = process.env.GEMINI_MODEL_AUDIT || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const fallbackModel = "gemini-3.5-flash-lite";

  let response;
  try {
    response = await ai.models.generateContent({
      model: primaryModel,
      contents: prompt,
      config: generateConfig,
    });
  } catch (err) {
    if (primaryModel !== fallbackModel && (err.status === 503 || err.status === 429 || err.status === 404)) {
      console.warn(`[Gemini Audit] Model ${primaryModel} gặp lỗi (${err.status || err.message}), tự động chuyển sang ${fallbackModel}...`);
      response = await ai.models.generateContent({
        model: fallbackModel,
        contents: prompt,
        config: generateConfig,
      });
    } else {
      throw err;
    }
  }

  const parsed = JSON.parse(response.text);

  // Nâng cấp chi tiết và chuẩn hóa tiếng Việt cho overall_verdict nếu AI trả về chuỗi ngắn cụt lủn hoặc thiếu dấu
  if (parsed.overall_verdict || parsed.ai_verdict) {
    const rawVerdict = String(parsed.overall_verdict || parsed.ai_verdict || '').trim();
    if (rawVerdict.length < 50 || rawVerdict.toLowerCase().startsWith('khong dat') || rawVerdict.toLowerCase().startsWith('chua dat') || rawVerdict.toLowerCase() === 'dat (pass)' || rawVerdict.toLowerCase() === 'khong dat (fail)') {
      const isFailed = rawVerdict.toLowerCase().includes('khong') || rawVerdict.toLowerCase().includes('chua') || rawVerdict.toLowerCase().includes('fail') || parsed.audit_integrity?.penalty_applied;
      const riskLevel = parsed.audit_integrity?.reflection_depth === 'Suspicious' ? 'Mức độ rủi ro liêm chính: Cao' : (isFailed ? 'Mức độ rủi ro liêm chính: Trung bình' : 'Mức độ rủi ro liêm chính: Thấp');

      const detailedVerdict = isFailed
        ? `Kết luận thanh tra: Chưa đạt (Fail / Flagged) - ${riskLevel}. Quá trình đối soát chéo phát hiện sự sai lệch hoặc thiếu minh bạch giữa mã nguồn thực tế bài nộp và nội dung sinh viên đã kê khai trong nhật ký AI Audit. Khuyến nghị Giảng viên tập trung phỏng vấn sinh viên về các đoạn mã nguồn then chốt và các quyết định kiến trúc được chỉ định trong danh sách câu hỏi vấn đáp Viva bên dưới để kiểm chứng quyền tác giả mã nguồn.`
        : `Kết luận thanh tra: Đạt (Pass) - ${riskLevel}. Mã nguồn thực tế có cấu trúc phân tầng và giải thuật tương đồng cao với nội dung sinh viên đã giải trình trong nhật ký AI Audit. Giảng viên nên tiến hành vấn đáp sinh viên theo các câu hỏi kỹ thuật bên dưới để củng cố đánh giá về mức độ làm chủ mã nguồn và năng lực phản tư công nghệ.`;

      parsed.overall_verdict = detailedVerdict;
      parsed.ai_verdict = detailedVerdict;
    }
  }

  // Đảm bảo tương thích ngược và cả hai trường tên đều tồn tại
  if (!parsed.ai_verdict && parsed.overall_verdict) {
    parsed.ai_verdict = parsed.overall_verdict;
  }
  if (!parsed.overall_verdict && parsed.ai_verdict) {
    parsed.overall_verdict = parsed.ai_verdict;
  }

  // Chuẩn hóa viva_questions: đảm bảo có đầy đủ expected_answer_criteria và expected_answer_key
  if (Array.isArray(parsed.viva_questions)) {
    parsed.viva_questions.forEach(q => {
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

  // Đảm bảo cả short_reason và reasoning đều tồn tại trong từng rubric item
  if (parsed.rubrics && Array.isArray(parsed.rubrics)) {
    parsed.rubrics.forEach(r => {
      if (!r.short_reason && r.reasoning) r.short_reason = r.reasoning;
      if (!r.reasoning && r.short_reason) r.reasoning = r.short_reason;
    });
  }

  return sanitizeObjectStrings(parsed);
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
  "micro_suggestions": ["string"],
  "tone_message": "string"
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
      },
      tone_message: {
        type: Type.STRING,
        description: "Lời nhắn khích lệ học tập tích cực, mang tính sư phạm và xây dựng"
      }
    },
    required: ["relevance_status", "relevance_reason", "diagnostic_warnings", "micro_suggestions", "tone_message"]
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

  const primaryModel = process.env.GEMINI_MODEL_PRE_CHECK_SUBMIT || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const fallbackModel = "gemini-3.5-flash-lite";

  let response;
  try {
    response = await ai.models.generateContent({
      model: primaryModel,
      contents: prompt,
      config: generateConfig,
    });
  } catch (err) {
    if (primaryModel !== fallbackModel && (err.status === 503 || err.status === 429 || err.status === 404)) {
      console.warn(`[Gemini Sanity Check] Model ${primaryModel} gặp lỗi, chuyển sang ${fallbackModel}...`);
      response = await ai.models.generateContent({
        model: fallbackModel,
        contents: prompt,
        config: generateConfig,
      });
    } else {
      throw err;
    }
  }

  const parsed = JSON.parse(response.text);
  return sanitizeObjectStrings(parsed);
}

module.exports = {
  askGemini,
  evaluateRubricWithGemini,
  preSubmissionSanityCheckWithGemini,
};