const express = require("express");
const router = express.Router();

const authController = require("./auth.controller");
const { authenticate } = require("../../middlewares/auth.middleware");
const { validate } = require("../../middlewares/validate.middleware");
const { 
  registerSchema, 
  loginSchema, 
  refreshTokenSchema, 
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema
} = require("./auth.validation");

router.post("/register", validate(registerSchema), authController.register);
router.post("/login", validate(loginSchema), authController.login);
router.post("/refresh-token", validate(refreshTokenSchema), authController.refreshToken);

router.post("/forgot-password", validate(forgotPasswordSchema), authController.forgotPassword);
router.post("/reset-password", validate(resetPasswordSchema), authController.resetPassword);

router.post("/logout", authenticate, authController.logout);
router.patch("/change-password", authenticate, validate(changePasswordSchema), authController.changePassword);

module.exports = router;