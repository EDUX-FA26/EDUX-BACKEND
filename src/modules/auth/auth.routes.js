const express = require("express");
const router = express.Router();

const authController = require("./auth.controller");
const { authenticate } = require("../../middlewares/auth.middleware");
const { validate } = require("../../middlewares/validate.middleware");
const { 
  registerSchema, 
  loginSchema, 
  refreshTokenSchema, 
  changePasswordSchema 
} = require("./auth.validation");

router.post("/register", validate(registerSchema), authController.register);
router.post("/login", validate(loginSchema), authController.login);
router.post("/refresh-token", validate(refreshTokenSchema), authController.refreshToken);

router.post("/logout", authenticate, authController.logout);
router.get("/me", authenticate, authController.getMe);
router.put("/change-password", authenticate, validate(changePasswordSchema), authController.changePassword);

module.exports = router;