const path = require('node:path');

const testRoot = __dirname;
const repositoryRoot = path.resolve(testRoot, '..');

module.exports = {
  rootDir: repositoryRoot,
  moduleDirectories: ['node_modules', '<rootDir>/test/node_modules'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.js'],
  testPathIgnorePatterns: [
    '<rootDir>/test/node_modules/',
    '<rootDir>/test/fixtures/',
    '<rootDir>/test/live/',
  ],
  testTimeout: 30000,
};
