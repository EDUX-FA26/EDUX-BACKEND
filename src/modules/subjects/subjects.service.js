const repository = require('./subjects.repository');

function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

function translate(error) {
  if (error.code === '23505') throw problem(409, 'Subject code already exists');
  if (error.code === '23503') throw problem(400, 'Department not found');
  throw error;
}

module.exports = {
  list: (filters, tenant) => repository.list({
    ...filters,
    schoolId: tenant.schoolId,
  }),
  async get(id, tenant) {
    const row = await repository.findById(id, tenant.schoolId);
    if (!row) throw problem(404, 'Subject not found');
    return row;
  },
  async create(data, tenant) {
    try { return await repository.create(data, tenant.schoolId); } catch (error) { translate(error); }
  },
  async update(id, data, tenant) {
    try {
      const row = await repository.update(id, data, tenant.schoolId);
      if (!row) throw problem(404, 'Active subject not found');
      return row;
    } catch (error) { translate(error); }
  },
  async remove(id, tenant) {
    const row = await repository.remove(id, tenant.schoolId);
    if (!row) throw problem(404, 'Active subject not found');
    return row;
  },
  async restore(id, tenant) {
    const row = await repository.restore(id, tenant.schoolId);
    if (!row) throw problem(404, 'Subject not found');
    return row;
  },
};
