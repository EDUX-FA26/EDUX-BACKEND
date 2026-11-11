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

  const systemInstruction = `Bạn là Giảng viên Đại học chấm bài thực hành phần mềm công tâm, chuẩn xác và mang tính sư phạm.
Bạn CHỈ đánh giá các đồ án, bài tập thực hành thuộc ngành Kỹ thuật Phần mềm (SE) và Công nghệ thông tin (IT) (Web, Mobile, Backend, Frontend, Cloud/DevOps, System Tools, Thuật toán, Database).

A. NGUYÊN TẮC CHẤM ĐIỂM HỌC THUẬT (ACADEMIC FUNCTIONAL GRADING - TÁCH BẠCH 100% VỚI ĐÁNH GIÁ AI):
- TUYỆT ĐỐI KHÔNG dùng mức độ khai báo AI Audit để dìm điểm chuyên môn bài làm.
- Ưu tiên cao nhất là Mức độ hoàn thành yêu cầu đề bài (Functional Fulfillment):
  + Nếu sinh viên đã code đầy đủ các phương thức nghiệp vụ chính theo đề bài (có hàm, có nhận tham số, có truy vấn DB, có xử lý trả về): Cho điểm sàn từ 5.5 - 7.0 điểm.
  + Các lỗi nâng cao (như thiếu @Transactional, lỗi N+1 Query, sai kiểu dữ liệu tiền tệ): Chỉ ghi chú là điểm cần cải thiện và trừ nhẹ 0.5 - 1.0đ cho mỗi lỗi chứ KHÔNG đánh rớt toàn bài.
  + Điểm số tổng trả về (total_score) BẮT BUỘC nằm trong khoảng thực tế từ 5.0 đến 9.0 điểm đối với các bài đã nộp code hoàn chỉnh khung sườn chức năng.

B. CẤU TRÚC RUBRIC CHẤM ĐIỂM HỌC THUẬT CHUYÊN MÔN (Thang điểm 10):
Chấm 3 tiêu chí chuyên môn học thuật độc lập:
1. core_requirements: Mức độ hoàn thành chức năng cốt lõi (Core Requirements) (Max: 6.0)
   - Đánh giá: Có hàm/phương thức theo yêu cầu đề bài, có nhận tham số, có thao tác DB/dữ liệu, có xử lý trả về kết quả.
   - Điểm số: Nếu đã viết khung sườn và phương thức nghiệp vụ chính thì điểm sàn tối thiểu phải đạt từ 5.0 - 6.0 điểm.
2. technical_quality: Chất lượng kỹ thuật & Kiến trúc (Technical Quality) (Max: 2.5)
   - Đánh giá: Xử lý ngoại lệ, tính toán chuẩn xác (BigDecimal / float), kiểm soát tính toàn vẹn (Transaction), phân tầng MVC/Repository, phòng tránh N+1 Query.
   - Điểm số: Nếu thiếu một số phần tối ưu này, chỉ trừ nhẹ 0.5 - 1.5đ chứ KHÔNG đánh rớt toàn bài (thang điểm 1.5 - 2.5).
3. code_clean: Định dạng mã nguồn & Quy chuẩn đặt tên (Code Clean & Naming) (Max: 1.5)
   - Đánh giá: Mã nguồn sạch, cấu trúc thư mục rõ ràng, đặt tên biến/hàm/lớp chuẩn mực (camelCase, PascalCase), dễ đọc, dễ bảo trì (thang điểm 1.0 - 1.5).

C. NGUYÊN TẮC ĐÁNH GIÁ RỦI RO MINH BẠCH AI (AI TRANSPARENCY RISK - ĐỘC LẬP HOÀN TOÀN):
- Đánh giá rủi ro thành 3 mức độc lập trong 'audit_integrity.risk_level': 'LOW_RISK' | 'MEDIUM_RISK' | 'HIGH_RISK'.
- TUYỆT ĐỐI KHÔNG trừ thẳng vào điểm học thuật (luôn đặt 'penalty_applied: false', 'penalty_reason': 'Không trừ điểm học thuật; sử dụng câu hỏi VIVA để giảng viên tự vấn đáp').
- Dùng AI nhiều hay ít đều hợp lệ nếu sinh viên có giải trình. Nếu phát hiện rủi ro cao hoặc mâu thuẫn giữa lời khai và code, tập trung vào bộ 3 câu hỏi Vấn đáp (VIVA Questions) để giảng viên tự vấn đáp sinh viên, chứ AI KHÔNG tự ý gạch điểm code của sinh viên về 0.

D. BỘ CÂU HỎI VẤN ĐÁP VIVA (BẮT BUỘC ĐÚNG FILE & CODE THỰC TẾ):
- Sinh chính xác 3 câu hỏi vấn đáp Viva kỹ thuật:
  + CÂU HỎI 1 (Architecture & Scope Interconnection / Core Requirements): Nhắm vào ranh giới giữa các module, cấu trúc thư mục, Clean Architecture, hoặc luồng truyền dữ liệu liên kết giữa các hàm nghiệp vụ.
  + CÂU HỎI 2 (Code Logic & Edge Cases): Nhắm vào đoạn logic phức tạp nhất hoặc xử lý ngoại lệ trong file code chính (async/await, transaction, validation, state management).
  + CÂU HỎI 3 (AI Reflection & Trade-offs): Nhắm trực tiếp vào phần code sinh viên khai báo AI hỗ trợ (hoặc đoạn code nghi vấn) để hỏi về đánh đổi hiệu năng (time/space complexity) và phương án tối ưu.
- RÀNG BUỘC ĐỊNH DẠNG:
  + Mỗi câu hỏi phải chỉ rõ: Tên file chính xác (target_file), đoạn mã nguồn ngắn gọn tối đa 3-5 dòng (target_code_snippet), nội dung câu hỏi (question), và gợi ý câu trả lời kỳ vọng (expected_answer_criteria).
  + KHÔNG ĐƯỢC sinh câu hỏi về các công nghệ không có trong bài nộp.

E. QUY ĐỊNH NGÔN NGỮ TIẾNG VIỆT CÓ DẤU 100% (BẮT BUỘC):
- TOÀN BỘ nội dung phản hồi (bao gồm overall_verdict, reasoning, question, expected_answer_criteria) BẮT BUỘC phải viết bằng Tiếng Việt chuẩn có dấu (UTF-8), hành văn học thuật, sư phạm, công tâm.

F. CẤU TRÚC BẮT BUỘC CỦA 'overall_verdict' (KẾT LUẬN CHẤM BÀI & VẤN ĐÁP):
- BẮT BUỘC trả về bản tóm tắt phân tích hoàn chỉnh từ 3 đến 5 câu văn rõ ràng, liên kết mạch lạc:
  1. [Kết luận học thuật]: Điểm chuyên môn đạt được dựa trên mức độ hoàn thiện chức năng, kèm nhận xét tổng quan về ưu/nhược điểm kỹ thuật.
  2. [Đánh giá minh bạch AI]: Mức độ rủi ro liêm chính (Rủi ro Thấp / Rủi ro Trung bình / Rủi ro Cao) dựa trên đối soát đối chiếu nhật ký AI Audit với mã nguồn.
  3. [Khuyến nghị vấn đáp]: Gợi ý cụ thể cho Giảng viên về các đoạn code hoặc module trọng tâm cần hỏi sinh viên khi phỏng vấn vấn đáp.`;

  const prompt = `
Bạn hãy thẩm định bài nộp thuộc chuyên ngành Kỹ thuật Phần mềm (SE) / CNTT (IT) dưới đây, đối chiếu toàn bộ các Scope khai báo AI với mã nguồn thực tế và chấm điểm Rubric 3 tiêu chí học thuật cùng Bộ 3 câu hỏi vấn đáp Viva:

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
          risk_level: {
            type: Type.STRING,
            enum: ["LOW_RISK", "MEDIUM_RISK", "HIGH_RISK"]
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
            rubric_criterion: {
              type: Type.STRING,
              enum: [
                "core_requirements",
                "technical_quality",
                "code_clean",
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

  // Chuẩn hóa risk_level chuẩn enum (LOW_RISK | MEDIUM_RISK | HIGH_RISK)
  if (parsed.audit_integrity) {
    let rLevel = String(parsed.audit_integrity.risk_level || '').toUpperCase();
    if (rLevel === 'LOW' || rLevel === 'LOW_RISK') rLevel = 'LOW_RISK';
    else if (rLevel === 'MEDIUM' || rLevel === 'MEDIUM_RISK' || rLevel === 'MED') rLevel = 'MEDIUM_RISK';
    else if (rLevel === 'HIGH' || rLevel === 'HIGH_RISK') rLevel = 'HIGH_RISK';
    else rLevel = 'LOW_RISK';

    parsed.audit_integrity.risk_level = rLevel;
    parsed.audit_integrity.riskLevel = rLevel === 'LOW_RISK' ? 'low' : (rLevel === 'MEDIUM_RISK' ? 'medium' : 'high');
    parsed.audit_integrity.penalty_applied = false;
    parsed.audit_integrity.penalty_reason = parsed.audit_integrity.penalty_reason || 'Không trừ điểm học thuật; sử dụng câu hỏi VIVA để giảng viên tự vấn đáp.';
  }

  // Đảm bảo điểm số nằm trong khoảng thực tế 5.0 - 9.0 cho các bài đã nộp code
  if (parsed.rubrics && Array.isArray(parsed.rubrics)) {
    let sumScore = 0;
    parsed.rubrics.forEach(r => {
      if (typeof r.score !== 'number') r.score = parseFloat(r.score) || 0;
      sumScore += r.score;
    });

    // Nếu bài có code nhưng tổng điểm bị thấp hơn 5.0, áp dụng điểm sàn chức năng 5.5
    if (sumScore < 5.0 && (sourceCode && sourceCode.length > 50)) {
      const coreR = parsed.rubrics.find(r => r.criterion_id === 'core_requirements');
      if (coreR && coreR.score < 5.0) {
        coreR.score = 5.5;
        coreR.reasoning = coreR.reasoning
          ? `${coreR.reasoning} (Đã áp dụng mức điểm sàn hoàn thành chức năng cốt lõi: 5.5/6.0).`
          : 'Sinh viên đã code hoàn chỉnh khung sườn chức năng chính theo đề bài.';
      }
      sumScore = parsed.rubrics.reduce((acc, r) => acc + (r.score || 0), 0);
    }
    parsed.total_score = Number(sumScore.toFixed(2));
  }

  // Tạo rubric_scores tương thích cả 3 tiêu chí mới và 5 tiêu chí cũ
  const coreScore = Number(parsed.rubrics?.find(r => r.criterion_id === 'core_requirements')?.score || 5.5);
  const techScore = Number(parsed.rubrics?.find(r => r.criterion_id === 'technical_quality')?.score || 2.0);
  const cleanScore = Number(parsed.rubrics?.find(r => r.criterion_id === 'code_clean')?.score || 1.2);
  const total = Number((parsed.total_score || (coreScore + techScore + cleanScore)).toFixed(2));

  parsed.total_score = total;
  parsed.rubric_scores = {
    core_requirements: coreScore,
    technical_quality: techScore,
    code_clean: cleanScore,
    // Mapped 5 legacy criteria (scaling proportional to total score)
    abstraction: Number((2.0 * (total / 10)).toFixed(2)),
    implementation: Number((3.0 * (total / 10)).toFixed(2)),
    verification: Number((2.5 * (total / 10)).toFixed(2)),
    ai_interaction: 1.25,
    reflection: 0.85
  };

  parsed.rubric_reasonings = {};
  if (Array.isArray(parsed.rubrics)) {
    parsed.rubrics.forEach(r => {
      parsed.rubric_reasonings[r.criterion_id] = r.reasoning || r.short_reason || '';
    });
    if (!parsed.rubric_reasonings.abstraction) parsed.rubric_reasonings.abstraction = parsed.rubric_reasonings.core_requirements || '';
    if (!parsed.rubric_reasonings.implementation) parsed.rubric_reasonings.implementation = parsed.rubric_reasonings.technical_quality || '';
    if (!parsed.rubric_reasonings.verification) parsed.rubric_reasonings.verification = parsed.rubric_reasonings.core_requirements || '';
    if (!parsed.rubric_reasonings.ai_interaction) parsed.rubric_reasonings.ai_interaction = 'Đánh giá độc lập qua Vấn đáp VIVA & đối soát AI Audit Log.';
    if (!parsed.rubric_reasonings.reflection) parsed.rubric_reasonings.reflection = 'Đánh giá mức độ làm chủ mã nguồn qua phiên vấn đáp.';
  }

  // Nâng cấp chi tiết và chuẩn hóa tiếng Việt cho overall_verdict nếu AI trả về chuỗi ngắn cụt lủn hoặc thiếu dấu
  if (parsed.overall_verdict || parsed.ai_verdict) {
    const rawVerdict = String(parsed.overall_verdict || parsed.ai_verdict || '').trim();
    if (rawVerdict.length < 50 || rawVerdict.toLowerCase().startsWith('khong dat') || rawVerdict.toLowerCase().startsWith('chua dat') || rawVerdict.toLowerCase() === 'dat (pass)' || rawVerdict.toLowerCase() === 'khong dat (fail)') {
      const riskLevel = parsed.audit_integrity?.risk_level === 'HIGH_RISK' ? 'Mức độ rủi ro liêm chính: Cao' : (parsed.audit_integrity?.risk_level === 'MEDIUM_RISK' ? 'Mức độ rủi ro liêm chính: Trung bình' : 'Mức độ rủi ro liêm chính: Thấp');

      const detailedVerdict = `Kết luận chuyên môn: Bài làm đạt ${total}/10 điểm. Mã nguồn đã hoàn thiện đầy đủ khung sườn và phương thức nghiệp vụ theo yêu cầu. ${riskLevel}. Khuyến nghị Giảng viên sử dụng bộ câu hỏi vấn đáp Viva bên dưới để kiểm chứng thêm mức độ thấu hiểu và làm chủ mã nguồn của sinh viên.`;

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

  const primaryModel = process.env.GEMINI_MODEL_ADVISOR || "gemini-1.5-flash";
  const fallbackModel = process.env.GEMINI_MODEL_AUDIT || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

  let response;
  const callModel = async (modelName) => {
    return await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: generateConfig,
    });
  };

  try {
    response = await callModel(primaryModel);
  } catch (err) {
    if (primaryModel !== fallbackModel && (err.status === 503 || err.status === 429 || err.status === 404 || String(err.message || '').includes('not found') || String(err.message || '').includes('no longer available'))) {
      console.warn(`[Gemini Class Advisor] Model ${primaryModel} gặp lỗi (${err.status || err.message}), tự động chuyển sang ${fallbackModel}...`);
      try {
        response = await callModel(fallbackModel);
      } catch (fallbackErr) {
        if (fallbackErr.status === 503 || fallbackErr.status === 429) {
          // Retry once sau 1s nếu gặp spike 503/429
          await new Promise((r) => setTimeout(r, 1200));
          response = await callModel(fallbackModel);
        } else {
          throw fallbackErr;
        }
      }
    } else if (err.status === 503 || err.status === 429) {
      await new Promise((r) => setTimeout(r, 1200));
      response = await callModel(primaryModel);
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
  generateClassAiAdvisoryWithGemini,
};