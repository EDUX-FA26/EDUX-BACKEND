module.exports = {
  setupFiles: ["<rootDir>/test/helpers/env-setup.js"],
  setupFilesAfterEnv: ["<rootDir>/test/helpers/setup.js"],
  testEnvironment: "node",
  testMatch: ["**/test/**/*.test.js"],
};
