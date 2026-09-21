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
  list: filters => repository.list(filters),
  async get(id) {
    const row = await repository.findById(id);
    if (!row) throw problem(404, 'Subject not found');
    return row;
  },
  async create(data) {
    try { return await repository.create(data); } catch (error) { translate(error); }
  },
  async update(id, data) {
    try {
      const row = await repository.update(id, data);
      if (!row) throw problem(404, 'Active subject not found');
      return row;
    } catch (error) { translate(error); }
  },
  async remove(id) {
    const row = await repository.remove(id);
    if (!row) throw problem(404, 'Active subject not found');
    return row;
  },
};
