
const { pool } = require('../../config/db.config');

const StudyPlannerRepository = {
  async createOrGetPlan({
    studentId,
    subjectId,
    startsOn,
    analytics,
    days
  }) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const inserted = await client.query(
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
        [
          studentId,
          subjectId,
          startsOn,
          JSON.stringify(analytics)
        ]
      );

      const created = inserted.rows.length > 0;
      let plan = inserted.rows[0];

      if (!plan) {
        const existing = await client.query(
          `SELECT *
           FROM study_plans
           WHERE student_id = $1
             AND subject_id = $2
             AND starts_on = $3`,
          [studentId, subjectId, startsOn]
        );

        plan = existing.rows[0];
      }

      if (!plan) {
        throw new Error('STUDY_PLAN_NOT_FOUND');
      }

      if (created) {
        for (const day of days) {
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
              day.reason
            ]
          );
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
        days: dayResult.rows
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};

module.exports = StudyPlannerRepository;
