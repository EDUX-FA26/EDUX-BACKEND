const { pool } = require('../../config/db.config');
const { AppError } = require('../../utils/appError');
const LearningRepository = require('../learning/learning.repository');
const Repo = require('./todos.repository');

// ── helpers ──────────────────────────────────────────────

const normalizeTitle = (title) => String(title).trim().replace(/\s+/g, ' ').toLowerCase();

/** Khóa chống trùng: cùng người + cùng nguồn + cùng school + cùng nội dung + còn đang mở. */
const manualKey = (title, schoolId) =>
  schoolId ? `manual:${schoolId}:${normalizeTitle(title)}` : `manual:${normalizeTitle(title)}`;
const plannerKey = (planDayId, schoolId) =>
  schoolId ? `plan_day:${schoolId}:${planDayId}` : `plan_day:${planDayId}`;

const iso = (v) => (v ? new Date(v).toISOString() : null);

function toView(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    dueDate: r.due_date || null,
    isOverdue: Boolean(r.is_overdue),
    completedAt: iso(r.completed_at),
    sourceType: r.source_type,
    subject: r.subject_id ? { id: r.subject_id, name: r.subject_name, code: r.subject_code } : null,
    topic: r.topic_id ? { id: r.topic_id, name: r.topic_name } : null,
    flashcardDeck: r.flashcard_deck_id ? { id: r.flashcard_deck_id, title: r.deck_title } : null,
    studyPlanDay: r.study_plan_day_id
      ? {
          id: r.study_plan_day_id,
          planId: r.plan_id,
          day: r.plan_day_number,
          studyDate: r.plan_day_date || null,
          activity: r.plan_day_activity,
          contentStatus: r.plan_day_content_status,
          submitted: Boolean(r.plan_day_submitted),
        }
      : null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const PLANNER_PRIORITY = { review: 'HIGH', diagnostic: 'MEDIUM', practice: 'LOW' };
const PLANNER_LABEL = { review: 'Ôn tập', diagnostic: 'Khảo sát năng lực', practice: 'Luyện tập' };

/**
 * Kiểm tra các tham chiếu thuộc về người dùng / hợp lệ.
 * `undefined` = không đổi, `null` = gỡ liên kết. Trả về các cột cần ghi.
 */
async function resolveReferences(user, refs, schoolId = null) {
  const out = {};
  const has = (k) => refs[k] !== undefined;
  let topicRecord = null;

  if (has('studyPlanDayId')) {
    if (refs.studyPlanDayId === null) {
      out.studyPlanDayId = null;
    } else {
      const day = await Repo.findPlanDayForUser(user.id, refs.studyPlanDayId, schoolId);
      if (!day) throw new AppError('STUDY_PLAN_DAY_NOT_FOUND', 404);
      out.studyPlanDayId = day.id;
      // Suy ra môn/chủ đề từ ngày học nếu người dùng không chỉ định
      if (!has('topicId')) { out.topicId = day.topic_id; topicRecord = { id: day.topic_id, subject_id: day.subject_id }; }
      if (!has('subjectId')) out.subjectId = day.subject_id;
    }
  }

  if (has('topicId')) {
    if (refs.topicId === null) {
      out.topicId = null;
    } else {
      topicRecord = await Repo.findTopic(refs.topicId, schoolId);
      if (!topicRecord || !topicRecord.is_active) throw new AppError('TOPIC_NOT_FOUND', 404);
      out.topicId = refs.topicId;
      if (!has('subjectId') && out.subjectId === undefined) out.subjectId = topicRecord.subject_id;
    }
  }

  if (has('subjectId') && refs.subjectId !== null) {
    out.subjectId = refs.subjectId;
  } else if (has('subjectId')) {
    out.subjectId = null;
  }

  if (out.subjectId) {
    const subject = await LearningRepository.findSubjectById(out.subjectId, schoolId);
    if (!subject) throw new AppError('SUBJECT_NOT_FOUND', 404);
    if (user.role === 'student' &&
        !(await LearningRepository.isStudentActiveInSubject(user.id, out.subjectId, schoolId))) {
      throw new AppError('SUBJECT_ACCESS_FORBIDDEN', 403);
    }
  }

  if (out.subjectId && topicRecord && topicRecord.subject_id !== out.subjectId) {
    throw new AppError('TOPIC_SUBJECT_MISMATCH', 400);
  }

  if (has('flashcardDeckId')) {
    if (refs.flashcardDeckId === null) {
      out.flashcardDeckId = null;
    } else {
      const deck = await Repo.findDeckAccessible(user.id, refs.flashcardDeckId, schoolId);
      if (!deck) throw new AppError('FLASHCARD_DECK_NOT_FOUND', 404);
      out.flashcardDeckId = deck.id;
    }
  }

  return out;
}

const isUniqueViolation = (e) => e.code === '23505';

async function duplicateError(userId, key, schoolId = null) {
  const existing = key ? await Repo.findOpenByDedupeKey(userId, key, schoolId) : null;
  return new AppError('DUPLICATE_TODO', 409, existing ? { existingId: existing.id } : undefined);
}

// ── service ──────────────────────────────────────────────

const TodosService = {
  async create(user, body, schoolId = null) {
    const key = manualKey(body.title, schoolId);

    if (await Repo.findOpenByDedupeKey(user.id, key, schoolId)) throw await duplicateError(user.id, key, schoolId);

    const refs = await resolveReferences(user, {
      subjectId: body.subjectId,
      topicId: body.topicId,
      flashcardDeckId: body.flashcardDeckId,
      studyPlanDayId: body.studyPlanDayId,
    }, schoolId);

    try {
      const id = await Repo.insert(null, {
        userId: user.id,
        title: body.title,
        description: body.description,
        status: body.status || 'TODO',
        priority: body.priority || 'MEDIUM',
        dueDate: body.dueDate,
        sourceType: 'MANUAL', // API này chỉ tạo Todo thủ công
        dedupeKey: (body.status || 'TODO') === 'COMPLETED' ? null : key,
        schoolId,
        ...refs,
      });
      return toView(await Repo.findViewById(user.id, id, schoolId));
    } catch (error) {
      if (isUniqueViolation(error)) throw await duplicateError(user.id, key, schoolId);
      throw error;
    }
  },

  /** Tạo Todo từ một ngày của Study Plan (idempotent — chỉ tham chiếu planDayId). */
  async createFromStudyPlan(user, { planDayId }, schoolId = null) {
    const day = await Repo.findPlanDayForUser(user.id, planDayId, schoolId);
    if (!day) throw new AppError('STUDY_PLAN_DAY_NOT_FOUND', 404);

    const existing = await Repo.findPlannerTodoByDay(user.id, planDayId, schoolId);
    if (existing) return { created: false, todo: toView(await Repo.findViewById(user.id, existing.id, schoolId)) };

    const key = plannerKey(day.id, schoolId);
    const id = await Repo.insert(null, {
      userId: user.id,
      title: `${PLANNER_LABEL[day.activity] || 'Học'} – ${day.topic_name} (Ngày ${day.day_number})`,
      description: day.reason || '',
      status: 'TODO',
      priority: PLANNER_PRIORITY[day.activity] || 'MEDIUM',
      dueDate: day.study_date,
      sourceType: 'STUDY_PLANNER',
      subjectId: day.subject_id,
      topicId: day.topic_id,
      studyPlanDayId: day.id,
      dedupeKey: key,
      schoolId,
    }).catch(async (error) => {
      if (!isUniqueViolation(error)) throw error;
      const raced = await Repo.findPlannerTodoByDay(user.id, planDayId, schoolId);
      if (!raced) throw error;
      return raced.id;
    });

    return { created: true, todo: toView(await Repo.findViewById(user.id, id, schoolId)) };
  },

  async suggestions(user, { subjectId }, schoolId = null) {
    const rows = await Repo.listPlanSuggestions(user.id, subjectId, schoolId);
    return rows.map((r) => ({
      planDayId: r.plan_day_id,
      day: r.day_number,
      studyDate: r.study_date,
      activity: r.activity,
      durationMinutes: r.duration_minutes,
      targetQuestions: r.target_questions,
      reason: r.reason,
      contentStatus: r.content_status,
      subject: { id: r.subject_id, name: r.subject_name, code: r.subject_code },
      topic: { id: r.topic_id, name: r.topic_name },
      todoId: r.todo_id || null,
      todoStatus: r.todo_status || null,
    }));
  },

  async list(user, query, schoolId = null) {
    const { rows, pagination } = await Repo.list(user.id, { ...query, schoolId });
    return { items: rows.map(toView), pagination };
  },

  async getById(user, id, schoolId = null) {
    const row = await Repo.findViewById(user.id, id, schoolId);
    if (!row) throw new AppError('TODO_NOT_FOUND', 404);
    return toView(row);
  },

  async update(user, id, body, schoolId = null) {
    const client = await pool.connect();
    let key = null;
    try {
      await client.query('BEGIN');

      const current = await Repo.findRawById(client, user.id, id, schoolId);
      if (!current) throw new AppError('TODO_NOT_FOUND', 404);

      const refs = await resolveReferences(user, {
        subjectId: body.subjectId,
        topicId: body.topicId,
        flashcardDeckId: body.flashcardDeckId,
        studyPlanDayId: body.studyPlanDayId,
      }, schoolId);

      const patch = { ...refs };
      for (const f of ['title', 'description', 'priority', 'dueDate']) {
        if (body[f] !== undefined) patch[f] = body[f];
      }

      // Đổi tiêu đề Todo thủ công → cập nhật khóa chống trùng
      if (body.title !== undefined && current.source_type === 'MANUAL' && current.status !== 'COMPLETED') {
        key = manualKey(body.title, schoolId);
        if (key !== current.dedupe_key) {
          const clash = await Repo.findOpenByDedupeKey(user.id, key, schoolId);
          if (clash && clash.id !== id) throw await duplicateError(user.id, key, schoolId);
        }
        patch.dedupeKey = key;
      }

      await Repo.update(client, user.id, id, patch, schoolId);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (isUniqueViolation(error)) throw await duplicateError(user.id, key, schoolId);
      throw error;
    } finally {
      client.release();
    }

    return toView(await Repo.findViewById(user.id, id, schoolId));
  },

  /** Đổi trạng thái thủ công. KHÔNG có đường nào tự hoàn thành Todo (kể cả khi Pomodoro kết thúc). */
  async changeStatus(user, id, { status }, schoolId = null) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const current = await Repo.findRawById(client, user.id, id, schoolId);
      if (!current) throw new AppError('TODO_NOT_FOUND', 404);

      if (current.status !== status) {
        const patch = {
          status,
          completedAt: status === 'COMPLETED' ? new Date() : null,
        };

        // Mở lại Todo thủ công: khôi phục khóa chống trùng (có thể trùng với Todo đang mở khác)
        if (current.status === 'COMPLETED') {
          if (current.source_type === 'MANUAL') patch.dedupeKey = manualKey(current.title, schoolId);
          if (current.source_type === 'STUDY_PLANNER' && current.study_plan_day_id) {
            patch.dedupeKey = plannerKey(current.study_plan_day_id, schoolId);
          }
        }

        await Repo.update(client, user.id, id, patch, schoolId);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (isUniqueViolation(error)) throw new AppError('DUPLICATE_TODO', 409);
      throw error;
    } finally {
      client.release();
    }

    return toView(await Repo.findViewById(user.id, id, schoolId));
  },

  async remove(user, id, schoolId = null) {
    const deleted = await Repo.delete(user.id, id, schoolId);
    if (!deleted) throw new AppError('TODO_NOT_FOUND', 404);
    return { id };
  },

  stats: (user, schoolId = null) => Repo.stats(user.id, schoolId),
};

module.exports = TodosService;
