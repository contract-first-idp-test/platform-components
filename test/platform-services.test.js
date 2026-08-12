const YAML = require('yaml');
const {read, parseDocuments, render} = require('./helpers/manifests');
const {createConfiguredRepository} = require('./helpers/configured-repository');

describe('platform service integration contracts', () => {
  let repository;
  let root;

  beforeAll(() => {
    repository = createConfiguredRepository();
    root = repository.root;
  });

  afterAll(() => repository.cleanup());

  test('Keycloak keeps the platform realm, human roles, and machine identities', () => {
    const rendered = render(root, 'components/keycloak');
    expect(rendered.every(resource =>
      resource.metadata.namespace === 'cf-idp-keycloak')).toBe(true);
    expect(rendered.some(resource => resource.kind === 'Namespace')).toBe(false);
    const manifest = YAML.parse(read(root, 'components/keycloak/realm.yaml'));
    const realm = manifest.spec.realm;
    expect(realm).toMatchObject({id: 'platform', realm: 'platform', displayName: 'Platform'});
    expect(realm.groups.map(group => group.name)).toEqual([
      'platform-maintainers', 'domain-maintainers', 'domain-contributors',
      'domain-viewers', 'microcks',
    ]);
    expect(realm.users.filter(user => !user.serviceAccountClientId)).toEqual([
      expect.objectContaining({
        username: '${DEMO_USER_USERNAME}',
        groups: ['/platform-maintainers', '/domain-maintainers', '/microcks/manager'],
      }),
    ]);
    expect(realm.users.find(user => user.username === 'service-account-backstage')
      .serviceAccountClientId).toBe('backstage');
    expect(realm.users.some(user =>
      user.username === 'service-account-microcks-serviceaccount')).toBe(false);
    expect(realm.clients.some(client => client.clientId === 'microcks-serviceaccount')).toBe(false);
    expect(realm.roles.realm).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'sr-admin'}),
      expect.objectContaining({name: 'sr-developer'}),
      expect.objectContaining({name: 'sr-readonly'}),
      expect.objectContaining({name: 'microcks-publisher', composite: true}),
    ]));
    expect(realm.scopeMappings).toContainEqual({
      clientScope: 'roles',
      roles: ['sr-admin', 'sr-developer', 'sr-readonly', 'microcks-publisher'],
    });
    expect(manifest.spec.placeholders.DEMO_USER_USERNAME)
      .toEqual({secret: {name: 'keycloak-realm-secrets', key: 'demo-user-username'}});

    const keycloakSecrets = parseDocuments(
      read(root, 'components/keycloak/external-secrets.yaml'));
    const realmSecrets = keycloakSecrets.find(resource =>
      resource.metadata.name === 'keycloak-realm-secrets');
    expect(realmSecrets.spec.target.template.data).toMatchObject({
      'demo-user-username': '{{ .demoUserUsername }}',
      'demo-user-password': '{{ .demoUserPassword }}',
    });
    expect(realmSecrets.spec.target.template.data).not.toHaveProperty('microcks-client-secret');
    const adminSecret = keycloakSecrets.find(resource =>
      resource.metadata.name === 'cf-idp-keycloak-admin');
    expect(adminSecret.spec.target.template.data).toEqual({
      'client-id': 'cf-idp-keycloak-admin', 'client-secret': '{{ .clientSecret }}',
    });
    const keycloak = YAML.parse(read(root, 'components/keycloak/keycloak.yaml'));
    expect(keycloak.apiVersion).toBe('k8s.keycloak.org/v2beta1');
    expect(keycloak.spec.features.enabled).toContain('client-admin-api:v2');
    expect(keycloak.spec.bootstrapAdmin.service.secret).toBe('cf-idp-keycloak-admin');
    expect(YAML.parse(read(root, 'components/microcks/config.yaml'))
      .data['application.properties']).toContain('keycloak.realm=platform');
  });

  test('Developer Hub and Dev Spaces scope GitHub and identity credentials correctly', () => {
    const appConfigSource = YAML.parse(read(root, 'components/developer-hub/app-config.yaml'))
      .data['app-config-rhdh.yaml'];
    const appConfig = YAML.parse(appConfigSource.replace(
      /\$\{([A-Za-z0-9_]+)\}/g, 'PLACEHOLDER_$1',
    ));
    expect(appConfig.signInPage).toBe('oidc');
    expect(appConfig.auth.providers.github).toBeUndefined();
    expect(appConfig.auth.providers.oidc.production.metadataUrl)
      .toBe('PLACEHOLDER_KEYCLOAK_BASE_URL/realms/PLACEHOLDER_KEYCLOAK_REALM/.well-known/openid-configuration');
    expect(appConfig.catalog.locations).toEqual([{
      type: 'url', target: 'PLACEHOLDER_SOFTWARE_TEMPLATES_CATALOG_URL',
    }]);
    expect(appConfig.catalog.providers.github.app).toBe('PLACEHOLDER_GITHUB_APP_ID');
    expect(appConfig.kubernetes.clusterLocatorMethods[0].clusters[0]).toMatchObject({
      url: 'https://kubernetes.default.svc',
      authProvider: 'serviceAccount',
      serviceAccountToken: 'PLACEHOLDER_token',
    });

    const developerHub = YAML.parse(
      read(root, 'components/developer-hub/external-secret.yaml'),
    );
    expect(developerHub.spec.target.template.data).toMatchObject({
      GITHUB_APP_ID: '{{ .githubAppId }}',
      GITHUB_APP_CLIENT_ID: '{{ .githubAppClientId }}',
      GITHUB_APP_CLIENT_SECRET: '{{ .githubAppClientSecret }}',
      KEYCLOAK_CLIENT_ID: 'backstage',
      KEYCLOAK_REALM: 'platform',
    });
    expect(developerHub.spec.target.template.data.GITHUB_APP_PRIVATE_KEY)
      .toContain('githubAppPrivateKeyBase64 | b64dec');

    const devSpaces = YAML.parse(read(root, 'components/devspaces/oauth-secret.yaml'));
    expect(devSpaces.spec.target.template.data)
      .toEqual({id: '{{ .clientId }}', secret: '{{ .clientSecret }}'});
    expect(Object.fromEntries(devSpaces.spec.data.map(item => [
      item.secretKey, item.remoteRef.property,
    ]))).toEqual({
      clientId: 'GITHUB_APP_CLIENT_ID',
      clientSecret: 'GITHUB_APP_CLIENT_SECRET',
    });
    expect(JSON.stringify(devSpaces)).not.toContain('PRIVATE_KEY');
  });

  test('Quay bootstrap and Bridge credentials preserve their ownership boundary', () => {
    const quaySecret = parseDocuments(read(root, 'components/quay/external-secret.yaml'))
      .find(resource =>
        resource.kind === 'ExternalSecret' && resource.metadata.name === 'quay-config');
    expect(quaySecret.spec.target.template.data['config.yaml'])
      .toContain('FEATURE_PROGRAMMATIC_BOOTSTRAP: true');

    const initializeJob = YAML.parse(read(root, 'components/quay/bootstrap-job.yaml'));
    expect(initializeJob.spec.template.spec).toMatchObject({
      automountServiceAccountToken: false,
    });
    expect(initializeJob.spec.template.spec.containers[0].args.join('\n'))
      .toContain('/api/v1/user/initialize');

    const activateJob = YAML.parse(read(root, 'components/quay/activate-job.yaml'));
    expect(activateJob.spec.template.spec).toMatchObject({
      serviceAccountName: 'quay-activate', automountServiceAccountToken: true,
    });
    expect([activateJob.spec.template.spec.containers[0].command,
      activateJob.spec.template.spec.containers[0].args].flat())
      .toEqual(['oc', 'rollout', 'restart', 'deployment/registry-quay-app', '-n', 'quay']);

    const bridge = [
      ...parseDocuments(read(root, 'components/quay-bridge/bootstrap-token-secret.yaml')),
      ...parseDocuments(read(root, 'components/quay-bridge/quay-integration.yaml')),
    ];
    const token = bridge.find(resource => resource.kind === 'ExternalSecret');
    expect(token.spec).toMatchObject({
      secretStoreRef: {kind: 'SecretStore', name: 'quay-bootstrap-token'},
      target: {name: 'quay-access-token', creationPolicy: 'Owner'},
      dataFrom: [{extract: {key: 'registry-bootstrap-token'}}],
    });
    expect(bridge.find(resource => resource.kind === 'QuayIntegration')
      .spec.credentialsSecret).toEqual({
      name: 'quay-access-token', namespace: 'openshift-operators', key: 'token',
    });
  });

  test('Software Templates coordinates remain public, revision-aware target configuration', () => {
    const externalSecret = YAML.parse(
      read(root, 'components/developer-hub/external-secret.yaml'),
    );
    const source = externalSecret.spec.data.find(item => item.secretKey === 'platformConfig');
    expect(source).toMatchObject({
      sourceRef: {storeRef: {kind: 'ClusterSecretStore', name: 'cf-idp-config'}},
      remoteRef: {key: 'platform-target-config', property: 'platform.yaml'},
    });

    const template = externalSecret.spec.target.template.data.SOFTWARE_TEMPLATES_CATALOG_URL;
    for (const field of ['repositoryUrl', 'revision', 'catalogPath']) {
      expect(template).toContain(`$dependency.${field}`);
    }
    expect(template).toContain('/blob/');
    expect(template).not.toContain('github.com/contract-first-idp-test/software-templates');
    expect(read(root, 'bootstrap/secrets.env.example'))
      .not.toMatch(/SOFTWARE_TEMPLATES|CATALOG_URL/);
  });

  test('Pipelines enables its console plugin through narrowly scoped post-sync automation', () => {
    const resources = render(root, 'components/pipelines');
    const role = resources.find(resource =>
      resource.kind === 'ClusterRole' &&
      resource.metadata.name === 'enable-pipelines-console-plugin');
    expect(role.rules).toEqual([{
      apiGroups: ['operator.openshift.io'],
      resources: ['consoles'],
      resourceNames: ['cluster'],
      verbs: ['get', 'patch'],
    }]);
    const job = resources.find(resource =>
      resource.kind === 'Job' &&
      resource.metadata.name === 'enable-pipelines-console-plugin');
    expect(job.metadata.annotations).toMatchObject({
      'argocd.argoproj.io/hook': 'PostSync',
      'argocd.argoproj.io/hook-delete-policy': 'BeforeHookCreation,HookSucceeded',
    });
    expect(job.spec.template.spec.containers[0].args.join('\n'))
      .toContain('pipelines-console-plugin');
  });
});
