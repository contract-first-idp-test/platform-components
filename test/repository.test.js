const {execFileSync, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const {repositoryRoot: root} = require('./helpers/paths');
const {read, exists, parseDocuments} = require('./helpers/manifests');

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

  test('has one supported distribution layout with no configured root target', () => {
    for (const obsolete of [
      'argocd', 'profiles', 'targets', 'tests', 'scripts', 'configuration',
      path.join('config', 'distribution.env'), 'bootstrap/source.env',
      'requirements-dev.txt', 'bootstrap/config.env',
      'package.json', 'package-lock.json', 'jest.config.js', 'node_modules',
    ]) expect({obsolete, present: exists(root, obsolete)})
      .toEqual({obsolete, present: false});

    for (const required of [
      'kustomization.yaml', 'bootstrap/catalog-info.template.yaml',
      'bootstrap/configure-workshop.sh', 'bootstrap/secrets.env.example',
      'bootstrap/root/platform-applicationset.yaml', 'tenants/README.md',
      'test/repository.test.js', 'test/bootstrap.test.js',
      'test/platform-services.test.js', 'test/applicationset.test.js',
      'test/application-projects.test.js', 'test/fixtures/catalog-info.yaml',
      'test/helpers/manifests.js', 'test/helpers/configured-repository.js',
      'test/package.json', 'test/package-lock.json', 'test/jest.config.js',
    ]) expect({required, present: exists(root, required)})
      .toEqual({required, present: true});

    expect(exists(root, 'catalog-info.yaml')).toBe(false);
    expect(exists(root, 'test/platform.test.js')).toBe(false);
    expect(exists(root, 'tenants/kustomization.yaml')).toBe(false);
    expect(read(root, '.gitignore')).not.toMatch(/^\/?catalog-info\.yaml$/m);
    expect(YAML.parse(read(root, 'test/package.json'))).toMatchObject({
      name: 'platform-components-tests', private: true,
    });
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
