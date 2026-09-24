const express = require("express");
const cors = require("cors");

const app = express();

const userRoutes = require("./modules/users/users.routes");
const authRoutes = require("./modules/auth/auth.routes");
const classesRoutes = require("./modules/classes/classes.routes");
const notificationsRoutes = require("./modules/notifications/notifications.routes");
const dashboardRoutes = require("./modules/dashboards/dashboard.routes");
const flashcardsRoutes = require("./modules/flashcards/flashcards.routes");
const { classIdRouter: classMaterialsRouter, materialIdRouter: materialClassesRouter } = require("./modules/class-materials/classMaterial.routes");
const assignmentsRoutes = require("./modules/assignments/assignment.routes");
const assignmentMaterialsRouter = require("./modules/assignment-materials/assignmentMaterial.routes");
const { gradesRouter, gradebooksRouter } = require("./modules/grading/grading.routes");
const submissionsRoutes = require("./modules/submissions/submission.routes");
const adminRoutes = require("./modules/admin/admin.routes");

// =========================
// Middleware
// =========================

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json());

app.use(express.urlencoded({ extended: true }));


// =========================
// Health Check
// =========================

// API routes
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/classes", classesRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/dashboards", dashboardRoutes);
app.use("/api/flashcards", flashcardsRoutes);

// Module 7 — Learning Materials
// A. Class Materials
app.use("/api/classes/:classId/materials", classMaterialsRouter);
app.use("/api/materials/classes", materialClassesRouter);

// B. Assignments & Assignment Materials
app.use("/api/assignments", assignmentsRoutes);
// B. Assignment Materials
app.use("/api/assignments/:assignmentId/materials", assignmentMaterialsRouter);

// Module 10 — Grades
app.use("/api/grades", gradesRouter);
app.use("/api/gradebooks", gradebooksRouter);

// Module 9 - Submissions
app.use("/api/submissions", submissionsRoutes);

// Admin Module
app.use("/api/admin", adminRoutes);

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