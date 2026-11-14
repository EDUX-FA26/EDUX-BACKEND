
const express = require("express");
const router = express.Router();

const usersController = require("./users.controller");

const {
  authenticate,
} = require("../../middlewares/auth.middleware");

const {
  requireSchoolContext,
} = require("../../middlewares/requireSchoolContext");

const {
  validate,
} = require("../../middlewares/validate.middleware");

const {
  updateProfileSchema,
} = require("./users.validation");

const {
  changePasswordSchema,
} = require("../auth/auth.validation");

// ===========================================
// GLOBAL AUTHENTICATION
// ===========================================

router.use(authenticate);

// ===========================================
// GLOBAL ACCOUNT
// Password belongs to the EDUX account,
// not to an individual school.
// ===========================================

router.patch(
  "/me/password",
  validate(changePasswordSchema),
  usersController.changePassword
);

// ===========================================
// SCHOOL-SCOPED PROFILE
// ===========================================

router.get(
  "/me",
  requireSchoolContext,
  usersController.getMe
);

router.patch(
  "/me",
  requireSchoolContext,
  validate(updateProfileSchema),
  usersController.updateProfile
);

module.exports = router;
