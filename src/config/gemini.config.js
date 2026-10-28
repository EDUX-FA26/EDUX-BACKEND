
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
 * 2. Hàm chuyên dụng: Thẩm định kiểm toán mã nguồn, đối soát chéo và chấm điểm Rubric 5 tiêu chí kèm Bộ câu hỏi Viva
 * @param {Object} data Dữ liệu bài tập & bài nộp
 * @param {string} data.assignmentInfo Mô tả yêu cầu đề bài
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

  const systemInstruction = `Bạn là Trưởng ban Thanh tra Học thuật CNTT. Nhiệm vụ của bạn là thanh tra mã nguồn, đối chiếu lời khai AI của sinh viên với AST Code thực tế, và đưa ra quyết định chấm điểm Rubric 5 tiêu chí cùng Bộ câu hỏi vấn đáp Viva tương ứng.

QUY TẮC RÀNG BUỘC LOGIC BẮT BUỘC (CRITICAL GRADING RULES):
1. RÀNG BUỘC VỀ AUDIT LOG & ĐỘ TRUNG THỰC:
   - Nếu sinh viên KHÔNG nộp hoặc nộp Audit Log sơ sài, lời khai chung chung (hoặc copy-paste lặp lại giữa các phase mà không chỉ rõ hàm/code cụ thể): Tiêu chí 'reflection' và 'ai_interaction' KHÔNG ĐƯỢC VƯỢT QUÁ 40% điểm tối đa của tiêu chí đó (reflection <= 0.4/1.0, ai_interaction <= 0.6/1.5).
   - Nếu phát hiện 'Code Inconsistency' (khai báo tự code nhưng code chứa patterns của LLM, hoặc không có commit logs phát triển từng bước, commit 1 lần duy nhất một khối code khổng lồ, hoặc lời khai báo lạc đề / copy-paste chung chung không khớp với công nghệ và mã nguồn thực tế): Tổng điểm bài làm KHÔNG ĐƯỢC VƯỢT QUÁ 6.0/10 dù code có chạy hoàn hảo. Phải đặt penalty_applied: true và ghi rõ penalty_reason.
   - Chỉ cho điểm tối đa ở tiêu chí Reflection (1.0/1.0) và AI Interaction (1.5/1.5) khi sinh viên chứng minh được quá trình: Đưa prompt có ngữ cảnh -> AI sinh code -> Sinh viên chủ động refactor/bắt lỗi -> Có phản tư rõ ràng về ưu/nhược điểm giải pháp.

2. SINH BỘ CÂU HỎI VẤN ĐÁP VIVA (BÁM SÁT 100% VÀO CODE THỰC TẾ):
   - KHÔNG ĐƯỢC sinh câu hỏi về các công nghệ không có trong bài nộp (ví dụ bài Python screenshot thì TUYỆT ĐỐI KHÔNG hỏi về MongoDB, Docker, HttpOnly Cookies nếu code không dùng).
   - Hãy soi vào đúng các hàm, biến, thư viện có trong code bài nộp để đặt 3 câu hỏi xoáy vào bản chất:
     * Câu 1: Xoáy vào 1 đoạn code phức tạp nhất nghi ngờ do AI viết (Hỏi về luồng hoạt động, xử lý thread/bộ nhớ/lock).
     * Câu 2: Xoáy vào lý do chọn thư viện hoặc quyết định kiến trúc so với phương án khác.
     * Câu 3: Tình huống edge case (Nếu ứng dụng gặp lỗi X hoặc thay đổi môi trường Y thì hàm Z sẽ xử lý thế nào?).

3. GIẢI TRÌNH NGẮN GỌN (REASONING):
   - Phần giải thích cho mỗi tiêu chí phải nêu rõ BẰNG CHỨNG CỤ THỂ từ bài làm (Ví dụ: 'Trừ 0.5đ tiêu chí implementation vì hàm capture_window() thiếu xử lý ngoại lệ khi cửa sổ bị minimize', thay vì nhận xét chung chung).`;

  const prompt = `
Hãy thanh tra mã nguồn, đối soát chéo và chấm điểm bài nộp theo đúng 5 tiêu chí Rubric chuẩn:
1. abstraction: Problem Abstraction & Decomposition (Tối đa 2.0đ)
2. implementation: Implementation & Code Quality (Tối đa 3.0đ)
3. verification: Functionality & Verification (Tối đa 2.5đ)
4. ai_interaction: AI Interaction Quality (Tối đa 1.5đ)
5. reflection: Reflection & Ownership (Tối đa 1.0đ)

--- DỮ LIỆU ĐỐI SOÁT CHÉO THỰC TẾ ---
[1. YÊU CẦU ĐỀ BÀI & KỸ THUẬT]:
${assignmentInfo || "Xây dựng ứng dụng theo đặc tả đề bài."}

[2. MÃ NGUỒN VÀ TẬP TIN NỘP THỰC TẾ (CODE & AST SUMMARY)]:
${sourceCode || "Không có mã nguồn đính kèm."}

[3. LỊCH SỬ GIT COMMIT THỰC TẾ (GIT COMMIT HISTORY)]:
${gitHistory || "Không có lịch sử Git đi kèm trong gói bài nộp."}

[4. KẾT QUẢ THANH TRA & LỜI KHAI BÁO AI CỦA SINH VIÊN (AI AUDIT DECLARATIONS)]:
${aiAuditSummary || "Chưa có dữ liệu khai báo sử dụng AI."}

[5. BẢN GHI PHIÊN VẤN ĐÁP NẾU ĐÃ CÓ (VIVA Q&A LOGS)]:
${oralExamLogs || "Chưa thực hiện vấn đáp Viva trực tiếp."}
`;

  // Cấu hình Schema bắt buộc Gemini trả về đúng khuôn JSON
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
            target_file: { type: Type.STRING },
            target_code_snippet: { type: Type.STRING },
            question: { type: Type.STRING },
            expected_answer_key: { type: Type.STRING }
          },
          required: ["id", "target_file", "target_code_snippet", "question", "expected_answer_key"]
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
      ai_verdict: { type: Type.STRING }
    },
    required: ["audit_integrity", "viva_questions", "rubrics", "total_score", "ai_verdict"]
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