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

A. NGUYÊN TẮC CHẤM ĐIỂM & ĐỐI CHIẾU AI AUDIT ĐA PHÂN RÃ (MULTI-SCOPE HEURISTICS):
1. QUY MÔ BÀI TOÁN & TÍNH PHÂN RÃ (DECOMPOSITION BONUS):
   - Nếu bài toán quy mô lớn (fullstack, web, app nhiều luồng, microservices) mà sinh viên biết chủ động phân rã thành các Scope kỹ thuật rõ ràng (như Backend Architecture & RESTful API, Frontend React State & UI, Database/Cache/Redis, Luồng nghiệp vụ/Security):
     -> Đánh giá rất cao tư duy kiến trúc phần mềm (Software Architect mindset), ưu tiên cho điểm tối đa ở tiêu chí 'decomposition' (2.0/2.0) và 'abstraction' (2.0/2.0).
   - Nếu bài toán lớn nhưng chỉ khai báo 1 scope chung chung, sơ sài hoặc gom hết vào một lần khai báo mờ nhạt:
     -> Trừ 30% - 50% điểm ở tiêu chí 'decomposition' vì thiếu năng lực phân rã bài toán kỹ thuật.

2. THANH TRA CHI TIẾT TỪNG SCOPE:
   - Kiểm tra xem mô tả 'scope_description' có khớp với mã nguồn thực tế của từng thư mục trong dự án hay không (ví dụ: Scope BE khớp với thư mục src/controllers, src/services, src/routes; Scope FE khớp với src/components, src/pages; Scope DB khớp với migrations, schemas, repositories).
   - Đối chiếu từng tool và phản tư ở từng scope: ví dụ Scope BE thì dùng tool hỏi về async/await, database index, transaction, JWT middleware; Scope FE hỏi về responsive, state management, form validation, lifecycle.

3. TRƯỜNG HỢP KIỂM TOÁN TƯƠNG TÁC AI:
   - Dùng AI nhiều (> 60% code do AI sinh): Hoàn toàn hợp lệ nếu sinh viên minh bạch qua từng Scope. Trọng tâm câu hỏi Viva xoáy sâu vào "Code Ownership & Architectural Decisions", yêu cầu giải thích luồng thực thi dữ liệu (data flow), concurrency, bảo mật. Điểm Rubric đánh giá cao nếu có test cases và phản tư sâu.
   - Dùng AI ít hoặc tự code 100%: Đối chiếu với AST Code. Nếu code có các pattern điển hình của LLM mà không khai báo -> Gắn cờ "Suspicious Discrepancy", trừ mạnh điểm 'reflection'.
   - Khai báo Prompt sơ sài hoặc copy-paste lặp lại giữa các Scope: Kỹ năng prompt engineering kém, trừ điểm tiêu chí 'reflection' và 'decomposition'.

B. BỘ CÂU HỎI VẤN ĐÁP VIVA (BẮT BUỘC ĐÚNG FILE & CODE THỰC TẾ):
- Sinh chính xác 3 câu hỏi vấn đáp Viva kỹ thuật:
  + CÂU HỎI VẤN ĐÁP VIVA LIÊN KẾT GIỮA CÁC SCOPE: Sinh câu hỏi vấn đáp nhắm thẳng vào sự liên kết giữa các Scope (Ví dụ: "Em đã phân rã Scope BE và Scope FE, vậy luồng truyền token xác thực giữa 2 module này được thiết kế và bảo vệ như thế nào?", hoặc luồng đồng bộ dữ liệu giữa Controller và Database/Cache).
  + Câu 1 (Architecture & Scope Interconnection): rubric_criterion: "decomposition" hoặc "abstraction". Nhắm vào ranh giới giữa các Scope, cấu trúc thư mục, Clean Architecture, việc tách hàm/module, cách quản lý state/config trong bài làm.
  + Câu 2 (Code Logic & Edge Cases): rubric_criterion: "algorithmic_thinking" hoặc "implementation". Nhắm vào đoạn logic phức tạp nhất trong file code chính (ví dụ: async/await, multi-threading, polling/event-driven, I/O handling, data validation).
  + Câu 3 (AI Reflection & Trade-offs): rubric_criterion: "reflection". Nhắm trực tiếp vào phần code sinh viên khai báo AI hỗ trợ (hoặc đoạn code nghi vấn) để hỏi về đánh đổi hiệu năng (time/space complexity) và phương án cải tiến.
- Mỗi câu hỏi phải chỉ rõ: Tên file (target_file), vị trí/hàm cụ thể (target_code_snippet), nội dung câu hỏi (question), và gợi ý câu trả lời kỳ vọng (expected_answer_criteria) để giảng viên đối chiếu nhanh.
- KHÔNG ĐƯỢC sinh câu hỏi về các công nghệ không có trong bài nộp.

C. BỘ TIÊU CHÍ RUBRIC ĐÁNH GIÁ (Thang điểm 10):
Chấm điểm 5 tiêu chí Rubric dựa trên sự phối hợp của tất cả các Scope đã khai báo so với mã nguồn thực tế:
1. decomposition: Problem Decomposition & Scope Architecture (Max: 2.0) - Khả năng chia tách bài toán thành các module kỹ thuật logic, ranh giới trách nhiệm rõ ràng. Áp dụng quy tắc Decomposition Bonus (+2.0/2.0 nếu phân rã modular xuất sắc) hoặc trừ 30%-50% nếu gom chung mờ nhạt.
   * QUY ĐỊNH BẮT BUỘC CHO TRƯỜNG 'reasoning' CỦA TIÊU CHÍ DECOMPOSITION: Nêu rõ nhận xét về cách sinh viên chia các Scope (ví dụ: "Sinh viên phân rã tốt thành 3 scope độc lập BE/FE/DB, mô tả phạm vi mạch lạc, khớp với cấu trúc thư mục", hoặc chỉ ra việc thiếu phân rã nếu gom chung).
2. pattern_recognition: Pattern Recognition & Architecture Patterns (Max: 2.0) - Nhận diện mẫu kiến trúc và thiết kế phù hợp cho từng module (Repository, MVC, Microservices, Event-driven...).
3. abstraction: Abstraction & System Modeling (Max: 2.0) - Mô hình hóa thực thể, giao diện API, lược đồ C4/ERD tương ứng giữa các module.
4. algorithmic_thinking: Algorithmic Thinking, Logic & Data Flow (Max: 2.5) - Luồng dữ liệu, thuật toán xử lý nghiệp vụ cụ thể trong từng module.
5. reflection: Reflection, Trade-offs & Code Ownership (Max: 1.5) - Khả năng phản tư, đánh giá trade-off khi ứng dụng AI cho từng scope, mức độ làm chủ code (Code Ownership).
- Reasoning: Nêu rõ bằng chứng cụ thể từ bài làm (file, hàm, scope log) lý giải điểm số.`;

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