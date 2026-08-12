const YAML = require('yaml');
const {read} = require('./helpers/manifests');
const {repositoryRoot: root} = require('./helpers/paths');

describe('platform-components release contract', () => {
  const release = YAML.parse(read(root, 'release.yaml'));
  const target = YAML.parse(read(root, 'catalog-info.yaml')).spec.platform;

  test('versions only the platform contract it owns', () => {
    expect(release).toEqual({version: '1.1.0'});
    expect(release).not.toHaveProperty('requires');
    expect(target.distribution).toEqual({version: release.version, revision: 'v1.1.0'});
    expect(target.configuration.revision).toBe(target.distribution.revision);
  });

  test('publishes exact independently versioned consumer coordinates', () => {
    expect(target.dependencies.developerCharts).toMatchObject({
      revision: 'v1.0.1', version: '1.0.1',
    });
    expect(target.dependencies.softwareTemplates).toMatchObject({
      revision: 'v1.1.0', version: '1.1.0', catalogPath: 'catalog-info.yaml',
    });
    expect(target.charts).toEqual(target.dependencies.developerCharts);
    for (const coordinate of [
      target.distribution, target.dependencies.developerCharts,
      target.dependencies.softwareTemplates,
    ]) {
      expect(coordinate.revision).toBe(`v${coordinate.version}`);
      expect(coordinate.revision).toMatch(/^v[0-9]+\.[0-9]+\.[0-9]+$/);
    }
  });

  test('keeps template publication separate from runtime compatibility', () => {
    const externalSecret = read(root, 'components/developer-hub/external-secret.yaml');
    expect(externalSecret).toContain('$target.spec.platform.dependencies.softwareTemplates');
    expect(externalSecret).toContain('$dependency.revision');
    expect(release).not.toHaveProperty('requires.softwareTemplates');
    expect(release).not.toHaveProperty('requires.developerCharts');
  });
});
