const { pool } = require('../../config/db.config');

const StudyPlannerRepository = {
  async createOrGetPlan({
    studentId,
    subjectId,
    startsOn,
    analytics,
    days,
    force = false,
    schoolId = null,
  }) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Force: xóa plan cũ cùng ngày (scoped by school nếu có)
      if (force) {
        const whereForce = schoolId
          ? `WHERE student_id = $1 AND subject_id = $2 AND starts_on = $3 AND school_id = $4`
          : `WHERE student_id = $1 AND subject_id = $2 AND starts_on = $3`;
        const paramsForce = schoolId
          ? [studentId, subjectId, startsOn, schoolId]
          : [studentId, subjectId, startsOn];
        const oldPlans = await client.query(
          `SELECT id FROM study_plans ${whereForce}`,
          paramsForce
        );
        for (const op of oldPlans.rows) {
          await client.query(`DELETE FROM study_plan_days WHERE plan_id = $1`, [op.id]);
          await client.query(`DELETE FROM study_plans WHERE id = $1`, [op.id]);
        }
      }

      // INSERT study_plan với school_id nếu có
      let inserted;
      if (schoolId) {
        inserted = await client.query(
          `INSERT INTO study_plans (
             student_id,
             subject_id,
             starts_on,
             status,
             analytics_snapshot,
             school_id
           )
           VALUES ($1, $2, $3, 'draft', $4::jsonb, $5)
           ON CONFLICT (school_id, student_id, subject_id, starts_on)
           DO NOTHING
           RETURNING *`,
          [studentId, subjectId, startsOn, JSON.stringify(analytics), schoolId]
        );
      } else {
        inserted = await client.query(
          `INSERT INTO study_plans (
             student_id,
             subject_id,
             starts_on,
             status,
             analytics_snapshot
           )
           VALUES ($1, $2, $3, 'draft', $4::jsonb)
           ON CONFLICT (student_id, subject_id, starts_on)
           DO NOTHING
           RETURNING *`,
          [studentId, subjectId, startsOn, JSON.stringify(analytics)]
        );
      }

      const created = inserted.rows.length > 0;
      let plan = inserted.rows[0];

      // Nếu conflict (DO NOTHING), lấy plan hiện có
      if (!plan) {
        const existingParams = schoolId
          ? [studentId, subjectId, startsOn, schoolId]
          : [studentId, subjectId, startsOn];
        const existingWhere = schoolId
          ? `WHERE student_id = $1 AND subject_id = $2 AND starts_on = $3 AND school_id = $4`
          : `WHERE student_id = $1 AND subject_id = $2 AND starts_on = $3`;
        const existing = await client.query(
          `SELECT * FROM study_plans ${existingWhere}`,
          existingParams
        );
        plan = existing.rows[0];
      }

      if (!plan) {
        throw new Error('STUDY_PLAN_NOT_FOUND');
      }

      // Nếu mới tạo, insert các ngày học
      if (created) {
        for (const day of days) {
          if (schoolId) {
            await client.query(
              `INSERT INTO study_plan_days (
                 plan_id,
                 day_number,
                 topic_id,
                 activity,
                 duration_minutes,
                 target_questions,
                 reason,
                 school_id
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                plan.id,
                day.day,
                day.topicId,
                day.activity,
                day.durationMinutes,
                day.targetQuestions,
                day.reason,
                schoolId,
              ]
            );
          } else {
            await client.query(
              `INSERT INTO study_plan_days (
                 plan_id,
                 day_number,
                 topic_id,
                 activity,
                 duration_minutes,
                 target_questions,
                 reason
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                plan.id,
                day.day,
                day.topicId,
                day.activity,
                day.durationMinutes,
                day.targetQuestions,
                day.reason,
              ]
            );
          }
        }
      }

      const dayResult = await client.query(
        `SELECT
           id,
           day_number,
           topic_id,
           activity,
           duration_minutes,
           target_questions,
           reason,
           content_status
         FROM study_plan_days
         WHERE plan_id = $1
         ORDER BY day_number`,
        [plan.id]
      );

      await client.query('COMMIT');

      return {
        created,
        plan,
        days: dayResult.rows,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Lấy kế hoạch học đang active của student (mới nhất) kèm tiến độ 7 ngày.
   * Nếu không có, trả về null.
   */
  async getActivePlan(studentId, subjectId, schoolId = null) {
    const conditions = ['student_id = $1'];
    const params = [studentId];
    let idx = 2;

    if (subjectId) {
      conditions.push(`subject_id = $${idx++}`);
      params.push(subjectId);
    }
    if (schoolId) {
      conditions.push(`school_id = $${idx++}`);
      params.push(schoolId);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const planResult = await pool.query(
      `SELECT
         id,
         subject_id AS "subjectId",
         starts_on AS "startsOn",
         status,
         analytics_snapshot AS "analyticsSnapshot",
         created_at AS "createdAt"
       FROM study_plans
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT 1`,
      params
    );

    if (!planResult.rows.length) return null;

    const plan = planResult.rows[0];

    // Lấy 7 ngày học + trạng thái nộp bài
    const daysResult = await pool.query(
      `SELECT
         spd.id AS "planDayId",
         spd.day_number AS "day",
         spd.topic_id AS "topicId",
         spd.activity,
         spd.duration_minutes AS "durationMinutes",
         spd.target_questions AS "targetQuestions",
         spd.content_status AS "contentStatus",
         spd.reason,
         (
           SELECT json_build_object(
             'scorePercent', sub.score_percent,
             'submittedAt', sub.submitted_at,
             'correctAnswers', sub.correct_answers,
             'totalQuestions', sub.total_questions
           )
           FROM study_plan_day_submissions sub
           WHERE sub.plan_day_id = spd.id
             AND sub.student_id = $2
           LIMIT 1
         ) AS submission
       FROM study_plan_days spd
       WHERE spd.plan_id = $1
       ORDER BY spd.day_number`,
      [plan.id, studentId]
    );

    // Tính ngày thực tế cho từng day
    const startDate = new Date(`${plan.startsOn}T00:00:00.000Z`);
    const days = daysResult.rows.map(day => {
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + day.day - 1);
      return {
        ...day,
        studyDate: date.toISOString().slice(0, 10),
        isCompleted: !!day.submission,
      };
    });

    const completedCount = days.filter(d => d.isCompleted).length;

    return {
      planId: plan.id,
      subjectId: plan.subjectId,
      startsOn: plan.startsOn,
      status: plan.status,
      durationDays: 7,
      completedDays: completedCount,
      progressPercent: Math.round((completedCount / 7) * 100),
      days,
    };
  },
};

module.exports = StudyPlannerRepository;
