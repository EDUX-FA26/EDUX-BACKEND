
const { pool, withTransaction } = require('../../config/db.config');

const ClassHealthRepository = {

    async getStreakSignals(classId) {
        const query = `
      SELECT
        cm.student_id,
        c.subject_id,

        ss.current_streak,
        ss.longest_streak,
        ss.last_activity_date,
        ss.streak_lost_at,
        ss.is_active AS streak_is_active,

        COALESCE(a.active_days_7d, 0)::int
          AS active_days_7d,

        COALESCE(a.active_days_previous_7d, 0)::int
          AS active_days_previous_7d,

        COALESCE(a.active_days_30d, 0)::int
          AS active_days_30d

      FROM class_members cm

      JOIN classes c
        ON c.id = cm.class_id

      LEFT JOIN subject_streaks ss
        ON ss.user_id = cm.student_id
        AND ss.subject_id = c.subject_id

      LEFT JOIN LATERAL (
        SELECT
          COUNT(DISTINCT activity_date)
            FILTER (
              WHERE activity_date >=
                (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 6
            ) AS active_days_7d,

          COUNT(DISTINCT activity_date)
            FILTER (
              WHERE activity_date >=
                (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 13
              AND activity_date <
                (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 6
            ) AS active_days_previous_7d,

          COUNT(DISTINCT activity_date)
            FILTER (
              WHERE activity_date >=
                (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 29
            ) AS active_days_30d

        FROM subject_streak_activities

        WHERE user_id = cm.student_id
          AND subject_id = c.subject_id
          AND activity_date <=
            (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      ) a ON TRUE

      WHERE cm.class_id = $1
        AND cm.status = 'active'

      ORDER BY cm.student_id
    `;

        const { rows } = await pool.query(query, [classId]);

        return rows;
    },



    async getQuizSignals(classId) {
        const query = `
    WITH test_results AS (
      SELECT
        ft.id AS test_id,
        ft.user_id AS student_id,
        ft.submitted_at,

        COUNT(fta.id) FILTER (
          WHERE fta.is_correct IS NOT NULL
        )::int AS graded_answers,

        COUNT(fta.id) FILTER (
          WHERE fta.is_correct = true
        )::int AS correct_answers

      FROM class_members cm

      JOIN classes c
        ON c.id = cm.class_id

      JOIN flashcard_decks fd
        ON fd.subject_id = c.subject_id

      JOIN flashcard_tests ft
        ON ft.deck_id = fd.id
        AND ft.user_id = cm.student_id

      LEFT JOIN flashcard_test_answers fta
        ON fta.test_id = ft.id

      WHERE cm.class_id = $1
        AND cm.status = 'active'
        AND ft.status = 'submitted'

      GROUP BY
        ft.id,
        ft.user_id,
        ft.submitted_at
    ),

    scored_tests AS (
      SELECT
        *,
        ROUND(
          correct_answers * 100.0 /
          NULLIF(graded_answers, 0),
          2
        ) AS accuracy

      FROM test_results

      WHERE graded_answers > 0
    ),

    ranked_tests AS (
      SELECT
        *,
        ROW_NUMBER() OVER (
          PARTITION BY student_id
          ORDER BY submitted_at DESC NULLS LAST, test_id DESC
        ) AS rn

      FROM scored_tests
    )

    SELECT
      cm.student_id,

      COUNT(rt.test_id)::int
        AS completed_tests,

      ROUND(
        AVG(rt.accuracy),
        2
      ) AS average_accuracy,

      ROUND(
        AVG(rt.accuracy) FILTER (
          WHERE rt.rn <= 3
        ),
        2
      ) AS recent_accuracy,

      COUNT(rt.test_id) FILTER (
        WHERE rt.rn <= 3
      )::int AS recent_test_count,

      COUNT(rt.test_id) FILTER (
        WHERE rt.rn <= 3
          AND rt.accuracy < 50
      )::int AS low_recent_tests

    FROM class_members cm

    LEFT JOIN ranked_tests rt
      ON rt.student_id = cm.student_id

    WHERE cm.class_id = $1
      AND cm.status = 'active'

    GROUP BY cm.student_id

    ORDER BY cm.student_id
  `;

        const { rows } = await pool.query(query, [classId]);

        return rows;
    },



    async getAssignmentSignals(classId) {
        const query = `
    WITH member_assignments AS (
      SELECT
        cm.student_id,
        a.id AS assignment_id,
        a.deadline,

        sub.has_submission,
        sub.first_submitted_at

      FROM class_members cm

      JOIN assignments a
        ON a.class_id = cm.class_id
        AND a.publish_status = 'published'
        AND a.deadline < NOW()

      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            BOOL_OR(
              s.status IN ('submitted', 'graded', 'late')
            ),
            false
          ) AS has_submission,

          MIN(
            COALESCE(
              s.submitted_at,
              sv.first_submitted_at
            )
          ) AS first_submitted_at

        FROM submissions s

        LEFT JOIN LATERAL (
          SELECT MIN(submitted_at)
            AS first_submitted_at

          FROM submission_versions
          WHERE submission_id = s.id
        ) sv ON TRUE

        WHERE s.assignment_id = a.id
          AND s.student_id = cm.student_id
      ) sub ON TRUE

      WHERE cm.class_id = $1
        AND cm.status = 'active'
    )

    SELECT
      cm.student_id,

      COUNT(ma.assignment_id)::int
        AS total_due,

      COUNT(ma.assignment_id) FILTER (
        WHERE ma.has_submission = true
      )::int AS submitted_count,

      COUNT(ma.assignment_id) FILTER (
        WHERE ma.has_submission = false
      )::int AS overdue_count,

      COUNT(ma.assignment_id) FILTER (
        WHERE ma.has_submission = true
          AND ma.first_submitted_at > ma.deadline
      )::int AS late_count

    FROM class_members cm

    LEFT JOIN member_assignments ma
      ON ma.student_id = cm.student_id

    WHERE cm.class_id = $1
      AND cm.status = 'active'

    GROUP BY cm.student_id
  `;

        const { rows } = await pool.query(query, [classId]);

        return rows;
    },



};


module.exports = ClassHealthRepository;
