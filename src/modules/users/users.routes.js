const express = require("express");
const router = express.Router();

const usersController = require("./users.controller");
const { authenticate } = require("../../middlewares/auth.middleware");
const { validate } = require("../../middlewares/validate.middleware");
const { updateProfileSchema } = require("./users.validation");
const { changePasswordSchema } = require("../auth/auth.validation");

router.get("/me", authenticate, usersController.getMe);
router.patch("/me", authenticate, validate(updateProfileSchema), usersController.updateProfile);
router.patch("/me/password", authenticate, validate(changePasswordSchema), usersController.changePassword);

module.exports = router;
