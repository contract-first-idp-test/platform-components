const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {repositoryRoot, testRoot} = require('./paths');

function createRepository(configured) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-repository-'));
  const root = path.join(temporary, 'repository');
  fs.cpSync(repositoryRoot, root, {
    recursive: true,
    filter: source => !source.split(path.sep)
      .some(part => ['.git', 'node_modules', 'coverage', '.cache'].includes(part)),
  });
  fs.rmSync(path.join(root, 'catalog-info.yaml'), {force: true});
  if (configured) {
    fs.copyFileSync(
      path.join(testRoot, 'fixtures/catalog-info.yaml'),
      path.join(root, 'catalog-info.yaml'),
    );
  }
  return {
    root,
    cleanup: () => fs.rmSync(temporary, {recursive: true, force: true}),
  };
}

const createPristineRepository = () => createRepository(false);
const createConfiguredRepository = () => createRepository(true);

module.exports = {createPristineRepository, createConfiguredRepository};
