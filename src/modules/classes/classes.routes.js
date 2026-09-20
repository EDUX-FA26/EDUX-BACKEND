const express = require('express');
const router = express.Router();
const multer = require('multer');

const classesController = require('./classes.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const { getClassesQuery, createClass, updateClass, getMembersQuery } = require('./classes.validation');

const upload = multer({ storage: multer.memoryStorage() });

const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
  }
  next();
};

router.use(authenticate);

// Classes CRUD
router.get('/', validate(getClassesQuery, 'query'), classesController.getClasses);
router.get('/:id', classesController.getClassById);
router.post('/', authorize('admin'), validate(createClass), classesController.createClass);
router.patch('/:id', authorize('admin'), validate(updateClass), classesController.updateClass);
router.delete('/:id', authorize('admin'), classesController.deleteClass);

// Members
router.get('/:id/members', validate(getMembersQuery, 'query'), classesController.getMembers);
router.post('/:id/members/import', authorize('admin', 'lecturer'), upload.single('file'), classesController.importMembers);
router.get('/:id/members/export', authorize('admin', 'lecturer'), classesController.exportMembers);
router.delete('/:id/members/:userId', authorize('admin', 'lecturer'), classesController.removeMember);

module.exports = router;
