const YAML = require('yaml');
const {exists, parseDocuments, read, render} = require('./helpers/manifests');
const {repositoryRoot: root} = require('./helpers/paths');

describe('release-hardening platform contracts', () => {
  test('pins the upstream Keycloak operator with manual approval and keycloak-only scope', () => {
    const resources = render(root, 'operators/keycloak');
    const subscription = resources.find(item => item.kind === 'Subscription');
    expect(subscription.spec).toMatchObject({
      name: 'keycloak-operator', source: 'community-operators',
      sourceNamespace: 'openshift-marketplace', channel: 'fast',
      startingCSV: 'keycloak-operator.v26.7.1', installPlanApproval: 'Manual',
    });
    const group = resources.find(item => item.kind === 'OperatorGroup');
    expect(group.spec.targetNamespaces).toEqual(['keycloak']);
    const applicationSet = read(root, 'bootstrap/root/platform-applicationset.yaml');
    expect(applicationSet).toContain('name: operator-keycloak');
    expect(applicationSet).not.toContain('RHBK Operator already');
  });

  test('generates internal entropy while leaving only externally issued inputs', () => {
    const generated = render(root, 'components/external-secrets');
    const passwords = generated.filter(item => item.kind === 'Password');
    expect(passwords.map(item => item.metadata.name)).toEqual(expect.arrayContaining([
      'backstage-backend', 'backstage-keycloak', 'keycloak-client-admin', 'demo-user',
      'microcks-mongodb', 'microcks-mongodb-admin', 'quay-admin', 'gitea-admin',
      'gitea-secret-key', 'gitea-internal-token', 'gitea-jwt',
    ]));
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
    expect(tasks.map(item => item.metadata.name).sort()).toEqual([
      'assert-image-tag-compatible', 'maven', 'microcks-cli', 'nodejs',
      'spectral-quality-gate',
    ]);
    expect(tasks.find(item => item.metadata.name === 'maven').spec.params)
      .toEqual(expect.arrayContaining([expect.objectContaining({name: 'MAVEN_IMAGE'})]));
    expect(tasks.find(item => item.metadata.name === 'maven').spec.steps
      .find(step => step.name === 'maven-goals').args.join('\n'))
      .toMatch(/-x \.\/mvnw[\s\S]*maven=\.\/mvnw[\s\S]*maven=\/usr\/bin\/mvn/);
    expect(tasks.find(item => item.metadata.name === 'nodejs').spec.steps[0].image)
      .toContain('nodejs-24');
    const microcks = tasks.find(item => item.metadata.name === 'microcks-cli');
    expect(microcks.spec.params.map(item => item.name)).toEqual(['SCRIPT']);
    expect(microcks.spec.steps[0].image).toMatch(/microcks-cli@sha256:/);
    expect(exists(root, 'components/pipelines/microcks-secret.yaml')).toBe(false);
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

  test('Microcks uses generated passwords and manifest-owned non-secret usernames', () => {
    const resources = render(root, 'components/microcks');
    expect(resources.filter(item => !['Namespace', 'ClusterRole', 'ClusterRoleBinding'].includes(item.kind))
      .every(item => item.metadata.namespace === 'microcks')).toBe(true);
    const externalSecret = YAML.parse(read(root, 'components/microcks/external-secret.yaml'));
    expect(externalSecret.spec.target.template.data).toMatchObject({
      username: 'microcks', adminUsername: 'admin',
      password: '{{ .password }}', adminPassword: '{{ .adminPassword }}',
    });
    expect(externalSecret.spec.data.map(item => item.remoteRef.property).sort()).toEqual([
      'MICROCKS_MONGODB_ADMIN_PASSWORD', 'MICROCKS_MONGODB_PASSWORD',
    ]);
  });

  test('tenant admissions uses a dedicated Application-and-project-only project', () => {
    const projects = parseDocuments(read(root, 'bootstrap/root/projects.yaml'));
    const project = projects.find(item => item.metadata.name === 'tenant-admissions');
    expect(project.spec).toMatchObject({
      destinations: [{server: 'https://kubernetes.default.svc', namespace: 'openshift-gitops'}],
      clusterResourceWhitelist: [],
      namespaceResourceWhitelist: [
        {group: 'argoproj.io', kind: 'Application'},
        {group: 'argoproj.io', kind: 'AppProject'},
      ],
    });
  });
});
