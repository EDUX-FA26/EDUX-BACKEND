const { pool } = require('../../config/db.config');

let hasSchoolIdInStudyPlans = null;
let hasSchoolIdInStudyPlanDays = null;

async function checkSchoolIdColumn(client) {
  if (hasSchoolIdInStudyPlans !== null) return hasSchoolIdInStudyPlans;
  try {
    const res = await client.query(`
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'study_plans' AND column_name = 'school_id'
      LIMIT 1
    `);
    hasSchoolIdInStudyPlans = res.rows.length > 0;
  } catch (_) {
    hasSchoolIdInStudyPlans = false;
  }
  return hasSchoolIdInStudyPlans;
}

async function checkDaySchoolIdColumn(client) {
  if (hasSchoolIdInStudyPlanDays !== null) return hasSchoolIdInStudyPlanDays;
  try {
    const res = await client.query(`
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'study_plan_days' AND column_name = 'school_id'
      LIMIT 1
    `);
    hasSchoolIdInStudyPlanDays = res.rows.length > 0;
  } catch (_) {
    hasSchoolIdInStudyPlanDays = false;
  }
  return hasSchoolIdInStudyPlanDays;
}

function getStudyDate(startsOnStr, dayNumber) {
  const [y, m, d] = startsOnStr.split('-').map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d + (dayNumber - 1)));
  const outY = utcDate.getUTCFullYear();
  const outM = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const outD = String(utcDate.getUTCDate()).padStart(2, '0');
  return `${outY}-${outM}-${outD}`;
}

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

      // Khóa và kiểm tra xem kế hoạch đã tồn tại cho chu kỳ này chưa
      const existing = await client.query(
        `SELECT * FROM study_plans
         WHERE student_id = $1 AND subject_id = $2 AND starts_on = $3
         FOR UPDATE`,
        [studentId, subjectId, startsOn]
      );

      let plan = existing.rows[0];
      let created = false;

      if (!plan) {
        const hasSchoolCol = await checkSchoolIdColumn(client);
        let inserted;

        if (hasSchoolCol && schoolId) {
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
             ON CONFLICT (student_id, subject_id, starts_on)
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

        created = inserted.rows.length > 0;
        plan = inserted.rows[0];

        // Nếu request song song đã chèn trước (DO NOTHING), lấy plan đó kèm khóa hàng
        if (!plan) {
          const fetchAgain = await client.query(
            `SELECT * FROM study_plans
             WHERE student_id = $1 AND subject_id = $2 AND starts_on = $3
             FOR UPDATE`,
            [studentId, subjectId, startsOn]
          );
          plan = fetchAgain.rows[0];
        }

        if (!plan) {
          throw new Error('STUDY_PLAN_NOT_FOUND');
        }

        // Chèn đúng 7 ngày học trong transaction
        if (created) {
          const hasDaySchoolCol = await checkDaySchoolIdColumn(client);
          for (const day of days) {
            if (hasDaySchoolCol && schoolId) {
              await client.query(
                `INSERT INTO study_plan_days (
                   plan_id,
                   day_number,
                   topic_id,
                   activity,
                   duration_minutes,
                   target_questions,
                   reason,
                   content_status,
                   school_id
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (plan_id, day_number) DO NOTHING`,
                [
                  plan.id,
                  day.day,
                  day.topicId,
                  day.activity,
                  day.durationMinutes,
                  day.targetQuestions,
                  day.reason,
                  day.contentStatus || 'ready',
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
                   reason,
                   content_status
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (plan_id, day_number) DO NOTHING`,
                [
                  plan.id,
                  day.day,
                  day.topicId,
                  day.activity,
                  day.durationMinutes,
                  day.targetQuestions,
                  day.reason,
                  day.contentStatus || 'ready',
                ]
              );
            }
          }
        }
      }

      let dayResult = await client.query(
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

      // Nếu kế hoạch hiện có chưa có ngày (kế hoạch dở dang/cũ), tự động bổ sung đủ 7 ngày
      if (dayResult.rows.length === 0 && Array.isArray(days) && days.length > 0) {
        const hasDaySchoolCol = await checkDaySchoolIdColumn(client);
        for (const day of days) {
          if (hasDaySchoolCol && schoolId) {
            await client.query(
              `INSERT INTO study_plan_days (
                 plan_id,
                 day_number,
                 topic_id,
                 activity,
                 duration_minutes,
                 target_questions,
                 reason,
                 content_status,
                 school_id
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (plan_id, day_number) DO NOTHING`,
              [
                plan.id,
                day.day,
                day.topicId,
                day.activity,
                day.durationMinutes,
                day.targetQuestions,
                day.reason,
                day.contentStatus || 'ready',
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
                 reason,
                 content_status
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (plan_id, day_number) DO NOTHING`,
              [
                plan.id,
                day.day,
                day.topicId,
                day.activity,
                day.durationMinutes,
                day.targetQuestions,
                day.reason,
                day.contentStatus || 'ready',
              ]
            );
          }
        }

        dayResult = await client.query(
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
      }

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
    const conditions = ['sp.student_id = $1'];
    const params = [studentId];
    let idx = 2;

    if (subjectId) {
      conditions.push(`sp.subject_id = $${idx++}`);
      params.push(subjectId);
    }

    let schoolJoin = '';
    if (schoolId) {
      schoolJoin = 'JOIN subjects s ON s.id = sp.subject_id';
      conditions.push(`s.school_id = $${idx++}`);
      params.push(schoolId);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const planResult = await pool.query(
      `SELECT
         sp.id,
         sp.subject_id AS "subjectId",
         sp.starts_on AS "startsOn",
         sp.status,
         sp.analytics_snapshot AS "analyticsSnapshot",
         sp.created_at AS "createdAt"
       FROM study_plans sp
       ${schoolJoin}
       ${whereClause}
       ORDER BY sp.created_at DESC
       LIMIT 1`,
      params
    );

    if (!planResult.rows.length) return null;

    const plan = planResult.rows[0];

    // Lấy 7 ngày học + trạng thái nộp bài (submission)
    const daysResult = await pool.query(
      `SELECT
         spd.id AS "planDayId",
         spd.day_number AS "day",
         spd.topic_id AS "topicId",
         t.name AS "topicName",
         t.code AS "topicCode",
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
       LEFT JOIN topics t ON t.id = spd.topic_id
       WHERE spd.plan_id = $1
       ORDER BY spd.day_number`,
      [plan.id, studentId]
    );

    const startsOnStr = typeof plan.startsOn === 'string'
      ? plan.startsOn.slice(0, 10)
      : new Date(plan.startsOn).toISOString().slice(0, 10);

    const days = daysResult.rows.map(day => ({
      ...day,
      studyDate: getStudyDate(startsOnStr, day.day),
      isCompleted: !!day.submission,
    }));

    const completedCount = days.filter(d => d.isCompleted).length;

    return {
      planId: plan.id,
      subjectId: plan.subjectId,
      startsOn: startsOnStr,
      status: plan.status,
      durationDays: 7,
      completedDays: completedCount,
      progressPercent: Math.round((completedCount / 7) * 100),
      days,
    };
  },

  /**
   * Cập nhật các ngày học chưa nộp bài (unsubmitted days) trong kế hoạch hiện có.
   * Giữ nguyên các ngày đã hoàn thành và câu trả lời lịch sử.
   * Xóa câu hỏi nháp chưa làm của các ngày được cập nhật để sinh mới cho topic mới.
   */
  async updateUnsubmittedPlanDays({ planId, updatedDays, schoolId = null }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updated = [];
      for (const day of updatedDays) {
        // Kiểm tra xem ngày này đã nộp bài chưa
        const subCheck = await client.query(
          `SELECT 1 FROM study_plan_day_submissions WHERE plan_day_id = $1 LIMIT 1`,
          [day.planDayId]
        );


        if (subCheck.rows.length > 0) {
          continue;
        }

        // Bảo vệ cả các ngày sinh viên đã trả lời
        // nhưng chưa nộp bài.
        const answerCheck = await client.query(
          `SELECT 1
   FROM study_plan_day_answers a
   JOIN study_plan_questions q
     ON q.id = a.question_id
   WHERE q.plan_day_id = $1
   LIMIT 1`,
          [day.planDayId]
        );

        if (answerCheck.rows.length > 0) {
          console.log(
            "[STUDY PLAN] Skipping day with saved answers:",
            day.planDayId
          );

          continue;
        }


        // Xóa câu hỏi nháp cũ chưa làm của ngày này
        await client.query(
          `DELETE FROM study_plan_questions WHERE plan_day_id = $1`,
          [day.planDayId]
        );

        // Cập nhật thông tin ngày học
        const result = await client.query(
          `UPDATE study_plan_days
           SET 
             topic_id = $1,
             activity = $2,
             duration_minutes = $3,
             target_questions = $4,
             reason = $5,
             content_status = 'pending'
           WHERE id = $6 AND plan_id = $7
           RETURNING *`,
          [
            day.topicId,
            day.activity,
            day.durationMinutes,
            day.targetQuestions,
            day.reason,
            day.planDayId,
            planId,
          ]
        );

        if (result.rows[0]) {
          updated.push(result.rows[0]);
        }
      }

      await client.query(
        `UPDATE study_plans SET updated_at = NOW() WHERE id = $1`,
        [planId]
      );

      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};

module.exports = StudyPlannerRepository;
