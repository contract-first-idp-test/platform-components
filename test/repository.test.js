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

describe('fork-ready repository distribution', () => {
  test('all committed shell and static YAML sources parse', () => {
    const files = walk(root);
    for (const file of files.filter(candidate => candidate.endsWith('.sh'))) {
      const result = spawnSync('bash', ['-n', file], {encoding: 'utf8'});
      expect({file: path.relative(root, file), stderr: result.stderr, status: result.status})
        .toEqual({file: path.relative(root, file), stderr: '', status: 0});
    }
    for (const file of files.filter(candidate => /\.ya?ml$/.test(candidate))) {
      expect(() => parseDocuments(fs.readFileSync(file, 'utf8'))).not.toThrow();
    }
  });

  test('supports a distribution template or a configured platform target', () => {
    expect(exists(root, 'bootstrap/catalog-info.template.yaml')).toBe(true);
    if (!exists(root, 'catalog-info.yaml')) return;
    const catalog = YAML.parse(read(root, 'catalog-info.yaml'));
    expect(catalog).toMatchObject({
      kind: 'Resource',
      spec: {type: 'contract-first-idp-target', platform: {configuration: {}}},
    });
  });

  test('keeps local secrets ignored and scans public files for credential material', () => {
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
  });
});
