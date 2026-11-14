const express = require("express");
const cors = require("cors");

const app = express();

const userRoutes = require("./modules/users/users.routes");
const authRoutes = require("./modules/auth/auth.routes");
const classesRoutes = require("./modules/classes/classes.routes");
const notificationsRoutes = require("./modules/notifications/notifications.routes");
const dashboardRoutes = require("./modules/dashboards/dashboard.routes");
const flashcardsRoutes = require("./modules/flashcards/flashcards.routes");
const flashcardsTestRoutes = require("./modules/flashcards-test/flashcardsTest.routes");
const { classIdRouter: classMaterialsRouter, materialIdRouter: materialClassesRouter } = require("./modules/class-materials/classMaterial.routes");
const assignmentsRoutes = require("./modules/assignments/assignment.routes");
const assignmentMaterialsRouter = require("./modules/assignment-materials/assignmentMaterial.routes");
const { gradesRouter, gradebooksRouter, gradingRouter } = require("./modules/grading/grading.routes");
const submissionsRoutes = require("./modules/submissions/submission.routes");
const semestersRoutes = require("./modules/semesters/semesters.routes");
const subjectsRoutes = require("./modules/subjects/subjects.routes");
const topicsRoutes = require("./modules/topics/topics.routes");
const searchRoutes = require("./modules/search/search.routes");
const learningRoutes = require("./modules/learning/learning.routes");
const adminRoutes = require("./modules/admin/admin.routes");
const reportsRoutes = require("./modules/reports/reports.routes");
const communicationsRoutes = require("./modules/communications/communications.routes");
const focusRoutes = require("./modules/focus/focus.routes");
const todosRoutes = require("./modules/todos/todos.routes");
const aiChatRoutes = require("./modules/ai-chat/aiChat.routes");
const projectsRoutes = require(
  './modules/projects/projects.routes'
);
const {
  createSchoolsRouter,
} = require("./modules/schools/schools.routes");
const {
  createPlatformRouter,
} = require("./modules/platform/platform.routes");
const forumRoutes = require("./modules/forum/forum.routes");


// =========================
// Middleware
// =========================

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

// Forum attachments are sent as small data URLs together with the post/comment.
// Keep a bounded request size while allowing multiple images or documents.
app.use(express.json({ limit: '20mb' }));

app.use(express.urlencoded({ extended: true }));



// =========================
// Health Check
// =========================

const { authenticate } = require("./middlewares/auth.middleware");
const { requireSchoolContext } = require("./middlewares/requireSchoolContext");
const { authorizeSchoolRoles } = require("./middlewares/authorizeSchoolRoles");
const classesController = require("./modules/classes/classes.controller");
const slotsRouter = express.Router();
slotsRouter.use(
  authenticate,
  requireSchoolContext,
  authorizeSchoolRoles("school_admin", "lecturer", "student")
);
slotsRouter.get("/:slotId", classesController.getSlotById);

// API routes
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
const schoolsRoutes = createSchoolsRouter({
  authenticate,
});
const platformRoutes = createPlatformRouter({
  authenticate,
});

app.use("/api/platform", platformRoutes);
app.use("/api/schools", schoolsRoutes);
app.use("/api/classes", classesRoutes);
app.use("/api/lecturer/classes", classesRoutes);
app.use("/api/student/classes", classesRoutes);
app.use("/api/slots", slotsRouter);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/dashboards", dashboardRoutes);
app.use("/api/flashcards", flashcardsRoutes);
app.use("/api/flashcards", flashcardsTestRoutes);
app.use('/api/projects', projectsRoutes);
// Module 7 — Learning Materials
// A. Class Materials
app.use("/api/classes/:classId/materials", classMaterialsRouter);
app.use("/api/materials/classes", materialClassesRouter);

// B. Assignments & Assignment Materials
app.use("/api/assignments", assignmentsRoutes);
app.use("/api/lecturer/assignments", assignmentsRoutes);
app.use("/api/student/assignments", assignmentsRoutes);
// B. Assignment Materials
app.use("/api/assignments/:assignmentId/materials", assignmentMaterialsRouter);

// Module 10 — Grades & Grading AI Audit
app.use("/api/grades", gradesRouter);
app.use("/api/gradebooks", gradebooksRouter);
app.use("/api", gradingRouter);
app.use("/api/semesters", semestersRoutes);
app.use("/api/subjects", subjectsRoutes);
app.use("/api/topics", topicsRoutes);
app.use("/api/search", searchRoutes);

// Module 9 - Submissions
app.use("/api/submissions", submissionsRoutes);

// Learning Activity & Learning Streak
app.use("/api/learning", learningRoutes);
// Admin Module
app.use("/api/admin", adminRoutes);
// Reports Module
app.use("/api/reports", reportsRoutes);
// Communications Module
app.use("/api/communications", communicationsRoutes);
// Focus Room (Pomodoro) & Smart Todo
app.use("/api/focus", focusRoutes);
app.use("/api/todos", todosRoutes);
app.use("/api/ai-chat", aiChatRoutes);
app.use("/api/forum", forumRoutes);

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "EDUX Backend is running",
    timestamp: new Date().toISOString(),
  });
});


// =========================
// 404
// =========================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});


// =========================
// Error Handler
// =========================

app.use((err, req, res, next) => {
  console.error("❌ Server error:", err);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

module.exports = app;
