/**
 * ===========================================================================
 * FILE: src/modules/reports/reports.repository.js
 * MÔ TẢ: Tầng truy vấn dữ liệu (Repository) phục vụ báo cáo & thống kê cho Admin
 * ===========================================================================
 */

const { pool } = require("../../config/db.config");

/**
 * Helper trích xuất danh sách khai báo AI từ chuỗi JSON note trong submission_versions
 */
const extractDeclarationsFromNote = (rawNote) => {
  if (!rawNote) return { declarations: [], scopeCount: 0, parsed: null };
  try {
    const parsed =
      typeof rawNote === "string" ? JSON.parse(rawNote) : rawNote;
    if (!parsed || typeof parsed !== "object") {
      return { declarations: [], scopeCount: 0, parsed: null };
    }

    const list = [];
    let scopeCount = 0;

    if (Array.isArray(parsed.scopes) && parsed.scopes.length > 0) {
      scopeCount = parsed.scopes.length;
      for (const scope of parsed.scopes) {
        if (!scope || !scope.declarations) continue;
        if (Array.isArray(scope.declarations)) {
          list.push(...scope.declarations);
        } else if (typeof scope.declarations === "object") {
          list.push(...Object.values(scope.declarations));
        }
      }
    } else if (parsed.declarations) {
      scopeCount = 1;
      if (Array.isArray(parsed.declarations)) {
        list.push(...parsed.declarations);
      } else if (typeof parsed.declarations === "object") {
        list.push(...Object.values(parsed.declarations));
      }
    }

    const validDeclarations = list
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        tool: String(item.aiTool || item.tool || item.ai_tool || "").trim(),
        decision: String(
          item.decision || item.student_decision || item.studentDecision || ""
        ).trim(),
        criterion: String(
          item.title || item.rubricKey || item.criterion || ""
        ).trim(),
      }))
      .filter((item) => item.tool || item.decision);

    return { declarations: validDeclarations, scopeCount, parsed };
  } catch {
    return { declarations: [], scopeCount: 0, parsed: null };
  }
};

/**
 * 1. Thống kê tổng quan hệ thống (System Overview)
 * Trả về các chỉ số tổng hợp và dữ liệu phân bổ chi tiết cho các biểu đồ.
 */
const getSystemStats = async () => {
  const [
    usersRes,
    classesRes,
    subjectsRes,
    departmentsRes,
    semestersRes,
    assignmentsRes,
    submissionsRes,
    gradesRes,
    aiEvalsRes,
    classesBySemesterRes,
    subjectsByDeptRes,
    gradeDistRes,
  ] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE is_active = true)::int AS active_users,
        COUNT(*) FILTER (WHERE is_active = false)::int AS inactive_users,
        COUNT(*) FILTER (WHERE role = 'student')::int AS total_students,
        COUNT(*) FILTER (WHERE role = 'lecturer')::int AS total_lecturers,
        COUNT(*) FILTER (WHERE role = 'admin')::int AS total_admins
      FROM users
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS total_classes,
        COUNT(*) FILTER (WHERE is_active = true)::int AS active_classes
      FROM classes
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS total_subjects,
        COUNT(*) FILTER (WHERE is_active = true)::int AS active_subjects
      FROM subjects
    `),
    pool.query(`SELECT COUNT(*)::int AS total_departments FROM departments`),
    pool.query(`
      SELECT
        COUNT(*)::int AS total_semesters,
        COUNT(*) FILTER (WHERE is_active = true)::int AS active_semesters
      FROM semesters
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS total_assignments,
        COUNT(*)::int AS published_assignments
      FROM assignments
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS total_submissions,
        COUNT(*) FILTER (WHERE status = 'late')::int AS late_submissions,
        COUNT(*) FILTER (WHERE status = 'submitted')::int AS ontime_submissions
      FROM submissions
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS graded_submissions,
        ROUND(AVG(score)::numeric, 2) AS avg_score,
        MAX(score)::numeric AS max_score,
        MIN(score)::numeric AS min_score
      FROM grades
    `),
    pool.query(`SELECT COUNT(*)::int AS total_ai_evaluations FROM ai_evaluations`),
    pool.query(`
      SELECT
        s.code AS semester_code,
        s.name AS semester_name,
        COUNT(DISTINCT c.id)::int AS class_count,
        COUNT(DISTINCT cm.student_id)::int AS student_count,
        COUNT(DISTINCT a.id)::int AS assignment_count
      FROM semesters s
      LEFT JOIN classes c ON c.semester_id = s.id
      LEFT JOIN class_members cm ON cm.class_id = c.id
      LEFT JOIN assignments a ON a.class_id = c.id
      GROUP BY s.id, s.code, s.name, s.start_date
      ORDER BY class_count DESC, s.start_date DESC NULLS LAST
      LIMIT 8
    `),
    pool.query(`
      SELECT
        d.code AS department_code,
        d.name AS department_name,
        COUNT(DISTINCT sub.id)::int AS subject_count,
        COUNT(DISTINCT c.id)::int AS class_count
      FROM departments d
      LEFT JOIN subjects sub ON sub.department_id = d.id
      LEFT JOIN classes c ON c.subject_id = sub.id
      GROUP BY d.id, d.code, d.name
      ORDER BY subject_count DESC, class_count DESC, d.code ASC
      LIMIT 8
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE score >= 8.5)::int AS excellent_count,
        COUNT(*) FILTER (WHERE score >= 7.0 AND score < 8.5)::int AS good_count,
        COUNT(*) FILTER (WHERE score >= 5.5 AND score < 7.0)::int AS fair_count,
        COUNT(*) FILTER (WHERE score < 5.5)::int AS below_avg_count
      FROM grades
      WHERE score IS NOT NULL
    `),
  ]);

  const u = usersRes.rows[0] || {};
  const c = classesRes.rows[0] || {};
  const sub = subjectsRes.rows[0] || {};
  const d = departmentsRes.rows[0] || {};
  const sem = semestersRes.rows[0] || {};
  const a = assignmentsRes.rows[0] || {};
  const s = submissionsRes.rows[0] || {};
  const g = gradesRes.rows[0] || {};
  const ai = aiEvalsRes.rows[0] || {};
  const gd = gradeDistRes.rows[0] || {};

  const totalSubmissions = s.total_submissions || 0;
  const gradedSubmissions = g.graded_submissions || 0;
  const ungradedSubmissions = Math.max(0, totalSubmissions - gradedSubmissions);
  const lateSubmissions = s.late_submissions || 0;
  const onTimeSubmissions = Math.max(0, totalSubmissions - lateSubmissions);

  return {
    totalUsers: u.total_users || 0,
    activeUsers: u.active_users || 0,
    inactiveUsers: u.inactive_users || 0,
    totalStudents: u.total_students || 0,
    totalLecturers: u.total_lecturers || 0,
    totalAdmins: u.total_admins || 0,
    totalClasses: c.total_classes || 0,
    activeClasses: c.active_classes || 0,
    totalSubjects: sub.total_subjects || 0,
    activeSubjects: sub.active_subjects || 0,
    totalDepartments: d.total_departments || 0,
    totalSemesters: sem.total_semesters || 0,
    activeSemesters: sem.active_semesters || 0,
    totalAssignments: a.total_assignments || 0,
    publishedAssignments: a.published_assignments || 0,
    totalSubmissions,
    onTimeSubmissions,
    lateSubmissions,
    gradedSubmissions,
    ungradedSubmissions,
    avgGradeScore: g.avg_score != null ? Number(g.avg_score) : null,
    maxGradeScore: g.max_score != null ? Number(g.max_score) : null,
    minGradeScore: g.min_score != null ? Number(g.min_score) : null,
    totalAiEvaluations: ai.total_ai_evaluations || 0,
    userRoleBreakdown: [
      { role: "Sinh viên", count: u.total_students || 0 },
      { role: "Giảng viên", count: u.total_lecturers || 0 },
      { role: "Quản trị viên", count: u.total_admins || 0 },
    ],
    submissionStatusBreakdown: [
      { status: "Nộp đúng hạn", count: onTimeSubmissions },
      { status: "Nộp muộn", count: lateSubmissions },
    ],
    gradingStatusBreakdown: [
      { status: "Đã chấm điểm", count: gradedSubmissions },
      { status: "Chưa chấm điểm", count: ungradedSubmissions },
    ],
    gradeDistribution: [
      { band: "Xuất sắc (8.5 - 10)", count: gd.excellent_count || 0 },
      { band: "Giỏi (7.0 - 8.4)", count: gd.good_count || 0 },
      { band: "Khá (5.5 - 6.9)", count: gd.fair_count || 0 },
      { band: "TB / Yếu (< 5.5)", count: gd.below_avg_count || 0 },
    ],
    classesBySemester: classesBySemesterRes.rows,
    subjectsByDepartment: subjectsByDeptRes.rows,
  };
};

/**
 * 2. Thống kê tình hình sử dụng AI (AI Usage & Transparency)
 * Kết hợp dữ liệu từ bảng ai_interactions, ai_evaluations và khai báo AI trong submission_versions.note
 */
const getAiUsageStats = async () => {
  const [interactionsToolRes, interactionsDecisionRes, versionsRes, aiEvalsRes] =
    await Promise.all([
      pool.query(`
        SELECT ai_tool, COUNT(*)::int AS count
        FROM ai_interactions
        GROUP BY ai_tool
      `),
      pool.query(`
        SELECT student_decision, COUNT(*)::int AS count
        FROM ai_interactions
        WHERE student_decision IS NOT NULL
        GROUP BY student_decision
      `),
      pool.query(`
        SELECT
          sv.submission_id,
          sv.note,
          a.title AS assignment_title,
          c.class_code
        FROM submission_versions sv
        JOIN submissions s ON s.id = sv.submission_id
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        WHERE sv.is_latest = true AND sv.note IS NOT NULL
      `),
      pool.query(`
        SELECT
          ae.submission_id,
          ae.pattern,
          ae.risk_level,
          ae.transparency_score,
          ae.prompt_quality_score,
          ae.reflection_quality_score,
          ae.ai_dependency_score,
          ae.total_score,
          ae.evaluation_data,
          a.title AS assignment_title,
          c.class_code
        FROM ai_evaluations ae
        LEFT JOIN submissions s ON s.id = ae.submission_id
        LEFT JOIN assignments a ON a.id = s.assignment_id
        LEFT JOIN classes c ON c.id = a.class_id
      `),
    ]);

  const toolCounts = new Map();
  const decisionCounts = new Map();
  const riskCounts = new Map([
    ["Thấp (Low)", 0],
    ["Trung bình (Medium)", 0],
    ["Cao (High)", 0],
  ]);
  const patternCounts = new Map();
  const assignmentUsageMap = new Map();

  for (const row of interactionsToolRes.rows) {
    const key = row.ai_tool || "Khác";
    toolCounts.set(key, (toolCounts.get(key) || 0) + Number(row.count || 0));
  }
  for (const row of interactionsDecisionRes.rows) {
    const key = row.student_decision || "Khác";
    decisionCounts.set(
      key,
      (decisionCounts.get(key) || 0) + Number(row.count || 0)
    );
  }

  let declaredSubmissionsCount = 0;
  let totalScopesCount = 0;

  for (const row of versionsRes.rows) {
    const { declarations, scopeCount } = extractDeclarationsFromNote(row.note);
    if (declarations.length === 0) continue;

    declaredSubmissionsCount += 1;
    totalScopesCount += scopeCount;

    const assignKey = `${row.class_code || "Lớp"} - ${row.assignment_title || "Bài tập"}`;
    const currentAssign = assignmentUsageMap.get(assignKey) || {
      assignment_label: assignKey,
      declaration_count: 0,
      submission_count: 0,
    };
    currentAssign.declaration_count += declarations.length;
    currentAssign.submission_count += 1;
    assignmentUsageMap.set(assignKey, currentAssign);

    let notDeclaredInSubmission = 0;
    for (const decl of declarations) {
      if (decl.tool) {
        toolCounts.set(decl.tool, (toolCounts.get(decl.tool) || 0) + 1);
      } else if (decl.decision) {
        toolCounts.set(
          "Chưa chọn công cụ",
          (toolCounts.get("Chưa chọn công cụ") || 0) + 1
        );
      }

      if (decl.decision) {
        decisionCounts.set(
          decl.decision,
          (decisionCounts.get(decl.decision) || 0) + 1
        );
        if (decl.decision === "Not Declared") {
          notDeclaredInSubmission += 1;
        }
      }
    }

    if (notDeclaredInSubmission > 0) {
      riskCounts.set(
        "Trung bình (Medium)",
        (riskCounts.get("Trung bình (Medium)") || 0) + 1
      );
      patternCounts.set(
        "Khai báo thiếu minh bạch",
        (patternCounts.get("Khai báo thiếu minh bạch") || 0) + 1
      );
    } else {
      riskCounts.set("Thấp (Low)", (riskCounts.get("Thấp (Low)") || 0) + 1);
      patternCounts.set(
        "Khai báo AI hợp lệ",
        (patternCounts.get("Khai báo AI hợp lệ") || 0) + 1
      );
    }
  }

  let totalTransparency = 0;
  let countTransparency = 0;
  let totalAiScore = 0;
  let countAiScore = 0;
  let totalPromptScore = 0;
  let totalReflectionScore = 0;
  let totalDependencyScore = 0;
  const rubricCriteriaMap = new Map();

  for (const evalRow of aiEvalsRes.rows) {
    const rLevel = String(evalRow.risk_level || "low").toLowerCase();
    const riskLabel =
      rLevel === "high"
        ? "Cao (High)"
        : rLevel === "medium"
        ? "Trung bình (Medium)"
        : "Thấp (Low)";
    riskCounts.set(riskLabel, (riskCounts.get(riskLabel) || 0) + 1);

    const patternKey = evalRow.pattern
      ? String(evalRow.pattern).replaceAll("_", " ")
      : "Hậu kiểm AI";
    patternCounts.set(patternKey, (patternCounts.get(patternKey) || 0) + 1);

    if (evalRow.transparency_score != null) {
      totalTransparency += Number(evalRow.transparency_score);
      countTransparency += 1;
    }
    if (evalRow.total_score != null) {
      totalAiScore += Number(evalRow.total_score);
      countAiScore += 1;
    }
    if (evalRow.prompt_quality_score != null) {
      totalPromptScore += Number(evalRow.prompt_quality_score);
    }
    if (evalRow.reflection_quality_score != null) {
      totalReflectionScore += Number(evalRow.reflection_quality_score);
    }
    if (evalRow.ai_dependency_score != null) {
      totalDependencyScore += Number(evalRow.ai_dependency_score);
    }

    const evalData =
      typeof evalRow.evaluation_data === "string"
        ? JSON.parse(evalRow.evaluation_data)
        : evalRow.evaluation_data;
    if (evalData && Array.isArray(evalData.rubrics)) {
      for (const rub of evalData.rubrics) {
        const label =
          rub.criterion_name || rub.criterion_id || "Tiêu chí hậu kiểm";
        const prev = rubricCriteriaMap.get(label) || {
          criterion: label,
          totalScore: 0,
          maxScore: Number(rub.max_score) || 2,
          count: 0,
        };
        prev.totalScore += Number(rub.score) || 0;
        prev.count += 1;
        rubricCriteriaMap.set(label, prev);
      }
    }
  }

  const tools = Array.from(toolCounts.entries())
    .map(([ai_tool, count]) => ({ ai_tool, count }))
    .sort((a, b) => b.count - a.count);

  const decisions = Array.from(decisionCounts.entries())
    .map(([student_decision, count]) => ({ student_decision, count }))
    .sort((a, b) => b.count - a.count);

  const riskDistribution = Array.from(riskCounts.entries())
    .map(([risk_level, count]) => ({ risk_level, count }))
    .filter((item) => item.count > 0);

  const patternDistribution = Array.from(patternCounts.entries())
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);

  const assignmentBreakdown = Array.from(assignmentUsageMap.values()).sort(
    (a, b) => b.declaration_count - a.declaration_count
  );

  const rubricBreakdown = Array.from(rubricCriteriaMap.values()).map((item) => ({
    criterion: item.criterion,
    avg_score:
      item.count > 0
        ? Number((item.totalScore / item.count).toFixed(2))
        : 0,
    max_score: item.maxScore,
    percent:
      item.count > 0 && item.maxScore > 0
        ? Number(
            (((item.totalScore / item.count) / item.maxScore) * 100).toFixed(1)
          )
        : 0,
  }));

  const totalInteractions = tools.reduce((acc, row) => acc + row.count, 0);
  const evalCount = aiEvalsRes.rows.length;

  return {
    totalInteractions,
    declaredSubmissionsCount,
    totalScopesCount,
    totalEvaluations: evalCount,
    avgTransparencyScore:
      countTransparency > 0
        ? Number((totalTransparency / countTransparency).toFixed(2))
        : null,
    avgTotalScore:
      countAiScore > 0
        ? Number((totalAiScore / countAiScore).toFixed(2))
        : null,
    avgPromptScore:
      evalCount > 0 ? Number((totalPromptScore / evalCount).toFixed(2)) : null,
    avgReflectionScore:
      evalCount > 0
        ? Number((totalReflectionScore / evalCount).toFixed(2))
        : null,
    avgDependencyScore:
      evalCount > 0
        ? Number((totalDependencyScore / evalCount).toFixed(2))
        : null,
    tools,
    decisions,
    riskDistribution,
    patternDistribution,
    assignmentBreakdown,
    rubricBreakdown,
  };
};

/**
 * 3. Nhật ký cảnh báo & kiểm toán (Audit Logs)
 * Tổng hợp từ kết quả hậu kiểm AI (ai_evaluations) và lịch sử bài nộp / khai báo AI (submissions + submission_versions)
 */
const getAuditLogs = async () => {
  const [evalLogsRes, submissionLogsRes] = await Promise.all([
    pool.query(`
      SELECT
        ae.id::text AS id,
        'ai_evaluation' AS flag_type,
        COALESCE(u.full_name, u.email, 'Hệ thống AI') AS flagged_by,
        u.full_name AS student_name,
        u.student_code,
        u.email AS student_email,
        c.class_code,
        sub.code AS subject_code,
        a.title AS assignment_title,
        COALESCE(ae.risk_level, 'low') AS risk_level,
        ae.transparency_score,
        ae.total_score,
        COALESCE(ae.overall_verdict, ae.pattern, 'Đánh giá minh bạch AI') AS details,
        CASE
          WHEN ae.risk_level IN ('high', 'medium') THEN 'open'
          ELSE 'reviewed'
        END AS status,
        ae.evaluated_at AS created_at
      FROM ai_evaluations ae
      JOIN submissions s ON s.id = ae.submission_id
      JOIN users u ON u.id = s.student_id
      JOIN assignments a ON a.id = s.assignment_id
      JOIN classes c ON c.id = a.class_id
      JOIN subjects sub ON sub.id = c.subject_id
      ORDER BY ae.evaluated_at DESC
      LIMIT 30
    `),
    pool.query(`
      SELECT
        s.id::text AS id,
        s.status AS submission_status,
        u.full_name AS student_name,
        u.student_code,
        u.email AS student_email,
        c.class_code,
        sub.code AS subject_code,
        a.title AS assignment_title,
        sv.version_no,
        sv.note,
        g.score AS grade_score,
        COALESCE(s.last_submitted_at, s.submitted_at, s.created_at) AS created_at
      FROM submissions s
      JOIN users u ON u.id = s.student_id
      JOIN assignments a ON a.id = s.assignment_id
      JOIN classes c ON c.id = a.class_id
      JOIN subjects sub ON sub.id = c.subject_id
      LEFT JOIN submission_versions sv ON sv.submission_id = s.id AND sv.is_latest = true
      LEFT JOIN grades g ON g.submission_id = s.id
      ORDER BY COALESCE(s.last_submitted_at, s.submitted_at, s.created_at) DESC
      LIMIT 50
    `),
  ]);

  const logs = [...evalLogsRes.rows];

  for (const row of submissionLogsRes.rows) {
    const { declarations } = extractDeclarationsFromNote(row.note);
    const declCount = declarations.length;
    const toolsUsed = [
      ...new Set(declarations.map((d) => d.tool).filter(Boolean)),
    ];
    const notDeclaredCount = declarations.filter(
      (d) => d.decision === "Not Declared"
    ).length;

    const isLate = row.submission_status === "late";
    const isGraded = row.grade_score !== null && row.grade_score !== undefined;

    let flagType = "submitted";
    if (isLate) {
      flagType = "late_submission";
    } else if (declCount > 0) {
      flagType = "ai_declaration";
    } else if (isGraded) {
      flagType = "graded_submission";
    }

    let status = "pending";
    if (isGraded) {
      status = "resolved";
    } else if (notDeclaredCount > 0 || isLate) {
      status = "open";
    }

    const detailParts = [];
    if (declCount > 0) {
      detailParts.push(
        `Khai báo ${declCount} mục AI${
          toolsUsed.length ? ` (${toolsUsed.join(", ")})` : ""
        }`
      );
    } else {
      detailParts.push("Không khai báo sử dụng AI");
    }
    if (row.version_no) {
      detailParts.push(`Lần nộp v${row.version_no}`);
    }
    if (isGraded) {
      detailParts.push(`Điểm: ${row.grade_score}`);
    }

    logs.push({
      id: row.id,
      flag_type: flagType,
      flagged_by: `${row.student_name || "Sinh viên"}${
        row.student_code ? ` (${row.student_code})` : ""
      }`,
      student_name: row.student_name,
      student_code: row.student_code,
      student_email: row.student_email,
      class_code: row.class_code,
      subject_code: row.subject_code,
      assignment_title: row.assignment_title,
      risk_level:
        notDeclaredCount > 0 ? "medium" : isLate ? "medium" : "low",
      transparency_score: null,
      total_score: row.grade_score,
      details: detailParts.join(" - "),
      status,
      created_at: row.created_at,
    });
  }

  logs.sort(
    (a, b) =>
      new Date(b.created_at || 0).getTime() -
      new Date(a.created_at || 0).getTime()
  );

  return logs.slice(0, 50);
};

/**
 * 4. Xuất dữ liệu hoạt động học tập
 * Phục vụ xuất báo cáo Excel cho Admin
 */
const getLearningActivityExportData = async () => {
  const query = `
    SELECT
      u.id AS student_id,
      u.student_code,
      u.full_name AS student_name,
      u.email,
      c.id AS class_id,
      c.class_code,
      sem.code AS semester_code,
      sub.code AS subject_code,
      sub.name AS subject_name,
      a.id AS assignment_id,
      a.title AS assignment_title,
      a.due_at AS assignment_deadline,
      a.max_score AS assignment_max_score,
      a.weight AS assignment_weight,
      s.id AS submission_id,
      s.status AS submission_status,
      s.latest_version_no,
      COALESCE(s.last_submitted_at, s.submitted_at, s.created_at) AS last_submitted_at,
      COUNT(sv.id)::int AS version_count,
      g.id AS grade_id,
      g.score,
      g.max_score,
      g.feedback,
      g.rubric_Result AS rubrics,
      grader.full_name AS grader_name,
      g.graded_at,
      CASE
        WHEN g.id IS NOT NULL THEN 'Đã chấm'
        ELSE 'Chưa chấm'
      END AS grading_status
    FROM submissions s
    JOIN users u ON s.student_id = u.id
    JOIN assignments a ON s.assignment_id = a.id
    JOIN classes c ON a.class_id = c.id
    JOIN subjects sub ON c.subject_id = sub.id
    LEFT JOIN semesters sem ON c.semester_id = sem.id
    LEFT JOIN submission_versions sv ON sv.submission_id = s.id
    LEFT JOIN grades g ON g.submission_id = s.id
    LEFT JOIN users grader ON g.graded_by = grader.id
    GROUP BY
      u.id, c.id, sem.id, sub.id, a.id, s.id, g.id, grader.id
    ORDER BY COALESCE(s.last_submitted_at, s.submitted_at, s.created_at) DESC NULLS LAST;
  `;
  const { rows } = await pool.query(query);
  return rows;
};

/**
 * 5. Xuất dữ liệu minh bạch AI
 * Kết hợp dữ liệu từ ai_evaluations và khai báo AI trong submission_versions
 */
const getAiTransparencyExportData = async () => {
  const [evalRes, declRes] = await Promise.all([
    pool.query(`
      SELECT
        s.id AS submission_id,
        u.email,
        u.full_name,
        u.student_code,
        c.class_code,
        sub.code AS subject_code,
        sub.name AS subject_name,
        a.title AS assignment_title,
        ae.pattern,
        ae.risk_level,
        ae.transparency_score,
        ae.prompt_quality_score,
        ae.reflection_quality_score,
        ae.ai_dependency_score,
        ae.total_score,
        ae.overall_verdict,
        ae.evaluation_data,
        ae.rubric_scores,
        ae.viva_questions,
        ae.evaluated_at,
        'AI Evaluation' AS source_type
      FROM ai_evaluations ae
      JOIN submissions s ON ae.submission_id = s.id
      JOIN users u ON s.student_id = u.id
      JOIN assignments a ON s.assignment_id = a.id
      JOIN classes c ON a.class_id = c.id
      JOIN subjects sub ON c.subject_id = sub.id
      ORDER BY ae.evaluated_at DESC
    `),
    pool.query(`
      SELECT
        s.id AS submission_id,
        u.email,
        u.full_name,
        u.student_code,
        c.class_code,
        sub.code AS subject_code,
        sub.name AS subject_name,
        a.title AS assignment_title,
        sv.version_no,
        sv.note,
        COALESCE(sv.submitted_at, s.last_submitted_at, s.submitted_at, s.created_at) AS evaluated_at
      FROM submission_versions sv
      JOIN submissions s ON sv.submission_id = s.id
      JOIN users u ON s.student_id = u.id
      JOIN assignments a ON s.assignment_id = a.id
      JOIN classes c ON a.class_id = c.id
      JOIN subjects sub ON c.subject_id = sub.id
      WHERE sv.is_latest = true AND sv.note IS NOT NULL
      ORDER BY COALESCE(sv.submitted_at, s.last_submitted_at, s.submitted_at, s.created_at) DESC
    `),
  ]);

  const results = [...evalRes.rows];
  const evaluatedSubIds = new Set(evalRes.rows.map((r) => r.submission_id));

  for (const row of declRes.rows) {
    if (evaluatedSubIds.has(row.submission_id)) continue;
    const { declarations, parsed } = extractDeclarationsFromNote(row.note);
    if (declarations.length === 0) continue;

    const tools = [
      ...new Set(declarations.map((d) => d.tool).filter(Boolean)),
    ];
    const decisions = [
      ...new Set(declarations.map((d) => d.decision).filter(Boolean)),
    ];

    results.push({
      submission_id: row.submission_id,
      email: row.email,
      full_name: row.full_name,
      student_code: row.student_code,
      class_code: row.class_code,
      subject_code: row.subject_code,
      subject_name: row.subject_name,
      assignment_title: row.assignment_title,
      pattern: "declared_usage",
      risk_level: decisions.includes("Not Declared") ? "medium" : "low",
      transparency_score: decisions.includes("Not Declared") ? 60 : 100,
      prompt_quality_score: null,
      reflection_quality_score: null,
      ai_dependency_score: null,
      total_score: null,
      overall_verdict: `Khai báo ${declarations.length} mục AI | Công cụ: ${
        tools.join(", ") || "Chưa chọn"
      } | Quyết định: ${decisions.join(", ") || "Chưa rõ"}`,
      evaluation_data: parsed,
      rubric_scores: null,
      viva_questions: null,
      evaluated_at: row.evaluated_at,
      source_type: "Khai báo AI của SV",
    });
  }

  return results;
};

module.exports = {
  getSystemStats,
  getAiUsageStats,
  getAuditLogs,
  getLearningActivityExportData,
  getAiTransparencyExportData,
};
