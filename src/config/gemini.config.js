
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
 * 2. Hàm chuyên dụng: Chấm điểm Rubric 5 tiêu chí (dùng Key Audit riêng biệt)
 * @param {Object} data Dữ liệu bài tập & bài nộp
 * @param {string} data.assignmentInfo Mô tả yêu cầu đề bài
 * @param {string} data.sourceCode Mã nguồn hoặc cấu trúc file dự án
 * @param {string} data.aiLogs Nhật ký prompt hoặc báo cáo phản tư của sinh viên
 */
async function evaluateRubricWithGemini({ assignmentInfo, sourceCode, aiLogs }) {
  // Lấy SDK Type từ import động
  const { Type } = await import("@google/genai");

  // Ưu tiên key audit riêng để tránh quá tải key chính
  const auditKey = process.env.GEMINI_API_KEY_AUDIT || process.env.GEMINI_API_KEY;
  const ai = await getGeminiClient(auditKey);

  const systemInstruction = `Bạn là chuyên gia thẩm định liêm chính học thuật và đánh giá mã nguồn CNTT. 
Hãy phân tích kỹ mã nguồn, tài liệu dự án và log tương tác với AI của sinh viên để cho điểm chính xác theo bộ Rubric 5 tiêu chí. 
Chỉ phản hồi đúng cấu trúc JSON theo schema được cung cấp.`;

  const prompt = `
Hãy chấm điểm bài nộp dựa trên 5 tiêu chí Rubric (Thang điểm 10):
1. abstraction (Problem Abstraction & Decomposition) - Tối đa: 2.0 điểm
2. implementation (Implementation & Code Quality) - Tối đa: 3.0 điểm
3. verification (Functionality & Verification) - Tối đa: 2.5 điểm
4. ai_interaction (AI Interaction Quality) - Tối đa: 1.5 điểm
5. reflection (Reflection & Ownership) - Tối đa: 1.0 điểm

--- DỮ LIỆU ĐÁNH GIÁ ---
[YÊU CẦU ĐỀ BÀI]:
${assignmentInfo || "Xây dựng module theo đặc tả"}

[MÃ NGUỒN VÀ TÀI LIỆU]:
${sourceCode || "Không có mã nguồn đính kèm"}

[NHẬT KÝ TƯƠNG TÁC AI / LOGS PHẢN TƯ]:
${aiLogs || "Không có nhật ký tương tác AI"}
`;

  // Cấu hình Schema bắt buộc Gemini trả về đúng khuôn JSON
  const rubricResponseSchema = {
    type: Type.OBJECT,
    properties: {
      total_score: { type: Type.NUMBER },
      overall_feedback: { type: Type.STRING },
      rubrics: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            criterion_id: { type: Type.STRING },
            criterion_name: { type: Type.STRING },
            score: { type: Type.NUMBER },
            max_score: { type: Type.NUMBER },
            reasoning: { type: Type.STRING },
          },
          required: ["criterion_id", "criterion_name", "score", "max_score", "reasoning"],
        },
      },
    },
    required: ["total_score", "overall_feedback", "rubrics"],
  };

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL_AUDIT || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    contents: prompt,
    config: {
      systemInstruction,
      temperature: 0.2, // Nhiệt độ thấp giúp điểm số chuẩn mực và ít lệch
      responseMimeType: "application/json",
      responseSchema: rubricResponseSchema,
    },
  });

  // Parse chuỗi JSON trả về object JavaScript sẵn sàng sử dụng
  return JSON.parse(response.text);
}

module.exports = {
  askGemini,
  evaluateRubricWithGemini,
};