const {execFileSync, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const {repositoryRoot: root} = require('./helpers/paths');
const {read, exists, parseDocuments} = require('./helpers/manifests');
const {createConfiguredRepository} = require('./helpers/configured-repository');

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (['.git', 'node_modules', 'coverage', '.cache'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else files.push(absolute);
  }
  return files;
}

function envKeys(relative) {
  return read(root, relative).split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.slice(0, line.indexOf('=')));
}

function expectConfiguredPlatformTarget(repository) {
  const source = read(repository, 'configuration/catalog-info.yaml');
  const catalog = YAML.parse(source);
  expect(source).not.toContain('@@');
  expect(catalog).toMatchObject({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    spec: {
      owner: 'group:default/platform-maintainers',
      type: 'contract-first-idp-target',
      platform: {
        configuration: {valuesPath: 'configuration/catalog-info.yaml'},
        tenantAdmission: {path: 'tenants'},
        cluster: {}, argocd: {}, dependencies: {}, schemaRegistry: {},
        registry: {}, services: {}, build: {},
      },
    },
  });
  const configuration = catalog.spec.platform.configuration;
  expect(catalog.metadata.annotations['github.com/project-slug'])
    .toBe(`${configuration.organization}/${configuration.repository}`);
  expect(catalog.spec.platform.tenantAdmission.branch).toMatch(/^(main|test)$/);
  expect(configuration.revision).toMatch(/^(main|test)$/);
  expect(configuration.revision).not.toBe(catalog.spec.platform.distribution.revision);
}

describe('fork-ready repository distribution', () => {
  test('all committed shell and static YAML sources parse', () => {
    const files = walk(root);
    for (const file of files.filter(candidate => candidate.endsWith('.sh'))) {
      const result = spawnSync('bash', ['-n', file], {encoding: 'utf8'});
      expect({file: path.relative(root, file), stderr: result.stderr, status: result.status})
        .toEqual({file: path.relative(root, file), stderr: '', status: 0});
    }
    for (const file of files.filter(candidate => /\.ya?ml$/.test(candidate))) {
      expect(() => parseDocuments(fs.readFileSync(file, 'utf8')))
        .not.toThrow();
    }
  });

  test('supports both pristine distribution and configured-fork layouts', () => {
    for (const obsolete of [
      'argocd', 'profiles', 'targets', 'tests', 'scripts',
      path.join('config', 'distribution.env'), 'bootstrap/source.env',
      'requirements-dev.txt', 'bootstrap/config.env',
      'package.json', 'package-lock.json', 'jest.config.js', 'node_modules',
    ]) expect({obsolete, present: exists(root, obsolete)})
      .toEqual({obsolete, present: false});

    for (const required of [
      'kustomization.yaml', 'catalog-info.yaml', 'bootstrap/catalog-info.template.yaml',
      'bootstrap/configure-workshop.sh', 'bootstrap/secrets.env.example',
      'bootstrap/application.yaml', 'bootstrap/kustomization.yaml',
      'bootstrap/platform-distribution.template.yaml',
      'bootstrap/configuration.kustomization.template.yaml',
      'bootstrap/root/platform-applicationset.yaml', 'tenants/README.md',
      'test/repository.test.js', 'test/bootstrap.test.js',
      'test/platform-services.test.js', 'test/applicationset.test.js',
      'test/application-projects.test.js', 'test/fixtures/catalog-info.yaml',
      'test/helpers/manifests.js', 'test/helpers/configured-repository.js',
      'test/package.json', 'test/package-lock.json', 'test/jest.config.js',
    ]) expect({required, present: exists(root, required)})
      .toEqual({required, present: true});

    expect(YAML.parse(read(root, 'catalog-info.yaml'))).toMatchObject({
      kind: 'Location', spec: {targets: ['./configuration/catalog-info.yaml']},
    });
    if (exists(root, 'configuration/catalog-info.yaml')) expectConfiguredPlatformTarget(root);
    expect(exists(root, 'test/platform.test.js')).toBe(false);
    expect(exists(root, 'tenants/kustomization.yaml')).toBe(false);
    expect(read(root, '.gitignore')).not.toMatch(/^\/?catalog-info\.yaml$/m);
    expect(YAML.parse(read(root, 'test/package.json'))).toMatchObject({
      name: 'platform-components-tests', private: true,
    });
  });

  test('accepts the configured root target committed by workshop setup', () => {
    const checkout = createConfiguredRepository();
    try {
      expectConfiguredPlatformTarget(checkout.root);
    } finally {
      checkout.cleanup();
    }
  });

  test('keeps local secrets ignored and credential values out of public files', () => {
    expect(execFileSync('git', ['check-ignore', 'bootstrap/secrets.env'], {
      cwd: root, encoding: 'utf8',
    }).trim()).toBe('bootstrap/secrets.env');

    const publicFiles = execFileSync(
      'git', ['ls-files', '--cached', '--others', '--exclude-standard'],
      {cwd: root, encoding: 'utf8'},
    ).trim().split('\n').filter(Boolean);
    expect(publicFiles).not.toContain('bootstrap/secrets.env');

    const credentialPattern = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN ([A-Z0-9 ]+)?PRIVATE KEY-----/;
    for (const relative of publicFiles) {
      const file = path.join(root, relative);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      expect({file: relative, leaked: credentialPattern.test(fs.readFileSync(file))})
        .toEqual({file: relative, leaked: false});
    }

    for (const relative of [
      'kustomization.yaml', 'bootstrap/catalog-info.template.yaml',
      'bootstrap/root/platform-applicationset.yaml',
    ]) {
      for (const key of envKeys('bootstrap/secrets.env.example')) {
        expect(read(root, relative)).not.toContain(key);
      }
    }
  });
});
