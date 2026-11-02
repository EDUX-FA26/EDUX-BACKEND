const AiChatRepository = require('./aiChat.repository');
const { askGemini } = require('../../config/gemini.config');

function dateText(value) {
  if (!value) return 'chưa có ngày';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('vi-VN');
}

function fallbackAnswer(message, context) {
  const text = message.toLowerCase();
  if (text.includes('bài tập') || text.includes('assignment')) {
    const items = context.assignments.slice(0, 5).map((a) => `${a.title} – ${a.subject_name || a.class_code} – hạn ${dateText(a.deadline)} – ${a.submitted ? 'đã nộp' : 'chưa nộp'}`);
    return items.length ? `Bài tập gần đây: ${items.join('; ')}.` : 'Hiện chưa có bài tập được công bố.';
  }
  if (text.includes('lịch') || text.includes('buổi học')) {
    const items = context.schedule.slice(0, 5).map((s) => `${s.subject_name} – ${s.title || `Buổi ${s.session_no}`} (${dateText(s.learning_date)})`);
    return items.length ? `Lịch sắp tới: ${items.join('; ')}.` : 'Hiện chưa có lịch học sắp tới.';
  }
  if (text.includes('thông báo') || text.includes('notification')) {
    const items = context.notifications.slice(0, 5).map((n) => `${n.title || 'Thông báo'} (${dateText(n.created_at)})${n.message ? `: ${String(n.message).slice(0, 120)}` : ''}`);
    const unread = context.notifications.filter((n) => !n.is_read).length;
    return items.length ? `Thông báo gần nhất${unread ? ` (${unread} chưa đọc)` : ''}: ${items.join('; ')}.` : 'Hiện chưa có thông báo mới.';
  }
  if (text.includes('lớp') || text.includes('môn')) {
    return context.classes.length ? `Bạn đang học ${context.classes.length} lớp: ${context.classes.slice(0, 5).map((c) => `${c.class_code} – ${c.subject_name}${c.lecturer_name ? ` (GV: ${c.lecturer_name})` : ''}`).join('; ')}.` : 'Chưa tìm thấy lớp học của bạn.';
  }
  if (text.includes('học kỳ') || text.includes('semester')) {
    const s = context.semester[0];
    return s ? `Học kỳ hiện tại: ${s.name || s.code} – năm học ${s.academic_year || 'chưa cập nhật'}; từ ${dateText(s.start_date)} đến ${dateText(s.end_date)}.` : 'Chưa có thông tin học kỳ hiện tại.';
  }
  if (text.includes('flashcard') || text.includes('flash card')) {
    const items = context.flashcards.slice(0, 5).map((f) => f.title);
    return items.length ? `Bạn có ${context.flashcards.length} bộ flashcard: ${items.join('; ')}.` : 'Hiện chưa có bộ flashcard phù hợp với tài khoản của bạn.';
  }
  if (text.includes('cải thiện') || text.includes('cần học') || text.includes('tiến bộ')) {
    const score = context.performance[0]?.average_score;
    const weakTests = context.flashcardTests
      .filter((item) => Number(item.score_percent) < 60)
      .reduce((items, item) => {
        const key = `${item.subject_name || 'Không rõ môn'}|${item.deck_title || 'Không rõ bộ thẻ'}`;
        if (!items.some((entry) => entry.key === key)) items.push({ key, item });
        return items;
      }, [])
      .slice(0, 3)
      .map(({ item }) => `${item.subject_name || 'Không rõ môn'} – ${item.deck_title || 'Bộ thẻ'}: ${item.score_percent ?? 0}% (${item.total_questions || 0} câu)`);
    const review = context.flashcardReviews[0] || {};
    const details = [];
    if (weakTests.length) details.push(`FlashCard cần ưu tiên: ${weakTests.join('; ')}`);
    if (Number(review.needs_review) > 0) details.push(`Có ${review.needs_review} thẻ đang ở mức cần ôn lại`);
    if (score !== null && score !== undefined) details.push(`Điểm trung bình bài tập: ${score}%`);
    if (!details.length) return 'Chưa có bài kiểm tra hoặc lịch sử đủ chi tiết để phân tích. Hãy làm ít nhất một bài FlashCard rồi hỏi lại mình.';
    return `Dựa trên kết quả của bạn:\n- ${details.join('\n- ')}\nHãy ôn lại các bộ thẻ có điểm thấp trước.`;
  }
  return 'Mình có thể giúp bạn tra lịch học, học kỳ, lớp, bài tập, thông báo và flashcard. Bạn muốn hỏi phần nào?';
}

class AiChatService {
  async answer(message, user) {
    const cleanMessage = String(message || '').trim();
    if (!cleanMessage) throw Object.assign(new Error('MESSAGE_REQUIRED'), { status: 400 });
    if (cleanMessage.length > 500) throw Object.assign(new Error('MESSAGE_TOO_LONG'), { status: 400 });

    const context = await AiChatRepository.getStudentContext(user.id);
    const directAnswer = fallbackAnswer(cleanMessage, context);
    const knownTopic = /bài tập|assignment|thông báo|notification|lớp|môn|học kỳ|semester|lịch|buổi học|flash.?card|cải thiện|cần học|tiến bộ/i.test(cleanMessage);
    if (knownTopic || !process.env.GEMINI_API_KEY) return { answer: directAnswer, source: 'context' };

    const compactContext = JSON.stringify(context);
    const prompt = `Bạn là trợ lý học tập EDUX cho sinh viên. Trả lời bằng tiếng Việt, tối đa 3 câu ngắn, rõ ràng. Chỉ dùng dữ liệu trong CONTEXT; nếu không có dữ liệu thì nói chưa tìm thấy và gợi ý sinh viên mở đúng mục trong hệ thống. Không bịa lịch, điểm, hạn nộp hay thông báo.\n\nCONTEXT:\n${compactContext}\n\nCÂU HỎI:\n${cleanMessage}`;
    try {
      const answer = (await askGemini(prompt)).trim();
      return { answer: answer || fallbackAnswer(cleanMessage, context), source: answer ? 'gemini' : 'fallback' };
    } catch (error) {
      console.error('[ai-chat] Gemini failed:', error.message);
      return { answer: fallbackAnswer(cleanMessage, context), source: 'fallback' };
    }
  }
}

module.exports = new AiChatService();
