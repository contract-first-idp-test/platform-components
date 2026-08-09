const {execFileSync, spawnSync} = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');
const {repositoryRoot: root} = require('./helpers/paths');

const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(root, relative));

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else files.push(absolute);
  }
  return files;
}

function parseDocuments(source) {
  return YAML.parseAllDocuments(source).map(document => {
    if (document.errors.length) {
      throw new Error(document.errors.map(error => error.message).join('\n'));
    }
    return document.toJSON();
  }).filter(Boolean);
}

function render(relative) {
  return parseDocuments(execFileSync('oc', ['kustomize', relative], {
    cwd: root, encoding: 'utf8',
  }));
}

function envFile(relative) {
  return Object.fromEntries(read(relative).split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function softwareTemplatesCatalogUrl(dependency) {
  const repositoryUrl = new URL(dependency.repositoryUrl);
  const repositoryPath = repositoryUrl.pathname
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '')
    .replace(/\.git$/, '');
  const catalogPath = dependency.catalogPath
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');
  return `${repositoryUrl.protocol}//${repositoryUrl.host}${repositoryPath}` +
    `/blob/${dependency.revision}/${catalogPath}`;
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function githubCatalogRepositoryFilter(platform, dependency) {
  const isProviderOrganization =
    platform.host.toLowerCase() === dependency.host.toLowerCase() &&
    platform.organization.toLowerCase() === dependency.organization.toLowerCase();
  return isProviderOrganization
    ? `^(?!${escapeRegularExpression(dependency.repository)}$).*$`
    : '.*';
}

describe('repository structure and public contracts', () => {
  test('all shell and static YAML files parse', () => {
    const files = walk(root);
    for (const file of files.filter(candidate => candidate.endsWith('.sh'))) {
      const result = spawnSync('bash', ['-n', file], {encoding: 'utf8'});
      expect({file: path.relative(root, file), error: result.stderr, status: result.status})
        .toEqual({file: path.relative(root, file), error: '', status: 0});
    }
    for (const file of files.filter(candidate => /\.ya?ml$/.test(candidate))) {
      expect(() => parseDocuments(fs.readFileSync(file, 'utf8')))
        .not.toThrow();
    }
  });

  test('uses only the approved root architecture and singular test directory', () => {
    for (const obsolete of [
      'argocd', 'profiles', 'targets', 'tests', 'scripts', 'configuration',
      path.join('config', 'distribution.env'), 'bootstrap/source.env', 'requirements-dev.txt',
      path.join('bootstrap', 'config.env'),
      'package.json', 'package-lock.json', 'jest.config.js', 'node_modules',
    ]) expect(exists(obsolete)).toBe(false);
    for (const required of [
      'catalog-info.yaml', 'kustomization.yaml', 'bootstrap/catalog-info.template.yaml',
      'bootstrap/secrets.env.example',
      'bootstrap/root/platform-applicationset.yaml', 'test/platform.test.js',
      'tenants/README.md', 'test/package.json', 'test/package-lock.json',
      'test/jest.config.js', 'test/helpers/paths.js',
    ]) expect({required, present: exists(required)}).toEqual({required, present: true});
    expect(exists('tenants/kustomization.yaml')).toBe(false);
    expect(YAML.parse(read('test/package.json'))).toMatchObject({
      name: 'platform-components-tests', private: true,
    });
  });

  test('uses the platform realm with one human demo user and required machine identities', () => {
    const realm = YAML.parse(read('components/keycloak/realm.yaml')).spec.realm;
    expect(realm).toMatchObject({id: 'platform', realm: 'platform', displayName: 'Platform'});
    expect(realm.groups.map(group => group.name)).toEqual([
      'platform-maintainers', 'domain-maintainers', 'domain-contributors', 'domain-viewers',
      'microcks',
    ]);
    const humanUsers = realm.users.filter(user => !user.serviceAccountClientId);
    expect(humanUsers).toEqual([expect.objectContaining({
      username: '${DEMO_USER_USERNAME}',
      groups: ['/platform-maintainers', '/domain-maintainers', '/microcks/manager'],
    })]);
    const realmManifest = YAML.parse(read('components/keycloak/realm.yaml'));
    expect(realmManifest.spec.placeholders.DEMO_USER_USERNAME).toEqual({
      secret: {name: 'keycloak-realm-secrets', key: 'demo-user-username'},
    });
    const keycloakSecrets = YAML.parse(read('components/keycloak/external-secrets.yaml'));
    expect(keycloakSecrets.spec.target.template.data).toMatchObject({
      'demo-user-username': '{{ .demoUserUsername }}',
      'demo-user-password': '{{ .demoUserPassword }}',
    });
    expect(keycloakSecrets.spec.data.slice(-2).map(item => [
      item.secretKey, item.remoteRef.property,
    ])).toEqual([
      ['demoUserUsername', 'DEMO_USER_USERNAME'],
      ['demoUserPassword', 'DEMO_USER_PASSWORD'],
    ]);
    expect(Object.keys(envFile('bootstrap/secrets.env.example')).slice(0, 2)).toEqual([
      'DEMO_USER_USERNAME', 'DEMO_USER_PASSWORD',
    ]);
    expect(realm.clients.find(client => client.clientId === 'backstage')).toBeDefined();
    expect(realm.users.find(user => user.username === 'service-account-backstage')
      .serviceAccountClientId).toBe('backstage');
    expect(realm.users.find(user => user.username === 'service-account-microcks-serviceaccount')
      .serviceAccountClientId).toBe('microcks-serviceaccount');

    const appConfigManifest = YAML.parse(read('components/developer-hub/app-config.yaml'));
    const appConfigSource = appConfigManifest.data['app-config-rhdh.yaml'];
    const appConfig = YAML.parse(appConfigSource.replace(
      /\$\{([A-Z0-9_]+)\}/g, 'PLACEHOLDER_$1',
    ));
    expect(appConfig.auth.providers.oidc.production.clientId)
      .toBe('PLACEHOLDER_KEYCLOAK_CLIENT_ID');
    expect(appConfig.auth.providers.oidc.production.metadataUrl)
      .toBe('PLACEHOLDER_KEYCLOAK_BASE_URL/realms/PLACEHOLDER_KEYCLOAK_REALM/.well-known/openid-configuration');
    expect(appConfig.catalog.providers.keycloakOrg.production).toMatchObject({
      loginRealm: 'PLACEHOLDER_KEYCLOAK_REALM',
      realm: 'PLACEHOLDER_KEYCLOAK_REALM',
      clientId: 'PLACEHOLDER_KEYCLOAK_CLIENT_ID',
    });
    expect(appConfigSource).toMatch(/\$\{KEYCLOAK_(REALM|CLIENT_ID)\}/);
    expect(YAML.parse(read('components/microcks/values.yaml')).keycloak.realm).toBe('platform');
    const externalSecret = YAML.parse(read('components/developer-hub/external-secret.yaml'));
    expect(externalSecret.spec.target.template.data).toMatchObject({
      KEYCLOAK_CLIENT_ID: 'backstage',
      KEYCLOAK_REALM: 'platform',
    });
    expect(externalSecret.spec.data.map(item => item.secretKey)).toEqual([
      'platformConfig', 'backstageBackendSecret', 'githubAppId', 'githubAppClientId',
      'githubAppClientSecret', 'githubAppPrivateKeyBase64', 'keycloakClientSecret',
    ]);
    const configuration = YAML.parse(read('kustomization.yaml'));
    expect(configuration.secretGenerator.map(item => item.name))
      .toEqual(['platform-target-config']);
    expect(configuration.secretGenerator[0]).toMatchObject({
      namespace: 'cf-idp-secrets', files: ['platform.yaml=catalog-info.yaml'],
    });
    expect(configuration.generatorOptions.disableNameSuffixHash).toBe(true);
    expect(exists('bootstrap/root/configuration/kustomization.yaml')).toBe(false);
  });

  test('initializes the Quay owner before native bootstrap supplies the Bridge credential', () => {
    const quay = read('components/quay/external-secret.yaml');
    expect(quay).toContain('FEATURE_PROGRAMMATIC_BOOTSTRAP: true');
    expect(quay).toContain('BOOTSTRAP_TOKEN_OWNER: {{ .username }}');
    expect(quay).toContain('BOOTSTRAP_TOKEN_SCOPE:');

    const quayResources = parseDocuments(quay);
    const bootstrapSecret = quayResources.find(resource =>
      resource.kind === 'ExternalSecret' && resource.metadata.name === 'quay-bootstrap');
    expect(bootstrapSecret.spec.data.map(item => item.secretKey)).toEqual([
      'platformConfig', 'username', 'password', 'email',
    ]);

    expect(exists('components/quay/bootstrap-job.yaml')).toBe(true);
    expect(exists('components/quay/bootstrap-rbac.yaml')).toBe(false);
    const initializeJob = YAML.parse(read('components/quay/bootstrap-job.yaml'));
    expect(initializeJob.spec.template.spec.automountServiceAccountToken).toBe(false);
    expect(initializeJob.spec.template.spec.serviceAccountName).toBeUndefined();
    expect(initializeJob.spec.template.spec.initContainers).toBeUndefined();
    const initializeScript = initializeJob.spec.template.spec.containers[0].args.join('\n');
    expect(initializeScript).toContain('/api/v1/user/initialize');
    expect(initializeScript).not.toContain('access_token');
    expect(JSON.stringify(initializeJob.spec.template.spec)).not.toContain('rollout');

    expect(exists('components/quay/activate-job.yaml')).toBe(true);
    expect(exists('components/quay/activate-rbac.yaml')).toBe(true);
    const activateRbac = parseDocuments(read('components/quay/activate-rbac.yaml'));
    expect(activateRbac.map(resource => resource.kind)).toEqual([
      'ServiceAccount', 'Role', 'RoleBinding',
    ]);
    expect(activateRbac.find(resource => resource.kind === 'ServiceAccount').metadata.name)
      .toBe('quay-activate');
    expect(activateRbac.find(resource => resource.kind === 'Role').rules).toEqual([{
      apiGroups: ['apps'],
      resources: ['deployments'],
      resourceNames: ['registry-quay-app'],
      verbs: ['get', 'patch'],
    }]);

    const activateJob = YAML.parse(read('components/quay/activate-job.yaml'));
    expect(activateJob.metadata.annotations['argocd.argoproj.io/sync-wave']).toBe('6');
    expect(activateJob.spec.template.spec).toMatchObject({
      serviceAccountName: 'quay-activate',
      automountServiceAccountToken: true,
    });
    const restart = activateJob.spec.template.spec.containers[0];
    expect(restart.image).toBe('quay.io/openshift/origin-cli:latest');
    expect([restart.command, restart.args].flat()).toEqual([
      'oc', 'rollout', 'restart', 'deployment/registry-quay-app', '-n', 'quay',
    ]);

    const bridge = [
      ...parseDocuments(read('components/quay-bridge/bootstrap-token-secret.yaml')),
      ...parseDocuments(read('components/quay-bridge/quay-integration.yaml')),
    ];
    const generatedToken = bridge.find(resource =>
      resource.kind === 'ExternalSecret' && resource.metadata.name === 'quay-access-token');
    expect(generatedToken.spec).toMatchObject({
      secretStoreRef: {kind: 'SecretStore', name: 'quay-bootstrap-token'},
      target: {name: 'quay-access-token', creationPolicy: 'Owner'},
      dataFrom: [{extract: {key: 'registry-bootstrap-token'}}],
    });
    expect(generatedToken.spec.target.template.data.token)
      .toContain('fromJson).access_token');

    const integration = bridge.find(resource => resource.kind === 'QuayIntegration');
    expect(integration.spec.credentialsSecret).toEqual({
      name: 'quay-access-token', namespace: 'openshift-operators', key: 'token',
    });
  });

  test('preserves the root platform-target schema consumed by golden paths', () => {
    const catalog = YAML.parse(read('catalog-info.yaml'));
    const catalogTemplate = YAML.parse(read('bootstrap/catalog-info.template.yaml'));
    expect(catalog).toMatchObject({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Resource',
      metadata: {name: 'workshop'},
      spec: {
        owner: 'group:default/platform-maintainers',
        type: 'contract-first-idp-target',
        platform: {
          configuration: {valuesPath: 'catalog-info.yaml'},
          cluster: {}, schemaRegistry: {}, tenantAdmission: {}, dependencies: {},
          registry: {}, services: {}, build: {},
        },
      },
    });
    expect(catalog.spec.platform.dependencies.softwareTemplates).toEqual({
      host: 'github.com',
      organization: 'contract-first-idp-test',
      repository: 'software-templates',
      repositoryUrl: 'https://github.com/contract-first-idp-test/software-templates.git',
      revision: 'v1.0.0',
      catalogPath: 'catalog-info.yaml',
    });
    expect(YAML.parse(read('bootstrap/catalog-info.template.yaml'))
      .spec.platform.dependencies.softwareTemplates)
      .toEqual(catalog.spec.platform.dependencies.softwareTemplates);
    expect(catalogTemplate.spec.platform.services.devSpaces).toEqual({
      url: 'https://devspaces.@@ROUTER_DOMAIN@@',
      githubCallbackUrl: 'https://devspaces.@@ROUTER_DOMAIN@@/api/oauth/callback',
    });
  });

  test('loads one revision-aware template catalog while retaining broad discovery', () => {
    const source = read('components/developer-hub/app-config.yaml');
    const appConfig = YAML.parse(source.replace(
      /\$\{([A-Z0-9_]+)\}/g, 'PLACEHOLDER_$1',
    )).data['app-config-rhdh.yaml'];
    const config = YAML.parse(appConfig);
    expect(source.match(/catalogPath: \/catalog-info\.yaml/g)).toHaveLength(1);
    expect(config.catalog.locations).toEqual([{
      type: 'url',
      target: 'PLACEHOLDER_SOFTWARE_TEMPLATES_CATALOG_URL',
    }]);
    expect(config.catalog.providers.github.filters).toEqual({
      branch: 'main',
      repository: 'PLACEHOLDER_GITHUB_CATALOG_REPOSITORY_FILTER',
    });
    expect(config.catalog.providers.github.app)
      .toBe('PLACEHOLDER_GITHUB_APP_ID');
    expect(config.catalog.providers.github.organization).toBeUndefined();
    expect(config.integrations.github[0]).toMatchObject({
      host: 'PLACEHOLDER_GITHUB_HOST',
      apps: [expect.objectContaining({
        appId: 'PLACEHOLDER_GITHUB_APP_ID',
        clientId: 'PLACEHOLDER_GITHUB_APP_CLIENT_ID',
        clientSecret: 'PLACEHOLDER_GITHUB_APP_CLIENT_SECRET',
      })],
    });
    expect(source).not.toContain(['GITHUB', 'TOKEN'].join('_'));
    expect(source).not.toContain('GITHUB_ORG');
    expect(source).not.toContain('PLATFORM_TARGET_CATALOG_URL');
    for (const hardcoded of [
      'contract-first-idp-test', 'software-templates', 'v1.0.0',
      'github.com/contract-first-idp-test/software-templates',
    ]) expect(source).not.toContain(hardcoded);
  });

  test('scopes GitHub App credentials to Developer Hub and Dev Spaces safely', () => {
    const source = read('components/developer-hub/app-config.yaml');
    const config = YAML.parse(YAML.parse(source).data['app-config-rhdh.yaml'].replace(
      /\$\{([A-Za-z0-9_]+)\}/g, 'PLACEHOLDER_$1',
    ));
    const cluster = config.kubernetes.clusterLocatorMethods[0].clusters[0];
    expect(cluster).toMatchObject({
      url: 'https://kubernetes.default.svc',
      authProvider: 'serviceAccount',
      serviceAccountToken: 'PLACEHOLDER_token',
      caFile: '/opt/app-root/src/kubernetes-ca/ca.crt',
    });
    expect(cluster.skipTLSVerify).toBeUndefined();

    const backstage = YAML.parse(read('components/developer-hub/backstage.yaml'));
    expect(backstage.spec.application.extraFiles).toEqual({
      mountPath: '/opt/app-root/src/kubernetes-ca',
      configMaps: [{name: 'kube-root-ca.crt', key: 'ca.crt'}],
    });
    const mountedCaFile = `${backstage.spec.application.extraFiles.mountPath}/` +
      backstage.spec.application.extraFiles.configMaps[0].key;
    expect(cluster.caFile).toBe(mountedCaFile);

    expect(config.signInPage).toBe('oidc');
    expect(config.auth.providers.github).toBeUndefined();

    const developerHub = YAML.parse(read('components/developer-hub/external-secret.yaml'));
    expect(developerHub.spec.target.template.data).toMatchObject({
      GITHUB_APP_ID: '{{ .githubAppId }}',
      GITHUB_APP_CLIENT_ID: '{{ .githubAppClientId }}',
      GITHUB_APP_CLIENT_SECRET: '{{ .githubAppClientSecret }}',
    });
    expect(developerHub.spec.target.template.data.GITHUB_APP_PRIVATE_KEY)
      .toContain('githubAppPrivateKeyBase64 | b64dec');
    const developerHubProperties = Object.fromEntries(developerHub.spec.data
      .filter(item => item.secretKey.startsWith('githubApp'))
      .map(item => [item.secretKey, item.remoteRef.property]));
    expect(developerHubProperties).toEqual({
      githubAppId: 'GITHUB_APP_ID',
      githubAppClientId: 'GITHUB_APP_CLIENT_ID',
      githubAppClientSecret: 'GITHUB_APP_CLIENT_SECRET',
      githubAppPrivateKeyBase64: 'GITHUB_APP_PRIVATE_KEY_BASE64',
    });

    const devSpaces = YAML.parse(read('components/devspaces/oauth-secret.yaml'));
    expect(devSpaces.spec.target).toMatchObject({
      name: 'github-oauth-config',
      template: {
        metadata: {
          labels: {
            'app.kubernetes.io/part-of': 'che.eclipse.org',
            'app.kubernetes.io/component': 'oauth-scm-configuration',
          },
          annotations: {
            'che.eclipse.org/oauth-scm-server': 'github',
            'che.eclipse.org/scm-server-endpoint': 'https://github.com/',
          },
        },
        data: {id: '{{ .clientId }}', secret: '{{ .clientSecret }}'},
      },
    });
    expect(Object.fromEntries(devSpaces.spec.data.map(item => [
      item.secretKey, item.remoteRef.property,
    ]))).toEqual({
      clientId: 'GITHUB_APP_CLIENT_ID',
      clientSecret: 'GITHUB_APP_CLIENT_SECRET',
    });
    expect(JSON.stringify(devSpaces)).not.toContain('PRIVATE_KEY');

    const cheCluster = YAML.parse(read('components/devspaces/checluster.yaml'));
    expect(cheCluster.spec.gitServices.github).toEqual([{
      secretName: 'github-oauth-config', endpoint: 'https://github.com',
    }]);

    const appKeys = Object.keys(envFile('bootstrap/secrets.env.example'))
      .filter(key => key.startsWith('GITHUB_'));
    expect(appKeys).toEqual([
      'GITHUB_APP_ID', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET',
      'GITHUB_APP_PRIVATE_KEY_BASE64',
    ]);
    const obsoleteKeys = [
      ['DEVSPACES', 'GITHUB', 'CLIENT_ID'].join('_'),
      ['DEVSPACES', 'GITHUB', 'CLIENT_SECRET'].join('_'),
      ['GITHUB', 'TOKEN'].join('_'),
      ['GITHUB', 'APP', 'APP_ID'].join('_'),
      ['GITHUB', 'APP', 'CLIENT_ID', 'INTEGRATION'].join('_'),
      ['GITHUB', 'APP', 'CLIENT_SECRET', 'INTEGRATION'].join('_'),
    ];
    const contractSources = [
      read('bootstrap/secrets.env.example'), source,
      read('components/developer-hub/external-secret.yaml'),
      read('components/devspaces/oauth-secret.yaml'),
    ].join('\n');
    for (const key of obsoleteKeys) expect(contractSources).not.toContain(key);

    const workshop = read('bootstrap/README.md');
    const validation = read('docs/validation.md');
    expect(workshop).toContain('## Before you begin');
    expect(workshop).toContain('1. Clone the platform repository.');
    expect(workshop).toContain('2. Configure the workshop target.');
    expect(workshop).toContain('3. Configure GitHub and credentials.');
    expect(workshop).toContain('4. Commit the workshop configuration.');
    expect(workshop).toContain('5. Bootstrap OpenShift GitOps.');
    expect(workshop).toContain('6. Start the platform.');
    expect(workshop).toContain('`catalog-info.yaml` is the source of truth');
    expect(workshop).toContain('Do not create a separate GitHub OAuth App for Dev Spaces.');
    expect(workshop).toContain('spec.platform.services.devSpaces.url');
    expect(workshop).toContain('spec.platform.services.devSpaces.githubCallbackUrl');
    expect(workshop).toContain('From this point forward, Argo CD owns platform convergence.');
    expect(workshop).toContain('oc apply -k bootstrap/gitops/operator');
    expect(workshop).toContain('oc apply -k bootstrap/gitops/instance');
    expect(workshop).toContain('oc create secret generic platform-secrets');
    expect(workshop).toContain('oc kustomize .');
    expect(workshop).not.toContain('ROUTER_DOMAIN=');
    expect(workshop).not.toContain("-o jsonpath='{.status.cheURL}");
    expect(workshop).not.toContain('OpenShift Dev Spaces 3.28 therefore produces');
    expect(validation).toContain("-o jsonpath='{.status.cheURL}{\"\\n\"}'");
    expect(validation).toContain('oc get externalsecret rhdh-secrets -n developer-hub');
    expect(validation).toContain('/opt/app-root/src/kubernetes-ca/ca.crt');
  });

  test('publishes both GitOps webhook endpoints from the router-domain contract', () => {
    const target = YAML.parse(read('catalog-info.yaml'));
    expect(target.spec.platform.argocd.webhooks).toEqual({
      application: 'https://openshift-gitops-server-openshift-gitops.' +
        `${target.spec.platform.cluster.routerDomain}/api/webhook`,
      applicationSet: 'https://openshift-gitops-applicationset-controller-openshift-gitops.' +
        `${target.spec.platform.cluster.routerDomain}/api/webhook`,
    });
    const template = read('bootstrap/catalog-info.template.yaml');
    expect(template).toContain('openshift-gitops-server-openshift-gitops.@@ROUTER_DOMAIN@@/api/webhook');
    expect(template).toContain('openshift-gitops-applicationset-controller-openshift-gitops.@@ROUTER_DOMAIN@@/api/webhook');
  });
});

describe('Software Templates catalog configuration', () => {
  const externalSecret = YAML.parse(read('components/developer-hub/external-secret.yaml'));
  const templateData = externalSecret.spec.target.template.data;

  test('derives catalog and provider values from the public platform configuration', () => {
    const platformConfigSource = externalSecret.spec.data.find(
      item => item.secretKey === 'platformConfig',
    );
    expect(platformConfigSource).toMatchObject({
      sourceRef: {storeRef: {kind: 'ClusterSecretStore', name: 'cf-idp-config'}},
      remoteRef: {key: 'platform-target-config', property: 'platform.yaml'},
    });
    expect(templateData).toHaveProperty('SOFTWARE_TEMPLATES_CATALOG_URL');
    expect(templateData).toHaveProperty('GITHUB_CATALOG_REPOSITORY_FILTER');

    const catalogTemplate = templateData.SOFTWARE_TEMPLATES_CATALOG_URL;
    expect(catalogTemplate).toContain('spec.platform.dependencies.softwareTemplates');
    for (const field of ['repositoryUrl', 'revision', 'catalogPath']) {
      expect(catalogTemplate).toContain(`$dependency.${field}`);
    }
    expect(catalogTemplate).toContain('urlParse');
    expect(catalogTemplate).toContain('regexReplaceAll');
    expect(catalogTemplate).toContain('trimSuffix ".git"');
    expect(catalogTemplate).toContain('/blob/');
    for (const hardcoded of ['contract-first-idp-test', 'software-templates', 'v1.0.0']) {
      expect(catalogTemplate).not.toContain(hardcoded);
    }

    const filterTemplate = templateData.GITHUB_CATALOG_REPOSITORY_FILTER;
    for (const field of ['host', 'organization', 'repository']) {
      expect(filterTemplate).toContain(`$dependency.${field}`);
    }
    expect(filterTemplate).toContain('regexQuoteMeta');
    expect(filterTemplate).toContain('.*');
  });

  test.each([
    [
      'repository URL with .git',
      {
        repositoryUrl: 'https://github.com/example/software-templates.git',
        revision: 'v2.3.4',
        catalogPath: 'catalog-info.yaml',
      },
      'https://github.com/example/software-templates/blob/v2.3.4/catalog-info.yaml',
    ],
    [
      'repository URL without .git and a leading catalog slash',
      {
        repositoryUrl: 'https://github.com/example/software-templates',
        revision: 'release/next',
        catalogPath: '/catalog-info.yaml',
      },
      'https://github.com/example/software-templates/blob/release/next/catalog-info.yaml',
    ],
    [
      'nested catalog path and duplicate separators',
      {
        repositoryUrl: 'https://github.com//example//software-templates.git/',
        revision: '0123456789abcdef',
        catalogPath: '//catalog//templates//catalog-info.yaml',
      },
      'https://github.com/example/software-templates/blob/0123456789abcdef/catalog/templates/catalog-info.yaml',
    ],
  ])('normalizes %s', (_, dependency, expected) => {
    expect(softwareTemplatesCatalogUrl(dependency)).toBe(expected);
  });

  test('excludes only an explicitly loaded repository in the provider organization', () => {
    expect(githubCatalogRepositoryFilter({
      host: 'github.com', organization: 'example',
    }, {
      host: 'github.com', organization: 'example', repository: 'software-templates',
    })).toBe('^(?!software-templates$).*$');

    const dependency = {
      host: 'github.com',
      organization: 'example',
      repository: 'software.templates+',
    };
    const filter = githubCatalogRepositoryFilter({
      host: 'github.com', organization: 'example',
    }, dependency);
    const repositoryPattern = new RegExp(filter);

    expect(filter).toBe('^(?!software\\.templates\\+$).*$');
    expect(repositoryPattern.test('software.templates+')).toBe(false);
    for (const repository of [
      'platform-components', 'payments-domain', 'storefront-system',
      'reviews-api', 'reviews-component', 'reviews-db-resource',
    ]) expect(repositoryPattern.test(repository)).toBe(true);
  });

  test('keeps broad provider discovery for an external template organization', () => {
    const filter = githubCatalogRepositoryFilter({
      host: 'github.com', organization: 'adopter',
    }, {
      host: 'github.com', organization: 'contract-first-idp', repository: 'software-templates',
    });
    expect(filter).toBe('.*');
    expect(new RegExp(filter).test('any-generated-repository')).toBe(true);
  });

  test('keeps public catalog coordinates out of installer secrets and helper logic', () => {
    expect(read('bootstrap/secrets.env.example')).not.toMatch(/SOFTWARE_TEMPLATES|CATALOG_URL/);
    expect(exists('bootstrap/config.env')).toBe(false);
    const helper = read('bootstrap/configure-workshop.sh');
    for (const forbidden of [
      'softwareTemplates', 'software-templates', 'SOFTWARE_TEMPLATES_CATALOG_URL',
    ]) expect(helper).not.toContain(forbidden);
  });
});

describe('ApplicationSet policy and rendering', () => {
  const applicationSet = YAML.parse(read('bootstrap/root/platform-applicationset.yaml'));
  const inventory = applicationSet.spec.generators[0].matrix.generators[1].list.elements;

  test('uses the root target, complete inventory, and tolerant shared retry policy', () => {
    expect(applicationSet.spec.generators[0].matrix.generators[0].git.files)
      .toEqual([{path: 'catalog-info.yaml'}]);
    expect(inventory).toHaveLength(20);
    expect(applicationSet.spec.template.spec.syncPolicy).toMatchObject({
      automated: {prune: true, selfHeal: true},
      retry: {
        limit: 10,
        backoff: {duration: '10s', factor: 2, maxDuration: '2m'},
      },
    });
    expect(inventory.every(item => item.wave === undefined)).toBe(true);
  });

  test('keeps conservative lifecycle behavior and Microcks first-install protection', () => {
    expect(applicationSet.spec.syncPolicy).toEqual({
      applicationsSync: 'create-update',
      preserveResourcesOnDeletion: true,
    });
    expect(applicationSet.spec.template.metadata.finalizers).toBeUndefined();
    expect(applicationSet.spec.template.metadata.annotations)
      .not.toHaveProperty('argocd.argoproj.io/sync-wave');
    expect(inventory.find(item => item.name === 'microcks')).toEqual({
      name: 'microcks', project: 'platform-services', namespace: 'microcks',
      path: 'components/microcks', renderer: 'microcks',
      createNamespace: 'true', skipDryRun: 'true',
    });
    expect(applicationSet.spec.templatePatch).toContain('SkipDryRunOnMissingResource=true');
    expect(applicationSet.spec.templatePatch).toContain('realm: platform');
  });

  test('maps every inventory path to an explicit supported renderer', () => {
    expect(new Set(inventory.map(item => item.renderer)))
      .toEqual(new Set([
        'kustomize', 'keycloak', 'devspaces', 'apicurio', 'quay-bridge', 'microcks',
        'directory',
      ]));
    for (const item of inventory) {
      expect({name: item.name, pathExists: exists(item.path)})
        .toEqual({name: item.name, pathExists: true});
      if (item.renderer !== 'directory') {
        expect({name: item.name, kustomization: exists(path.join(item.path, 'kustomization.yaml'))})
          .toEqual({name: item.name, kustomization: true});
      }
    }

    expect(inventory.find(item => item.name === 'tenant-admissions')).toEqual({
      name: 'tenant-admissions', project: 'platform-services', namespace: 'openshift-gitops',
      path: 'tenants', renderer: 'directory', createNamespace: 'false', skipDryRun: 'true',
    });
    expect(applicationSet.spec.template.spec.source).toEqual({
      repoURL: '{{ .spec.platform.configuration.repositoryUrl }}',
      targetRevision: '{{ .spec.platform.configuration.revision }}',
      path: '{{ .path }}',
    });
    expect(applicationSet.spec.templatePatch).toContain('if eq .renderer "keycloak"');
    for (const renderer of ['devspaces', 'apicurio', 'quay-bridge', 'microcks', 'directory']) {
      expect(applicationSet.spec.templatePatch).toContain(`else if eq .renderer "${renderer}"`);
    }
    expect(applicationSet.spec.templatePatch).toMatch(
      /else if eq \.renderer "directory"[\s\S]*directory:\s*\n\s+recurse: true/,
    );
    const patch = applicationSet.spec.templatePatch;
    expect(inventory.find(item => item.name === 'devspaces').renderer).toBe('devspaces');
    expect(patch).toContain('kind: CheCluster');
    expect(patch).toContain('path: /spec/networking/hostname');
    expect(patch).toContain('.spec.platform.services.devSpaces.url');
    expect(patch).toContain('kind: ApicurioRegistry3');
    expect(patch).toContain('path: /spec/app/ingress/host');
    expect(patch).toContain('kind: QuayIntegration');
    expect(patch).toContain('path: /spec/quayHostname');
    expect(patch).toContain('chart: microcks');
    expect(patch).toContain('ref: values');
    expect(patch).toContain('if eq .skipDryRun "true"');
    expect(patch).toContain('SkipDryRunOnMissingResource=true');
    expect(inventory.filter(item => item.renderer === 'kustomize').length).toBeGreaterThan(0);
    expect(inventory.every(item => item.renderer === 'kustomize' ||
      patch.includes(`eq .renderer "${item.renderer}"`))).toBe(true);
  });

  test('renders every bootstrap and public-config boundary', () => {
    expect(render('bootstrap/gitops/operator').map(item => item.kind))
      .toEqual(['Namespace', 'OperatorGroup', 'Subscription']);

    const instance = render('bootstrap/gitops/instance');
    const argo = instance.filter(item => item.kind === 'ArgoCD');
    expect(argo).toHaveLength(1);
    expect(argo[0].spec.applicationSet.extraCommandArgs)
      .toEqual(['--enable-policy-override']);
    expect(argo[0].spec.kustomizeBuildOptions).toBeUndefined();
    expect(argo[0].spec.resourceIgnoreDifferences).toEqual({
      resourceIdentifiers: [{
        group: '',
        kind: 'ServiceAccount',
        customization: {jsonPointers: ['/imagePullSecrets']},
      }],
    });
    const applicationSetRoute = instance.find(item => item.kind === 'Route');
    expect(applicationSetRoute).toMatchObject({
      metadata: {name: 'openshift-gitops-applicationset-controller'},
      spec: {
        port: {targetPort: 'webhook'},
        to: {kind: 'Service', name: 'openshift-gitops-applicationset-controller'},
      },
    });

    const rootResources = render('.');
    expect(rootResources.filter(item => item.kind === 'Application')).toHaveLength(1);
    const targetConfig = rootResources.find(item =>
      item.kind === 'Secret' && item.metadata.name === 'platform-target-config');
    expect(targetConfig).toMatchObject({
      metadata: {namespace: 'cf-idp-secrets'},
      type: 'Opaque',
    });
    expect(Object.keys(targetConfig.data)).toEqual(['platform.yaml']);
    expect(Buffer.from(targetConfig.data['platform.yaml'], 'base64').toString())
      .toBe(read('catalog-info.yaml'));
    const platformRoot = rootResources.find(item =>
      item.kind === 'Application' && item.metadata.name === 'platform-root');
    expect(platformRoot.spec.source.path).toBe('.');
    const renderedSets = rootResources.filter(item => item.kind === 'ApplicationSet');
    expect(renderedSets).toHaveLength(1);
    expect(renderedSets[0].spec.templatePatch).toContain('realm: platform');

    const keycloak = render('components/keycloak');
    const realm = keycloak.find(item => item.kind === 'KeycloakRealmImport');
    expect(realm.spec.realm.realm).toBe('platform');
    expect(realm.spec.realm.clients[0].clientId).toBe('backstage');

    const pipelines = render('components/pipelines');
    const consoleRole = pipelines.find(item =>
      item.kind === 'ClusterRole' && item.metadata.name === 'enable-pipelines-console-plugin');
    expect(consoleRole.rules).toEqual([{
      apiGroups: ['operator.openshift.io'], resources: ['consoles'],
      resourceNames: ['cluster'], verbs: ['get', 'patch'],
    }]);
    const consoleJob = pipelines.find(item =>
      item.kind === 'Job' && item.metadata.name === 'enable-pipelines-console-plugin');
    expect(consoleJob.metadata.annotations).toMatchObject({
      'argocd.argoproj.io/hook': 'PostSync',
      'argocd.argoproj.io/hook-delete-policy': 'BeforeHookCreation,HookSucceeded',
    });
    expect(consoleJob.spec.template.spec.containers[0].image)
      .toBe('registry.redhat.io/openshift4/ose-cli');
    expect(read('components/pipelines/enable-console-plugin.yaml'))
      .not.toContain('quay.io/openshift/origin-cli:4.16');
    const consoleScript = consoleJob.spec.template.spec.containers[0].args.join('\n');
    expect(consoleScript).toContain('/spec/plugins/-');
    expect(consoleScript).toContain('/spec/plugins');
    expect(consoleScript).toContain('pipelines-console-plugin');
    expect(consoleScript).not.toContain('ConsolePlugin');
  });

  test('replaces both Application and ApplicationSet repository coordinates', () => {
    const source = read('bootstrap/root/kustomization.yaml');
    expect(source).toContain('fieldPaths: [spec.source.repoURL]');
    expect(source).toContain('fieldPaths: [spec.source.targetRevision]');
    expect(source).toContain(
      'fieldPaths: [spec.generators.0.matrix.generators.0.git.repoURL]',
    );
    expect(source).toContain(
      'fieldPaths: [spec.generators.0.matrix.generators.0.git.revision]',
    );
  });
});

describe('workshop helper and credential boundary', () => {
  test('configure-workshop changes only its two public outputs, never the inventory', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-helper-'));
    const checkout = path.join(temporary, 'repository');
    try {
      fs.cpSync(root, checkout, {
        recursive: true,
        filter: source => !source.split(path.sep).some(part => ['.git', 'node_modules'].includes(part)),
      });
      execFileSync('git', ['init', '-q'], {cwd: checkout});
      execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:fixture-org/platform-components.git'], {cwd: checkout});
      execFileSync('git', ['switch', '-q', '-c', 'workshop'], {cwd: checkout});
      const appSetPath = path.join(checkout, 'bootstrap/root/platform-applicationset.yaml');
      const before = sha256(appSetPath);
      const fixtureBin = path.join(checkout, 'test/fixtures/bin');
      execFileSync(path.join(checkout, 'bootstrap/configure-workshop.sh'), [], {
        cwd: checkout,
        env: {...process.env, PATH: `${fixtureBin}${path.delimiter}${process.env.PATH}`},
      });
      expect(sha256(appSetPath)).toBe(before);
      expect(readFrom(checkout, 'catalog-info.yaml')).toContain('organization: "fixture-org"');
      expect(readFrom(checkout, 'catalog-info.yaml'))
        .toContain('apiUrl: "https://api.fixture.example:6443"');
      expect(YAML.parse(readFrom(checkout, 'catalog-info.yaml')).spec.platform.services.devSpaces)
        .toEqual({
          url: 'https://devspaces.apps.fixture.example',
          githubCallbackUrl: 'https://devspaces.apps.fixture.example/api/oauth/callback',
        });
      expect(readFrom(checkout, 'bootstrap/root/kustomization.yaml'))
        .toContain('PLATFORM_REVISION=workshop');
    } finally {
      fs.rmSync(temporary, {recursive: true, force: true});
    }
  });

  test('helper remains independent of component, chart, and fixture details', () => {
    const helper = read('bootstrap/configure-workshop.sh');
    for (const forbidden of [
      'components/', 'operators/', 'platform-applicationset', 'keycloak',
      'microcks', 'developer-hub', 'charts/', 'test/fixtures',
    ]) expect(helper).not.toContain(forbidden);
  });

  test('local secrets stay ignored and committed public files contain no credential values', () => {
    expect(execFileSync('git', ['check-ignore', 'bootstrap/secrets.env'], {
      cwd: root, encoding: 'utf8',
    }).trim()).toBe('bootstrap/secrets.env');
    const trackedFiles = execFileSync('git', ['ls-files'], {
      cwd: root, encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);
    expect(trackedFiles).not.toContain('bootstrap/secrets.env');
    const credentialPattern = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN ([A-Z0-9 ]+)?PRIVATE KEY-----/;
    for (const relative of trackedFiles) {
      const file = path.join(root, relative);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      expect({file: relative, leaked: credentialPattern.test(fs.readFileSync(file))})
        .toEqual({file: relative, leaked: false});
    }
    const credentialKeys = Object.keys(envFile('bootstrap/secrets.env.example'));
    for (const relative of [
      'catalog-info.yaml', 'kustomization.yaml', 'bootstrap/catalog-info.template.yaml',
      'bootstrap/root/platform-applicationset.yaml',
    ]) {
      for (const key of credentialKeys) expect(read(relative)).not.toContain(key);
    }
  });
});

function readFrom(directory, relative) {
  return fs.readFileSync(path.join(directory, relative), 'utf8');
}
