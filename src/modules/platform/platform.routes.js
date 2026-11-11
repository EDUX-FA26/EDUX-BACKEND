

const express = require("express");

const {
  requirePlatformAdmin,
} = require("../../middlewares/requirePlatformAdmin");

function createPlatformRouter({ authenticate }) {
  if (typeof authenticate !== "function") {
    throw new Error(
      "PlatformRouter requires authenticate middleware"
    );
  }

  const router = express.Router();

  // JWT authentication first.
  router.use(authenticate);

  // Platform authorization for every route.
  router.use(requirePlatformAdmin);

  // =========================================
  // GET /api/platform/me
  // =========================================

  router.get("/me", (req, res) => {
    return res.status(200).json({
      success: true,

      platformAdmin: {
        userId: req.platformAdmin.userId,
        role: "platform_admin",
      },
    });
  });

  return router;
}

module.exports = {
  createPlatformRouter,
};
