const YAML = require('yaml');
const {read} = require('./helpers/manifests');
const {repositoryRoot: root} = require('./helpers/paths');

describe('platform-components release contract', () => {
  const release = YAML.parse(read(root, 'release.yaml'));
  const target = YAML.parse(read(root, 'test/fixtures/catalog-info.yaml')).spec.platform;

  test('versions only the platform contract it owns', () => {
    expect(release).toEqual({version: '1.1.3'});
    expect(release).not.toHaveProperty('requires');
    expect(target.distribution).toEqual({
      repositoryUrl: 'https://github.com/fixture-org/platform-components.git',
      version: release.version,
      revision: 'v1.1.3',
    });
    expect(target.configuration.revision).toBe('test');
    expect(target.configuration.revision).not.toBe(target.distribution.revision);
  });

  test('publishes exact independently versioned consumer coordinates', () => {
    expect(target.dependencies.developerCharts).toMatchObject({
      revision: 'v1.0.2', version: '1.0.2',
    });
    expect(target.dependencies.softwareTemplates).toMatchObject({
      revision: 'v1.1.1', version: '1.1.1', catalogPath: 'catalog-info.yaml',
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

  test('dependency patches change installation selection without changing distribution identity', () => {
    const upgraded = structuredClone(target);
    upgraded.dependencies.developerCharts = {
      ...upgraded.dependencies.developerCharts, revision: 'v1.0.9', version: '1.0.9',
    };
    upgraded.charts = {...upgraded.dependencies.developerCharts};
    upgraded.dependencies.softwareTemplates = {
      ...upgraded.dependencies.softwareTemplates, revision: 'v1.1.9', version: '1.1.9',
    };
    expect(upgraded.distribution).toEqual(target.distribution);
    expect(upgraded.configuration.revision).toBe(target.configuration.revision);
    expect(release.version).toBe('1.1.3');
  });

  test('admits the existing Domain resources in their platform namespaces', () => {
    const project = YAML.parse(read(root, 'tenants/customer-experience/project.yaml'));
    expect(project.spec.destinations).toEqual(expect.arrayContaining([
      {server: 'https://kubernetes.default.svc', namespace: 'openshift-gitops'},
      {server: 'https://kubernetes.default.svc', namespace: 'cf-idp-keycloak'},
      {server: 'https://kubernetes.default.svc', namespace: 'cf-idp-secrets'},
    ]));
  });
});
