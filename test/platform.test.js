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
  return parseDocuments(execFileSync('oc', [
    'kustomize', relative, '--load-restrictor=LoadRestrictionsNone',
  ], {cwd: root, encoding: 'utf8'}));
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
      'catalog-info.yaml', 'bootstrap/catalog-info.template.yaml',
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

  test('keeps stable Keycloak identifiers at the generated secret boundary', () => {
    const realm = YAML.parse(read('components/keycloak/realm.yaml')).spec.realm;
    expect(realm.id).toBe('cf-idp');
    expect(realm.realm).toBe('cf-idp');
    expect(realm.clients.find(client => client.clientId === 'backstage')).toBeDefined();
    expect(realm.users.find(user => user.username === 'service-account-backstage')
      .serviceAccountClientId).toBe('backstage');

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
    expect(YAML.parse(read('components/microcks/values.yaml')).keycloak.realm).toBe('cf-idp');
    const externalSecret = YAML.parse(read('components/developer-hub/external-secret.yaml'));
    expect(externalSecret.spec.target.template.data).toMatchObject({
      KEYCLOAK_CLIENT_ID: 'backstage',
      KEYCLOAK_REALM: 'cf-idp',
    });
    expect(externalSecret.spec.data.map(item => item.secretKey)).toEqual([
      'platformConfig', 'backendSecret', 'githubToken', 'keycloakClientSecret',
    ]);
    const configuration = YAML.parse(read('bootstrap/root/configuration/kustomization.yaml'));
    expect(configuration.secretGenerator.map(item => item.name))
      .toEqual(['platform-target-config']);
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
    const initializeScript = initializeJob.spec.template.spec.containers[0].args.join('\n');
    expect(initializeScript).toContain('/api/v1/user/initialize');
    expect(initializeScript).not.toContain('access_token');

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
    expect(catalog).toMatchObject({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Resource',
      metadata: {name: 'workshop'},
      spec: {
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
    expect(config.catalog.providers.github['cf-idp'].filters).toEqual({
      branch: 'main',
      repository: 'PLACEHOLDER_GITHUB_CATALOG_REPOSITORY_FILTER',
    });
    expect(source).not.toContain('PLATFORM_TARGET_CATALOG_URL');
    for (const hardcoded of [
      'contract-first-idp-test', 'software-templates', 'v1.0.0',
      'github.com/contract-first-idp-test/software-templates',
    ]) expect(source).not.toContain(hardcoded);
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
    expect(applicationSet.spec.templatePatch).toContain('realm: cf-idp');
  });

  test('maps every inventory path to an explicit supported renderer', () => {
    expect(new Set(inventory.map(item => item.renderer)))
      .toEqual(new Set([
        'kustomize', 'keycloak', 'apicurio', 'quay-bridge', 'microcks', 'directory',
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
    expect(applicationSet.spec.templatePatch).toContain('if eq .renderer "apicurio"');
    for (const renderer of ['quay-bridge', 'microcks', 'directory']) {
      expect(applicationSet.spec.templatePatch).toContain(`else if eq .renderer "${renderer}"`);
    }
    expect(applicationSet.spec.templatePatch).toMatch(
      /else if eq \.renderer "directory"[\s\S]*directory:\s*\n\s+recurse: true/,
    );
    const patch = applicationSet.spec.templatePatch;
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
    expect(render('test/fixtures/catalog-template')).toHaveLength(1);
    expect(render('bootstrap/gitops/operator').map(item => item.kind))
      .toEqual(['Namespace', 'OperatorGroup', 'Subscription']);

    const instance = render('bootstrap/gitops/instance');
    const argo = instance.filter(item => item.kind === 'ArgoCD');
    expect(argo).toHaveLength(1);
    expect(argo[0].spec.applicationSet.extraCommandArgs)
      .toEqual(['--enable-policy-override']);
    expect(argo[0].spec.kustomizeBuildOptions)
      .toBe('--load-restrictor LoadRestrictionsNone');

    const rootResources = render('bootstrap/root');
    expect(rootResources.filter(item => item.kind === 'Application')).toHaveLength(1);
    const renderedSets = rootResources.filter(item => item.kind === 'ApplicationSet');
    expect(renderedSets).toHaveLength(1);
    expect(renderedSets[0].spec.templatePatch).toContain('realm: cf-idp');

    const keycloak = render('components/keycloak');
    const realm = keycloak.find(item => item.kind === 'KeycloakRealmImport');
    expect(realm.spec.realm.realm).toBe('cf-idp');
    expect(realm.spec.realm.clients[0].clientId).toBe('backstage');
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
      execFileSync(path.join(checkout, 'bootstrap/configure-workshop.sh'), [
        'group:default/backstage-admins',
      ], {
        cwd: checkout,
        env: {...process.env, PATH: `${fixtureBin}${path.delimiter}${process.env.PATH}`},
      });
      expect(sha256(appSetPath)).toBe(before);
      expect(readFrom(checkout, 'catalog-info.yaml')).toContain('organization: "fixture-org"');
      expect(readFrom(checkout, 'catalog-info.yaml'))
        .toContain('apiUrl: "https://api.fixture.example:6443"');
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
      'catalog-info.yaml', 'bootstrap/catalog-info.template.yaml',
      'bootstrap/root/platform-applicationset.yaml',
    ]) {
      for (const key of credentialKeys) expect(read(relative)).not.toContain(key);
    }
  });
});

function readFrom(directory, relative) {
  return fs.readFileSync(path.join(directory, relative), 'utf8');
}
