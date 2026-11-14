const router = require('express').Router();
const { authenticate } = require('../../middlewares/auth.middleware');
const { authorizeRoles } = require('../../middlewares/rbac.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const { validateQuery, validateUuidParam } = require('../../middlewares/queryValidation.middleware');
const { createSubject, updateSubject, listSubjects } = require('./subjects.validation');
const controller = require('./subjects.controller');

router.use(authenticate);

// Mọi người dùng đã đăng nhập cần đọc được danh mục môn học khi đăng bài;
// chỉ admin mới được thay đổi dữ liệu môn học.
router.get('/', authorizeRoles('admin', 'student', 'lecturer'), validateQuery(listSubjects), controller.list);
router.get('/:id', authorizeRoles('admin', 'student', 'lecturer'), validateUuidParam, controller.get);
router.post('/', authorizeRoles('admin'), validate(createSubject), controller.create);
router.patch('/:id', authorizeRoles('admin'), validateUuidParam, validate(updateSubject), controller.update);
router.delete('/:id', authorizeRoles('admin'), validateUuidParam, controller.remove);

module.exports = router;
