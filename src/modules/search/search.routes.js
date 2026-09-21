const router = require('express').Router();
const { authenticate } = require('../../middlewares/auth.middleware');
const { validateQuery } = require('../../middlewares/queryValidation.middleware');
const { searchQuery } = require('./search.validation');
const controller = require('./search.controller');

router.get('/', authenticate, validateQuery(searchQuery), controller.search);

module.exports = router;
