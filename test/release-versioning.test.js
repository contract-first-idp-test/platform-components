const YAML = require('yaml');
const semver = require('semver');
const {read} = require('./helpers/manifests');
const {repositoryRoot: root} = require('./helpers/paths');

describe('platform-components release policy', () => {
  const release = YAML.parse(read(root, 'release.yaml'));
  const target = YAML.parse(read(root, 'test/fixtures/catalog-info.yaml')).spec.platform;

  test('versions the platform independently from selected dependencies', () => {
    expect(semver.valid(release.version)).toBe(release.version);
    expect(release).not.toHaveProperty('requires');
    expect(target.distribution.version).toBe(release.version);
    for (const dependency of [
      target.dependencies.softwareTemplates,
      target.dependencies.developerCharts,
    ]) {
      expect(dependency.revision).toBe(`v${dependency.version}`);
    }
  });
});
