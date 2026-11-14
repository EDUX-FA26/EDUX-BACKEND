const { pool } = require('../../config/db.config');

async function query(sql, params) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } catch (error) {
    console.error('[ai-chat] context query failed:', error.message);
    return [];
  }
}

const AiChatRepository = {
  async getStudentContext(userId, schoolId) {
    if (!schoolId) {
      throw new Error('SCHOOL_ID_REQUIRED_FOR_AI_CONTEXT');
    }

    const [semester, classes, schedule, assignments, notifications, performance, flashcardTests, flashcardReviews, learningHistory, flashcards] = await Promise.all([
      query(`SELECT code, name, academic_year, start_date, end_date, is_current
             FROM semesters
             WHERE school_id = $1::uuid
             ORDER BY is_current DESC, start_date DESC LIMIT 1`, [schoolId]),
      query(`SELECT c.class_code, s.name AS subject_name, up.full_name AS lecturer_name
             FROM class_members cm
             JOIN classes c ON c.id = cm.class_id
             JOIN subjects s ON s.id = c.subject_id
             LEFT JOIN user_profiles up ON up.user_id = c.lecturer_id
             WHERE cm.student_id = $1
               AND c.school_id = $2::uuid
               AND (cm.status IS NULL OR cm.status = 'active')
             ORDER BY c.class_code LIMIT 20`, [userId, schoolId]),
      query(`SELECT se.session_no, se.learning_date, se.title, c.class_code, s.name AS subject_name
             FROM class_members cm
             JOIN classes c ON c.id = cm.class_id
             JOIN subjects s ON s.id = c.subject_id
             JOIN sessions se ON se.class_id = c.id
             WHERE cm.student_id = $1
               AND c.school_id = $2::uuid
               AND (cm.status IS NULL OR cm.status = 'active')
               AND se.learning_date >= CURRENT_DATE
             ORDER BY se.learning_date ASC, se.session_no ASC LIMIT 10`, [userId, schoolId]),
      query(`SELECT a.title, a.deadline, c.class_code, s.name AS subject_name,
                    EXISTS (SELECT 1 FROM submissions sub WHERE sub.assignment_id = a.id AND sub.student_id = $1) AS submitted
             FROM class_members cm
             JOIN classes c ON c.id = cm.class_id
             JOIN subjects s ON s.id = c.subject_id
             JOIN assignments a ON a.class_id = c.id
             WHERE cm.student_id = $1
               AND c.school_id = $2::uuid
               AND (cm.status IS NULL OR cm.status = 'active')
               AND (a.publish_status IS NULL OR a.publish_status = 'published')
             ORDER BY a.deadline ASC NULLS LAST LIMIT 20`, [userId, schoolId]),
      query(`SELECT title, message, is_read, created_at FROM notifications
             WHERE user_id = $1
               AND ((notification_scope = 'school' AND school_id = $2::uuid) OR notification_scope = 'platform')
             ORDER BY created_at DESC LIMIT 10`, [userId, schoolId]),
      query(`SELECT ROUND(AVG((g.score / NULLIF(g.max_score, 0)) * 100)::numeric, 1) AS average_score,
                    COUNT(g.id)::int AS graded_count
             FROM grades g
             JOIN classes c ON c.id = g.class_id
             WHERE g.student_id = $1
               AND c.school_id = $2::uuid`, [userId, schoolId]),
      query(`SELECT ROUND((ft.score * 10)::numeric, 1) AS score_percent,
                    ft.score, ft.total_questions, fd.title AS deck_title, s.name AS subject_name,
                    ft.submitted_at
             FROM flashcard_tests ft
             JOIN flashcard_decks fd ON fd.id = ft.deck_id
             LEFT JOIN subjects s ON s.id = fd.subject_id
             WHERE ft.user_id = $1 AND ft.status = 'submitted'
               AND fd.school_id = $2::uuid
             ORDER BY ft.submitted_at DESC NULLS LAST LIMIT 20`, [userId, schoolId]),
      query(`SELECT COUNT(*)::int AS total_reviews,
                    COUNT(*) FILTER (WHERE result IN ('again', 'hard'))::int AS needs_review,
                    COUNT(*) FILTER (WHERE result IN ('good', 'easy'))::int AS mastered
             FROM flashcard_reviews fr
             JOIN flashcard_decks fd ON fd.id = fr.deck_id
             WHERE fr.user_id = $1
               AND fd.school_id = $2::uuid`, [userId, schoolId]),
      query(`SELECT s.name AS subject_name, COUNT(*)::int AS activity_count,
                    MAX(ssa.activity_date) AS last_activity_date
             FROM subject_streak_activities ssa
             JOIN subjects s ON s.id = ssa.subject_id
             WHERE ssa.user_id = $1
               AND s.school_id = $2::uuid
             GROUP BY s.name ORDER BY activity_count ASC LIMIT 20`, [userId, schoolId]),
      query(`SELECT fd.title, fd.description, fd.is_public
             FROM flashcard_decks fd
             WHERE fd.school_id = $2::uuid
               AND (fd.is_public = true OR fd.created_by = $1)
             ORDER BY fd.updated_at DESC LIMIT 20`, [userId, schoolId]),
    ]);

    return { semester, classes, schedule, assignments, notifications, performance, flashcardTests, flashcardReviews, learningHistory, flashcards };
  },
};

module.exports = AiChatRepository;
