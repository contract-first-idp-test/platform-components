const YAML = require('yaml');
const {read, render} = require('./helpers/manifests');
const {repositoryRoot: root} = require('./helpers/paths');

describe('release-hardening platform contracts', () => {
  test('owns a namespace-scoped Keycloak operator with automatic approval', () => {
    const resources = render(root, 'operators/keycloak');
    const subscription = resources.find(item => item.kind === 'Subscription');
    expect(subscription.metadata.namespace).toBe('cf-idp-keycloak');
    expect(subscription.spec).toMatchObject({
      name: 'keycloak-operator', source: 'community-operators',
      sourceNamespace: 'openshift-marketplace', channel: 'fast',
      startingCSV: 'keycloak-operator.v26.7.1', installPlanApproval: 'Automatic',
    });
    const group = resources.find(item => item.kind === 'OperatorGroup');
    expect(group.metadata).toMatchObject({
      name: 'cf-idp-keycloak', namespace: 'cf-idp-keycloak',
    });
    expect(group.spec.targetNamespaces).toEqual(['cf-idp-keycloak']);
    expect(resources.find(item => item.kind === 'Namespace').metadata.name)
      .toBe('cf-idp-keycloak');

  });

  test('generates internal entropy while leaving only externally issued inputs', () => {
    const generated = render(root, 'components/external-secrets');
    const passwords = generated.filter(item => item.kind === 'Password');
    expect(passwords.map(item => item.metadata.name)).toEqual(expect.arrayContaining([
      'backstage-backend', 'backstage-keycloak', 'keycloak-client-admin', 'demo-user',
      'microcks-mongodb', 'microcks-mongodb-admin', 'quay-admin', 'gitea-admin',
      'gitea-secret-key', 'gitea-internal-token', 'gitea-jwt',
    ]));
    const realmPassword = passwords.find(item => item.metadata.name === 'demo-user');
    expect(realmPassword.spec.symbols).toBeGreaterThan(0);
    expect(realmPassword.spec.symbolCharacters).not.toMatch(/["\\]/);
    const platform = generated.find(item =>
      item.kind === 'ExternalSecret' && item.metadata.name === 'platform-generated-secrets');
    expect(platform.spec).toMatchObject({
      refreshPolicy: 'CreatedOnce',
      target: {creationPolicy: 'Orphan', deletionPolicy: 'Retain'},
    });
    const example = read(root, 'bootstrap/secrets.env.example');
    for (const removed of [
      'BACKSTAGE_BACKEND_SECRET', 'KEYCLOAK_BACKSTAGE_CLIENT_SECRET',
      'DEMO_USER_PASSWORD', 'MICROCKS_MONGODB_PASSWORD', 'QUAY_ADMIN_PASSWORD',
      'GITEA_ADMIN_PASSWORD', 'GITEA_SECRET_KEY', 'GITEA_INTERNAL_TOKEN',
      'GITEA_JWT_SECRET',
    ]) expect(example).not.toContain(removed);
    expect(example).toContain('GITHUB_APP_CLIENT_SECRET');
  });

  test('platform Kubernetes secret stores use exact-key get-only readers', () => {
    const resources = render(root, 'components/external-secrets');
    const config = resources.find(item =>
      item.kind === 'Role' && item.metadata.name === 'cf-idp-config-reader');
    const credentials = resources.find(item =>
      item.kind === 'Role' && item.metadata.name === 'cf-idp-credential-reader');
    expect(config.rules).toEqual([{
      apiGroups: [''], resources: ['secrets'],
      resourceNames: ['platform-target-config'], verbs: ['get'],
    }]);
    expect(credentials.rules).toEqual([{
      apiGroups: [''], resources: ['secrets'],
      resourceNames: ['platform-secrets', 'platform-generated-secrets'], verbs: ['get'],
    }]);
  });

  test('owns only generic shared execution and policy Tasks', () => {
    const resources = render(root, 'components/pipelines');
    const tasks = resources.filter(item => item.kind === 'Task');
    expect(tasks.map(item => item.metadata.name)).toEqual(expect.arrayContaining([
      'assert-image-tag-compatible', 'maven', 'microcks-cli', 'nodejs',
      'spectral-quality-gate',
    ]));
    expect(tasks.find(item => item.metadata.name === 'nodejs').spec.steps[0].image)
      .toContain('nodejs-24');
    const imageTagGuard = tasks.find(item => item.metadata.name === 'assert-image-tag-compatible');
    expect(imageTagGuard.spec.results.some(result =>
      result.name === 'destinationDigest')).toBe(true);
  });

  test('enables native Apicurio authentication and hard owner/group authorization', () => {
    const registry = YAML.parse(read(root, 'components/apicurio/apicurio-registry.yaml'));
    expect(registry.spec.app.auth).toMatchObject({
      enabled: true, appClientId: 'registry-api', uiClientId: 'apicurio-registry',
      tls: {tlsVerificationType: 'REQUIRED'},
      anonymousReadsEnabled: true,
      authz: {
        enabled: true, ownerOnlyEnabled: true, groupAccessEnabled: true,
        readAccessEnabled: true,
        roles: {source: 'token', admin: 'sr-admin', developer: 'sr-developer', readOnly: 'sr-readonly'},
      },
    });
  });

});
