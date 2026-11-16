const { askGemini } = require('../../config/gemini.config');

/**
 * Loại bỏ dấu tiếng Việt để so sánh ngữ âm/ký tự không dấu
 */
function removeVietnameseTones(str) {
  if (!str || typeof str !== 'string') return '';
  let s = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[đĐ]/g, (m) => (m === 'đ' ? 'd' : 'D'));
  return s;
}

/**
 * Chuẩn hóa văn bản: NFC, lowercase, chuyển ký tự đặc biệt thành khoảng trắng, thu gọn khoảng trắng
 */
function normalizeText(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s_]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tính Dice coefficient trên character bigrams (n-gram = 2) giữa 2 chuỗi
 * Trả về giá trị trong đoạn [0, 1]
 */
function calculateDiceSimilarity(str1, str2) {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) {
    return s1 === s2 ? 1 : 0;
  }

  const getBigrams = (str) => {
    const bigrams = new Map();
    for (let i = 0; i < str.length - 1; i++) {
      const bigram = str.substring(i, i + 2);
      bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
    }
    return bigrams;
  };

  const bg1 = getBigrams(s1);
  const bg2 = getBigrams(s2);

  let intersection = 0;
  for (const [bg, count1] of bg1.entries()) {
    if (bg2.has(bg)) {
      intersection += Math.min(count1, bg2.get(bg));
    }
  }

  const total = (s1.length - 1) + (s2.length - 1);
  return total > 0 ? (2 * intersection) / total : 0;
}

/**
 * Tính token overlap (Jaccard similarity trên tập các từ)
 */
function calculateTokenOverlap(str1, str2) {
  const t1 = new Set(normalizeText(str1).split(/\s+/).filter(Boolean));
  const t2 = new Set(normalizeText(str2).split(/\s+/).filter(Boolean));
  if (t1.size === 0 || t2.size === 0) return 0;

  let intersection = 0;
  for (const w of t1) {
    if (t2.has(w)) intersection++;
  }

  const union = new Set([...t1, ...t2]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Kiểm tra xem chuỗi có phải là từ dừng / nhãn chung chung không mang tính học thuật
 */
const GENERIC_STOPWORDS = new Set([
  'bai', 'bai hoc', 'chuong', 'phan', 'tong quan', 'gioi thieu', 'overview',
  'lesson', 'unit', 'chapter', 'general', 'topic', 'chu de', 'phan 1', 'phan 2',
  'bai 1', 'bai 2', 'bai 3', 'chuong 1', 'chuong 2', 'chuong 3', 'unit 1', 'unit 2'
]);

function isGenericStopword(str) {
  if (!str) return true;
  const unaccented = normalizeText(removeVietnameseTones(str));
  if (unaccented.length < 2) return true;
  return GENERIC_STOPWORDS.has(unaccented);
}

const TopicMatchingService = {
  removeVietnameseTones,
  normalizeText,
  calculateDiceSimilarity,
  calculateTokenOverlap,
  isGenericStopword,

  /**
   * So khớp nhãn rawTopic và nội dung câu hỏi với danh mục Canonical Topics hợp lệ
   *
   * @param {object} params
   * @param {string} params.rawTopic - Nhãn chủ đề từ Excel hoặc người dùng nhập
   * @param {string} params.question - Nội dung câu hỏi (tùy chọn)
   * @param {string} params.answer - Đáp án (tùy chọn)
   * @param {string} params.explanation - Giải thích (tùy chọn)
   * @param {Array}  params.catalogTopics - Danh sách topic chuẩn đủ điều kiện của môn học
   * @param {number} params.limit - Số lượng ứng viên tối đa trả về (mặc định: 5)
   * @param {boolean} params.useAI - Có sử dụng Semantic AI fallback không (mặc định: false)
   * @returns {Promise<{ status: string, candidates: Array, suggestedTopicId: string|null, isAmbiguous: boolean, reason?: string }>}
   */
  async matchTopic({
    rawTopic = '',
    question = '',
    answer = '',
    explanation = '',
    catalogTopics = [],
    limit = 5,
    useAI = false,
  }) {
    if (!Array.isArray(catalogTopics) || catalogTopics.length === 0) {
      return {
        status: 'no_topics',
        matchType: 'no_match',
        candidates: [],
        suggestedTopicId: null,
        isAmbiguous: false,
        reason: 'Môn học chưa có Canonical Topic được phê duyệt',
      };
    }

    const trimmedRaw = (rawTopic || '').trim();
    // Khi rawTopic trống (ví dụ tạo thẻ thủ công), dùng answer để đối soát chính xác nếu có
    const effectiveText = trimmedRaw || (answer || '').trim();
    const rawNorm = normalizeText(effectiveText);
    const rawUnaccented = normalizeText(removeVietnameseTones(effectiveText));

    // ─────────────────────────────────────────────────────────────
    // TIER A — Deterministic Exact & Normalized Matching
    // ─────────────────────────────────────────────────────────────
    if (effectiveText) {
      // 1. Exact Code match
      const codeMatch = catalogTopics.find(
        (t) => t.code && normalizeText(t.code) === rawNorm
      );
      if (codeMatch) {
        return {
          status: 'exact',
          matchType: 'exact_code',
          candidates: [
            {
              topicId: codeMatch.id,
              topicName: codeMatch.name,
              topicCode: codeMatch.code,
              matchType: 'exact_code',
              score: 1.0,
              reason: `Khớp chính xác mã Topic: ${codeMatch.code}`,
            },
          ],
          suggestedTopicId: codeMatch.id,
          isAmbiguous: false,
        };
      }

      // 2. Exact Name match
      const nameMatch = catalogTopics.find(
        (t) => normalizeText(t.name) === rawNorm
      );
      if (nameMatch) {
        return {
          status: 'exact',
          matchType: 'exact_name',
          candidates: [
            {
              topicId: nameMatch.id,
              topicName: nameMatch.name,
              topicCode: nameMatch.code,
              matchType: 'exact_name',
              score: 1.0,
              reason: `Khớp chính xác tên Topic: ${nameMatch.name}`,
            },
          ],
          suggestedTopicId: nameMatch.id,
          isAmbiguous: false,
        };
      }

      // 3. Exact Alias match
      const aliasMatch = catalogTopics.find(
        (t) =>
          Array.isArray(t.aliases) &&
          t.aliases.some((a) => a && normalizeText(a) === rawNorm)
      );
      if (aliasMatch) {
        return {
          status: 'exact',
          matchType: 'exact_alias',
          candidates: [
            {
              topicId: aliasMatch.id,
              topicName: aliasMatch.name,
              topicCode: aliasMatch.code,
              matchType: 'exact_alias',
              score: 0.98,
              reason: `Khớp từ đồng nghĩa (Alias): "${trimmedRaw}"`,
            },
          ],
          suggestedTopicId: aliasMatch.id,
          isAmbiguous: false,
        };
      }

      // 4. Normalized match (chuẩn hóa không dấu tiếng Việt)
      if (rawUnaccented.length >= 3) {
        const normMatch = catalogTopics.find((t) => {
          if (t.name && normalizeText(removeVietnameseTones(t.name)) === rawUnaccented) {
            return true;
          }
          if (t.code && normalizeText(removeVietnameseTones(t.code)) === rawUnaccented) {
            return true;
          }
          if (Array.isArray(t.aliases)) {
            return t.aliases.some(
              (a) => a && normalizeText(removeVietnameseTones(a)) === rawUnaccented
            );
          }
          return false;
        });

        if (normMatch) {
          return {
            status: 'normalized',
            matchType: 'normalized',
            candidates: [
              {
                topicId: normMatch.id,
                topicName: normMatch.name,
                topicCode: normMatch.code,
                matchType: 'normalized',
                score: 0.88,
                reason: `Khớp tên hoặc alias sau khi chuẩn hóa ký tự tiếng Việt`,
              },
            ],
            suggestedTopicId: normMatch.id,
            isAmbiguous: false,
          };
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // TIER B — Fuzzy Text Matching (Lexical)
    // ─────────────────────────────────────────────────────────────
    let fuzzyCandidates = [];
    const fuzzyTarget = trimmedRaw || (answer || '').trim() || (question || '').trim();

    if (fuzzyTarget && !isGenericStopword(fuzzyTarget)) {
      for (const topic of catalogTopics) {
        let bestTopicScore = 0;
        let bestMatchType = 'fuzzy';
        let matchTarget = topic.name;

        // So sánh với topic name
        const nameDice = calculateDiceSimilarity(fuzzyTarget, topic.name);
        const nameToken = calculateTokenOverlap(fuzzyTarget, topic.name);
        const nameScore = Math.max(nameDice, nameToken);
        if (nameScore > bestTopicScore) {
          bestTopicScore = nameScore;
          matchTarget = topic.name;
        }

        // So sánh với topic code
        if (topic.code) {
          const codeDice = calculateDiceSimilarity(fuzzyTarget, topic.code);
          const codeScore = codeDice;
          if (codeScore > bestTopicScore) {
            bestTopicScore = codeScore;
            matchTarget = topic.code;
          }
        }

        // So sánh với aliases
        if (Array.isArray(topic.aliases)) {
          for (const alias of topic.aliases) {
            if (!alias) continue;
            const aliasDice = calculateDiceSimilarity(fuzzyTarget, alias);
            const aliasToken = calculateTokenOverlap(fuzzyTarget, alias);
            const aliasScore = Math.max(aliasDice, aliasToken);
            if (aliasScore > bestTopicScore) {
              bestTopicScore = aliasScore;
              matchTarget = alias;
            }
          }
        }

        // Ngưỡng tối thiểu để loại bỏ gợi ý rác (0.45)
        if (bestTopicScore >= 0.45) {
          const pct = Math.round(bestTopicScore * 100);
          fuzzyCandidates.push({
            topicId: topic.id,
            topicName: topic.name,
            topicCode: topic.code,
            matchType: 'fuzzy',
            score: Number(bestTopicScore.toFixed(3)),
            reason: `Tên hoặc alias gần giống (${pct}%) với "${matchTarget}" — vui lòng kiểm tra`,
          });
        }
      }

      // Sắp xếp theo score giảm dần
      fuzzyCandidates.sort((a, b) => b.score - a.score);
      fuzzyCandidates = fuzzyCandidates.slice(0, limit);
    }

    // Kiểm tra tính mơ hồ (Ambiguous): nếu 2 ứng viên đầu tiên có score cao và suýt soát nhau (< 0.05)
    let isAmbiguous = false;
    let suggestedTopicId = null;

    if (fuzzyCandidates.length > 0) {
      if (
        fuzzyCandidates.length >= 2 &&
        fuzzyCandidates[0].score >= 0.65 &&
        fuzzyCandidates[1].score >= 0.65 &&
        Math.abs(fuzzyCandidates[0].score - fuzzyCandidates[1].score) < 0.05
      ) {
        isAmbiguous = true;
        fuzzyCandidates[0].reason = 'Có nhiều Topic tương tự nhau — vui lòng kiểm tra và chọn chính xác';
        fuzzyCandidates[1].reason = 'Có nhiều Topic tương tự nhau — vui lòng kiểm tra và chọn chính xác';
        suggestedTopicId = null; // Không tự chọn khi nhập nhằng
      } else if (fuzzyCandidates[0].score >= 0.55) {
        suggestedTopicId = fuzzyCandidates[0].topicId;
      }
    }

    // ─────────────────────────────────────────────────────────────
    // TIER C — Semantic AI Suggestion (Chỉ khi cần thiết & có AI provider)
    // ─────────────────────────────────────────────────────────────
    const needsSemantic =
      useAI &&
      Boolean(process.env.GEMINI_API_KEY) &&
      (!fuzzyCandidates.length || fuzzyCandidates[0].score < 0.60) &&
      Boolean(question && question.trim().length >= 8);

    if (needsSemantic) {
      try {
        const aiCandidate = await this.trySemanticMatch({
          question,
          answer,
          explanation,
          rawTopic: trimmedRaw,
          catalogTopics,
        });

        if (aiCandidate) {
          // Đưa ứng viên ngữ nghĩa AI lên đầu danh sách
          fuzzyCandidates = [aiCandidate, ...fuzzyCandidates.filter((c) => c.topicId !== aiCandidate.topicId)].slice(
            0,
            limit
          );
          suggestedTopicId = aiCandidate.topicId;
          isAmbiguous = false;
        }
      } catch {
        // Fallback an toàn: nếu Gemini lỗi, timeout hoặc hết quota, giữ kết quả Tier B
      }
    }

    if (fuzzyCandidates.length > 0) {
      const topMatchType = fuzzyCandidates[0]?.matchType || 'fuzzy';
      return {
        status: isAmbiguous ? 'ambiguous' : topMatchType,
        matchType: isAmbiguous ? 'ambiguous' : topMatchType,
        candidates: fuzzyCandidates,
        suggestedTopicId,
        isAmbiguous,
      };
    }

    return {
      status: 'no_match',
      matchType: 'no_match',
      candidates: [],
      suggestedTopicId: null,
      isAmbiguous: false,
      reason: trimmedRaw
        ? isGenericStopword(trimmedRaw)
          ? 'Nhãn chủ đề quá ngắn hoặc chung chung, vui lòng chọn Topic cụ thể'
          : `Không tìm thấy Topic phù hợp cho nhãn "${trimmedRaw}"`
        : 'Không có dữ liệu nhãn hoặc câu hỏi để gợi ý Topic',
    };
  },

  /**
   * Gọi AI (Gemini) để suy luận Topic từ câu hỏi và đáp án
   * BẢO ĐẢM AN TOÀN: topicId trả về bắt buộc phải nằm trong allowlist của catalogTopics!
   */
  async trySemanticMatch({ question, answer, explanation, rawTopic, catalogTopics }) {
    if (!catalogTopics || catalogTopics.length === 0) return null;

    // Giới hạn danh sách topic gửi lên AI tối đa 40 topics để đảm bảo tốc độ và context
    const candidatePool = catalogTopics.slice(0, 40).map((t) => ({
      id: t.id,
      code: t.code || '',
      name: t.name,
      description: t.description ? t.description.substring(0, 150) : '',
    }));

    const prompt = `Bạn là trợ lý học thuật AI phụ trách phân loại câu hỏi vào Topic môn học chuẩn.
Nhiệm vụ: Dựa vào nội dung câu hỏi trắc nghiệm dưới đây, hãy chọn ĐÚNG 1 topicId phù hợp nhất từ danh sách Canonical Topics được cho phép.

DỮ LIỆU CÂU HỎI:
- Nhãn tham khảo: ${rawTopic || '(không có)'}
- Câu hỏi: ${question.substring(0, 1000)}
${answer ? `- Đáp án: ${answer.substring(0, 500)}` : ''}
${explanation ? `- Giải thích: ${explanation.substring(0, 500)}` : ''}

DANH SÁCH TOPIC ĐƯỢC PHÉP CHỌN (CHỈ ĐƯỢC CHỌN ID TRONG DANH SÁCH NÀY):
${JSON.stringify(candidatePool, null, 2)}

QUY TẮC BẮT BUỘC:
1. Bạn CHỈ ĐƯỢC CHỌN topicId có sẵn trong danh sách trên. TUYỆT ĐỐI KHÔNG tự tạo UUID hoặc đoán topic ngoài danh sách.
2. Nếu không có topic nào thực sự phù hợp, hãy trả về topicId là null.
3. Trả về DUY NHẤT một đối tượng JSON hợp lệ theo định dạng:
{
  "topicId": "UUID được chọn từ danh sách hoặc null",
  "reason": "Giải thích ngắn gọn 1 câu lý do câu hỏi thuộc chủ đề này"
}`;

    // Bọc promise timeout 3.5 giây để không làm chậm request của Lecturer
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('AI_TIMEOUT')), 3500)
    );

    const callPromise = askGemini(prompt);
    const rawRes = await Promise.race([callPromise, timeoutPromise]);

    let parsed = null;
    try {
      const cleaned = String(rawRes || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      parsed = JSON.parse(cleaned);
    } catch {
      return null;
    }

    if (!parsed || !parsed.topicId) return null;

    // KIỂM TRA BẢO MẬT ALLOWLIST BẮT BUỘC:
    const matched = catalogTopics.find((t) => t.id === parsed.topicId);
    if (!matched) {
      // AI bịa ID ngoài danh mục -> Vứt bỏ ngay lập tức!
      return null;
    }

    return {
      topicId: matched.id,
      topicName: matched.name,
      topicCode: matched.code,
      matchType: 'semantic',
      score: 0.75,
      reason: `Gợi ý theo ngữ nghĩa câu hỏi: ${parsed.reason || 'Nội dung câu hỏi phù hợp với chủ đề'} (cần xác nhận)`,
    };
  },
};

module.exports = TopicMatchingService;
