const repository = require('./search.repository');

module.exports = {
  search: (filters, tenant) => {
    const schoolId = tenant?.schoolId;
    const userId = tenant?.userId || tenant?.id;
    const role = tenant?.role;

    if (!schoolId || !userId || !role) {
      const error = new Error('SCHOOL_CONTEXT_REQUIRED');
      error.status = 400;
      throw error;
    }

    return repository.search(filters, { schoolId, userId, role });
  },
};
