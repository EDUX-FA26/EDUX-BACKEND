const repository = require('./semesters.repository');

function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

function validDates(start, end) {
  if (new Date(start) >= new Date(end)) throw problem(400, 'end_date must be after start_date');
}

const SemestersService = {
  list: filters => repository.list(filters),
  async get(id) {
    const row = await repository.findById(id);
    if (!row) throw problem(404, 'Semester not found');
    return row;
  },
  async create(data) {
    try { return await repository.create(data); }
    catch (error) {
      if (error.code === '23505') throw problem(409, 'Semester code already exists');
      throw error;
    }
  },
  async update(id, data) {
    const current = await this.get(id);
    if (current.is_locked) throw problem(409, 'Semester is locked');
    validDates(data.start_date ?? current.start_date, data.end_date ?? current.end_date);
    try {
      const row = await repository.update(id, data);
      if (!row) throw problem(409, 'Semester is locked');
      return row;
    } catch (error) {
      if (error.code === '23505') throw problem(409, 'Semester code already exists');
      throw error;
    }
  },
  async transition(id, action) {
    const result = await repository.transition(id, action);
    const errors = {
      SEMESTER_NOT_FOUND: [404, 'Semester not found'],
      SEMESTER_LOCKED: [409, 'Semester is locked'],
      SEMESTER_CLOSED: [409, 'Semester is closed'],
      SEMESTER_MUST_BE_CLOSED: [409, 'Close semester before locking it'],
    };
    if (result.error) throw problem(...errors[result.error]);
    return result.data;
  },
};

module.exports = SemestersService;
