const repository = require('./search.repository');

module.exports = { search: (filters, user) => repository.search(filters, user) };
