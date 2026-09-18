const express = require("express");
const cors = require("cors");

const app = express();

//const userRoutes = require("./routes/user.routes");
const authRoutes = require("./modules/auth/auth.routes");



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
//app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);

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