const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const {repositoryRoot: root} = require('./helpers/paths');
const {validateCompatibility} = require(path.join(
  root, 'components/developer-hub/compatibility-action/compatibility.cjs'));

const compatible = {
  releaseVersion: '1.0.0',
  requires: {
    platformComponents: '>=1.0.0 <2.0.0',
    developerCharts: '>=1.0.0 <2.0.0',
  },
  selected: {platformComponents: '1.0.0', developerCharts: '1.0.0'},
};

describe('CF-IDP scaffolder compatibility action', () => {
  test('uses node-semver for the documented range forms', () => {
    expect(validateCompatibility(compatible)).toEqual({compatible: true});
    expect(validateCompatibility({
      ...compatible,
      selected: {platformComponents: 'v1.9.9+build.4', developerCharts: 'v1.0.9'},
    })).toEqual({compatible: true});
  });

  test.each([
    ['platform-components', {platformComponents: '2.0.0', developerCharts: '1.0.0'}],
    ['developer-charts', {platformComponents: '1.0.0', developerCharts: '2.0.0'}],
  ])('rejects incompatible %s with the selected version in the message', (name, selected) => {
    expect(() => validateCompatibility({...compatible, selected}))
      .toThrow(new RegExp(`requires ${name}.*selected PlatformTarget provides ${name}`));
  });

  test('rejects malformed versions and ranges instead of approximating SemVer', () => {
    expect(() => validateCompatibility({
      ...compatible, selected: {...compatible.selected, platformComponents: '1.1'},
    })).toThrow('not valid SemVer');
    expect(() => validateCompatibility({
      ...compatible,
      requires: {...compatible.requires, developerCharts: 'definitely-not-a-range'},
    })).toThrow('invalid developer-charts range');
  });

  test('mounts and enables one narrow backend action plugin', () => {
    const backstage = YAML.parse(fs.readFileSync(
      path.join(root, 'components/developer-hub/backstage.yaml'), 'utf8'));
    expect(backstage.spec.application.extraFiles.configMaps).toContainEqual({
      name: 'cf-idp-compatibility-action',
      mountPath: '/opt/app-root/src/local-plugins/contract-first-idp-compatibility',
      containers: ['backstage-backend', 'install-dynamic-plugins'],
    });
    const plugins = YAML.parse(fs.readFileSync(
      path.join(root, 'components/developer-hub/dynamic-plugins.yaml'), 'utf8'));
    expect(plugins.data['dynamic-plugins.yaml'])
      .toContain('package: ./local-plugins/contract-first-idp-compatibility/..data');
  });
});
