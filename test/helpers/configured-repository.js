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
  fs.rmSync(path.join(root, 'configuration'), {recursive: true, force: true});
  if (configured) {
    fs.mkdirSync(path.join(root, 'configuration'));
    fs.copyFileSync(
      path.join(testRoot, 'fixtures/catalog-info.yaml'),
      path.join(root, 'configuration/catalog-info.yaml'),
    );
    fs.copyFileSync(
      path.join(root, 'bootstrap/configuration.kustomization.template.yaml'),
      path.join(root, 'configuration/kustomization.yaml'),
    );
    const distribution = fs.readFileSync(
      path.join(root, 'bootstrap/platform-distribution.template.yaml'), 'utf8')
      .replaceAll('@@PLATFORM_DISTRIBUTION_REPO_URL@@',
        'https://github.com/fixture-org/platform-components.git')
      .replaceAll('@@PLATFORM_DISTRIBUTION_REVISION@@', 'v1.0.0')
      .replaceAll('@@PLATFORM_REPO_URL@@',
        'https://github.com/fixture-org/platform-components.git')
      .replaceAll('@@PLATFORM_CONFIGURATION_REVISION@@', 'test');
    fs.writeFileSync(path.join(root, 'configuration/platform-distribution.yaml'), distribution);
    const rootKustomization = path.join(root, 'bootstrap/root/kustomization.yaml');
    fs.writeFileSync(rootKustomization, fs.readFileSync(rootKustomization, 'utf8')
      .replace('PLATFORM_DISTRIBUTION_REPO_URL=REPLACE_WITH_DISTRIBUTION_REPOSITORY_URL',
        'PLATFORM_DISTRIBUTION_REPO_URL=https://github.com/fixture-org/platform-components.git')
      .replace('PLATFORM_CONFIGURATION_REPO_URL=REPLACE_WITH_CONFIGURATION_REPOSITORY_URL',
        'PLATFORM_CONFIGURATION_REPO_URL=https://github.com/fixture-org/platform-components.git')
      .replace('PLATFORM_CONFIGURATION_REVISION=REPLACE_WITH_CONFIGURATION_BRANCH',
        'PLATFORM_CONFIGURATION_REVISION=test'));
  }
  return {
    root,
    cleanup: () => fs.rmSync(temporary, {recursive: true, force: true}),
  };
}

const createPristineRepository = () => createRepository(false);
const createConfiguredRepository = () => createRepository(true);

module.exports = {createPristineRepository, createConfiguredRepository};
