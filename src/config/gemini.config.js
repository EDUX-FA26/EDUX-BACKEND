require("dotenv").config();

const clients = new Map();

async function getGeminiClient(apiKey = process.env.GEMINI_API_KEY) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!clients.has(key)) {
    const promise = import("@google/genai").then(
      ({ GoogleGenAI }) =>
        new GoogleGenAI({
          apiKey: key
        })
    );
    clients.set(key, promise);
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
  const { Type } = await import("@google/genai");

  // Ưu tiên key audit riêng để tránh quá tải key chính
  const auditKey = process.env.GEMINI_API_KEY_AUDIT || process.env.GEMINI_API_KEY;
  if (!auditKey) {
    throw new Error("GEMINI_API_KEY_MISSING: Chưa cấu hình GEMINI_API_KEY_AUDIT hoặc GEMINI_API_KEY trong file .env");
  }

  const ai = await getGeminiClient(auditKey);

  const systemInstruction = `Bạn là Hội đồng Khảo thí & Chuyên gia Kỹ thuật Phần mềm (Senior Software Architect / Academic Auditor).
Bạn CHỈ đánh giá các đồ án, bài tập thực hành thuộc ngành Kỹ thuật Phần mềm (SE) và Công nghệ thông tin (IT) (Web, Mobile, Backend, Frontend, Cloud/DevOps, System Tools, Thuật toán, Database).

A. QUY TẮC ĐỐI CHIẾU AI AUDIT LOG & ĐẶC THÙ NGÀNH SE/IT:
1. Trường hợp 1 - Khai báo dùng AI nhiều (> 60% code do AI sinh):
   - Đánh giá: Đây là điều hoàn toàn hợp lệ nếu sinh viên minh bạch.
   - Trọng tâm câu hỏi Viva: Xoáy sâu vào "Code Ownership & Architectural Decisions". Sinh viên phải giải thích được tại sao AI lại chọn pattern này, luồng thực thi dữ liệu (data flow), cơ chế xử lý bộ nhớ/concurrency, rủi ro bảo mật (security vulnerabilities, injection, memory leak) của đoạn code mà AI đã sinh.
   - Điểm Rubric: Nếu sinh viên kiểm thử kỹ (có test cases, validation, xử lý edge case) và phản tư tốt -> Cho điểm cao ở 'verification' và 'reflection'.
2. Trường hợp 2 - Khai báo dùng AI ít hoặc tự code 100%:
   - Đánh giá: Đối chiếu với AST Code. Nếu code có các pattern điển hình của LLM (format comment dày đặc bất thường, naming convention kiểu GPT, dùng các hàm tiện ích phức tạp đột ngột) mà không khai báo -> Gắn cờ "Suspicious Discrepancy", trừ mạnh điểm 'reflection' và 'ai_interaction'.
   - Trọng tâm câu hỏi Viva: Yêu cầu giải thích thuật toán cốt lõi, cơ chế bắt ngoại lệ, luồng chạy từng dòng (dry run) của đoạn code nghi vấn để kiểm tra sinh viên có tự viết thật hay không.
3. Trường hợp 3 - Khai báo Prompt sơ sài ("viết code giúp em", prompt 1 câu copy đề bài, hoặc copy-paste lặp lại giữa các phase mà không chỉ rõ code cụ thể):
   - Đánh giá: Kỹ năng prompt engineering kém, không có tính lặp (iterative refinement).
   - Điểm 'ai_interaction' tối đa chỉ đạt mức 30-40% (tối đa 0.6/1.5).
   - Trọng tâm câu hỏi Viva: Hỏi về các lỗi tiềm ẩn mà AI tạo ra khi nhận prompt mơ hồ đó.

B. BỘ CÂU HỎI VẤN ĐÁP VIVA (BẮT BUỘC ĐÚNG FILE & CODE THỰC TẾ):
- Sinh chính xác 3 câu hỏi vấn đáp Viva kỹ thuật:
  + Câu 1 (Architecture & Decomposition): rubric_criterion: "abstraction". Nhắm vào cấu trúc thư mục, Clean Architecture, việc tách hàm/module, cách quản lý state/config trong bài làm.
  + Câu 2 (Code Logic & Edge Cases): rubric_criterion: "implementation". Nhắm vào đoạn logic phức tạp nhất trong file code chính (ví dụ: async/await, multi-threading, polling/event-driven, I/O handling, data validation).
  + Câu 3 (AI Reflection & Trade-offs): rubric_criterion: "reflection". Nhắm trực tiếp vào phần code sinh viên khai báo AI hỗ trợ (hoặc đoạn code nghi vấn) để hỏi về đánh đổi hiệu năng (time/space complexity) và phương án cải tiến.
- Mỗi câu hỏi phải chỉ rõ: Tên file (target_file), vị trí/hàm cụ thể (target_code_snippet), nội dung câu hỏi (question), và gợi ý câu trả lời kỳ vọng (expected_answer_criteria) để giảng viên đối chiếu nhanh.
- KHÔNG ĐƯỢC sinh câu hỏi về các công nghệ không có trong bài nộp (ví dụ bài Python desktop tool thì KHÔNG ĐƯỢC hỏi về MongoDB, HttpOnly Cookie nếu code không dùng).

C. BỘ RUBRIC 5 TIÊU CHÍ SE/IT (Thang 10):
1. abstraction: Problem Abstraction & Architectural Design (Max: 2.0)
2. implementation: Implementation, Clean Code & Error Handling (Max: 3.0)
3. verification: Functionality, Testability & Edge Cases (Max: 2.5)
4. ai_interaction: AI Prompting & Iterative Refinement (Max: 1.5)
5. reflection: Code Ownership & AI Transparency (Max: 1.0)
- Reasoning: Nêu rõ bằng chứng cụ thể từ bài làm (file, hàm, log) lý giải điểm số.`;

  const prompt = `
Bạn hãy thẩm định bài nộp thuộc chuyên ngành Kỹ thuật Phần mềm (SE) / CNTT (IT) dưới đây, đối chiếu lời khai AI với mã nguồn thực tế và chấm điểm Rubric 5 tiêu chí cùng Bộ 3 câu hỏi vấn đáp Viva:

--- THÔNG TIN ĐỐI SOÁT CHÉO THỰC TẾ ---
[1. YÊU CẦU ĐỀ BÀI SE/IT]:
${assignmentInfo || "Xây dựng ứng dụng phần mềm theo đặc tả yêu cầu."}

[2. DANH SÁCH TẬP TIN, CẤU TRÚC AST VÀ MÃ NGUỒN BÀI NỘP]:
${sourceCode || "Không tìm thấy mã nguồn trong bài nộp."}

[3. LỊCH SỬ GIT COMMIT THỰC TẾ]:
${gitHistory || "Không tìm thấy lịch sử Git commit."}

[4. KẾT QUẢ THANH TRA & KHAI BÁO AI CỦA SINH VIÊN (AI AUDIT LOGS)]:
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
              enum: ["abstraction", "implementation", "reflection"]
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
      overall_verdict: { type: Type.STRING }
    },
    required: ["audit_integrity", "viva_questions", "rubrics", "total_score", "overall_verdict"]
  };

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL_AUDIT || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    contents: prompt,
    config: {
      systemInstruction,
      temperature: 0.1, // Nhiệt độ thấp giúp tính toán và phân tích logic ổn định
      responseMimeType: "application/json",
      responseSchema: rubricResponseSchema,
    },
  });

  const parsed = JSON.parse(response.text);

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

  return parsed;
}

module.exports = {
  askGemini,
  evaluateRubricWithGemini,
};