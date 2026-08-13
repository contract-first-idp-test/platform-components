const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const {read} = require('./helpers/manifests');
const {repositoryRoot: root} = require('./helpers/paths');

describe('platform-components release policy', () => {
  const release = YAML.parse(read(root, 'release.yaml'));
  const target = YAML.parse(read(root, 'test/fixtures/catalog-info.yaml')).spec.platform;

  test('versions only the platform contract', () => {
    expect(release).toEqual({version: '1.0.0'});
    expect(release).not.toHaveProperty('requires');
    expect(target.distribution.version).toBe(release.version);
  });

  test('selects independently versioned dependencies by exact revision and semantic version', () => {
    expect(target.dependencies.softwareTemplates).toMatchObject({
      revision: 'v1.0.0', version: '1.0.0', catalogPath: 'catalog-info.yaml',
    });
    expect(target.dependencies.developerCharts).toEqual({
      repositoryUrl: 'https://github.com/contract-first-idp-test/developer-charts.git',
      revision: 'v1.0.0',
      version: '1.0.0',
    });
    expect(target.charts).toEqual(target.dependencies.developerCharts);
  });

  test('a compatible dependency patch is only a platform configuration change', () => {
    const selected = structuredClone(target);
    selected.dependencies.developerCharts.revision = 'v1.0.1';
    selected.dependencies.developerCharts.version = '1.0.1';
    selected.charts = {...selected.dependencies.developerCharts};
    selected.dependencies.softwareTemplates.revision = 'v1.0.1';
    selected.dependencies.softwareTemplates.version = '1.0.1';

    expect(selected.configuration.revision).toBe('test');
    expect(selected.dependencies.developerCharts.version).toBe('1.0.1');
    expect(selected.dependencies.softwareTemplates.version).toBe('1.0.1');
    expect(release.version).toBe('1.0.0');
  });

  test('keeps the original main-based GitOps topology', () => {
    const rootApplication = YAML.parseAllDocuments(
      read(root, 'bootstrap/root/application.yaml')).map(document => document.toJSON())
      .find(resource => resource.kind === 'Application');
    expect(rootApplication.spec.source).toMatchObject({targetRevision: 'main', path: '.'});
    expect(fs.existsSync(path.join(root, 'configuration'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'bootstrap/root/tenant-domain-applicationset.yaml')))
      .toBe(false);
    expect(read(root, 'components/developer-hub/dynamic-plugins.yaml'))
      .not.toContain('contract-first-idp-compatibility');
  });
});
