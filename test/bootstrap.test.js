const {execFileSync} = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const {repositoryRoot: root} = require('./helpers/paths');
const {read, exists, render} = require('./helpers/manifests');
const {createPristineRepository} = require('./helpers/configured-repository');

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('platform target bootstrap', () => {
  test('the distribution-owned template defines the complete target contract', () => {
    const source = read(root, 'bootstrap/catalog-info.template.yaml');
    const template = YAML.parse(source);
    expect(template).toMatchObject({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Resource',
      metadata: {name: 'workshop'},
      spec: {
        owner: 'group:default/platform-maintainers',
        type: 'contract-first-idp-target',
        platform: {
          configuration: {valuesPath: 'configuration/catalog-info.yaml'},
          cluster: {}, argocd: {}, dependencies: {}, schemaRegistry: {},
          registry: {}, services: {}, build: {},
        },
      },
    });
    for (const token of [
      'PLATFORM_REPO_URL', 'PLATFORM_CONFIGURATION_REVISION',
      'PLATFORM_DISTRIBUTION_REPO_URL', 'PLATFORM_DISTRIBUTION_REVISION',
      'PLATFORM_VERSION', 'DEVELOPER_CHARTS_REPO_URL',
      'DEVELOPER_CHARTS_REVISION', 'DEVELOPER_CHARTS_VERSION',
      'SOFTWARE_TEMPLATES_REPO_URL', 'SOFTWARE_TEMPLATES_REVISION',
      'SOFTWARE_TEMPLATES_VERSION',
      'SCM_HOST', 'SCM_ORGANIZATION',
      'SCM_REPOSITORY', 'CLUSTER_API_URL', 'CLUSTER_NAME', 'ROUTER_DOMAIN',
    ]) expect(source).toContain(`@@${token}@@`);
  });

  test('configure-workshop turns a pristine fork into a renderable configured target', () => {
    const checkout = createPristineRepository();
    try {
      expect(exists(checkout.root, 'configuration/catalog-info.yaml')).toBe(false);
      execFileSync('git', ['init', '-q'], {cwd: checkout.root});
      execFileSync('git', [
        'remote', 'add', 'origin', 'git@github.com:fixture-org/platform-components.git',
      ], {cwd: checkout.root});
      execFileSync('git', ['switch', '-q', '-c', 'test'], {cwd: checkout.root});

      const applicationSet = path.join(
        checkout.root, 'bootstrap/root/platform-applicationset.yaml',
      );
      const applicationSetBefore = sha256(applicationSet);
      const fixtureBin = path.join(checkout.root, 'test/fixtures/bin');
      execFileSync(path.join(checkout.root, 'bootstrap/configure-workshop.sh'), [], {
        cwd: checkout.root,
        env: {
          ...process.env,
          PATH: `${fixtureBin}${path.delimiter}${process.env.PATH}`,
          DEVELOPER_CHARTS_REPOSITORY_URL:
            'https://github.com/fixture-org/developer-charts.git',
          DEVELOPER_CHARTS_REVISION: 'v1.0.2',
          DEVELOPER_CHARTS_VERSION: '1.0.2',
          SOFTWARE_TEMPLATES_REPOSITORY_URL:
            'https://github.com/fixture-org/software-templates.git',
          SOFTWARE_TEMPLATES_REVISION: 'v1.1.1',
          SOFTWARE_TEMPLATES_VERSION: '1.1.1',
        },
      });

      expect(exists(checkout.root, 'configuration/catalog-info.yaml')).toBe(true);
      expect(sha256(applicationSet)).toBe(applicationSetBefore);
      const catalogSource = read(checkout.root, 'configuration/catalog-info.yaml');
      expect(catalogSource).not.toContain('@@');
      const catalog = YAML.parse(catalogSource);
      expect(catalog.metadata.annotations['github.com/project-slug'])
        .toBe('fixture-org/platform-components');
      expect(catalog.spec.platform.configuration).toMatchObject({
        host: 'github.com',
        organization: 'fixture-org',
        repository: 'platform-components',
        repositoryUrl: 'https://github.com/fixture-org/platform-components.git',
        revision: 'test',
        valuesPath: 'configuration/catalog-info.yaml',
      });
      expect(catalog.spec.platform.distribution)
        .toEqual({
          repositoryUrl: 'https://github.com/fixture-org/platform-components.git',
          version: '1.1.1', revision: 'v1.1.1',
        });
      expect(catalog.spec.platform.tenantAdmission.branch).toBe('test');
      expect(catalog.spec.platform.dependencies.developerCharts).toMatchObject({
        revision: 'v1.0.2', version: '1.0.2',
      });
      expect(catalog.spec.platform.dependencies.softwareTemplates).toMatchObject({
        revision: 'v1.1.1', version: '1.1.1',
      });
      expect(catalog.spec.platform.cluster).toEqual({
        name: 'fixture',
        apiUrl: 'https://api.fixture.example:6443',
        routerDomain: 'apps.fixture.example',
      });
      expect(catalog.spec.platform.services.devSpaces).toEqual({
        url: 'https://devspaces.apps.fixture.example',
        githubCallbackUrl: 'https://devspaces.apps.fixture.example/api/oauth/callback',
      });
      expect(catalog.spec.platform.argocd.webhooks).toEqual({
        application:
          'https://openshift-gitops-server-openshift-gitops.apps.fixture.example/api/webhook',
        applicationSet:
          'https://openshift-gitops-applicationset-controller-openshift-gitops.apps.fixture.example/api/webhook',
      });

      const bootstrap = render(checkout.root, '.');
      const configuration = render(checkout.root, 'configuration');
      const targetConfig = configuration.find(resource =>
        resource.kind === 'Secret' && resource.metadata.name === 'platform-target-config');
      expect(Buffer.from(targetConfig.data['platform.yaml'], 'base64').toString())
        .toBe(catalogSource);
      const configurationApplication = bootstrap.find(resource =>
        resource.kind === 'Application' && resource.metadata.name === 'platform-configuration');
      expect(configurationApplication.spec.source).toMatchObject({
        repoURL: 'https://github.com/fixture-org/platform-components.git',
        targetRevision: 'test',
        path: 'configuration',
      });
      const rootApplication = configuration.find(resource =>
        resource.kind === 'Application' && resource.metadata.name === 'platform-root');
      expect(rootApplication.spec.source).toMatchObject({
        repoURL: 'https://github.com/fixture-org/platform-components.git',
        targetRevision: 'v1.1.1',
        path: 'bootstrap/root',
      });
      expect(rootApplication.spec.source.kustomize.patches[0].patch).toContain(
        'PLATFORM_CONFIGURATION_REVISION: "test"');
      execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], {
        cwd: checkout.root,
      });
      execFileSync('git', ['config', 'user.name', 'Fixture'], {cwd: checkout.root});
      execFileSync('git', ['add', '.'], {cwd: checkout.root});
      execFileSync('git', ['commit', '-q', '-m', 'Configure workshop'], {cwd: checkout.root});
      expect(execFileSync('git', ['branch', '--show-current'], {
        cwd: checkout.root, encoding: 'utf8',
      }).trim()).toBe('test');
    } finally {
      checkout.cleanup();
    }
  });

  test('the helper stays independent of platform component implementation', () => {
    const helper = read(root, 'bootstrap/configure-workshop.sh');
    for (const forbidden of [
      'components/', 'operators/', 'platform-applicationset', 'keycloak',
      'microcks', 'developer-hub', 'charts/', 'test/fixtures',
    ]) expect(helper).not.toContain(forbidden);
  });

  test('configuration refuses detached HEAD before cluster mutation', () => {
    const checkout = createPristineRepository();
    try {
      execFileSync('git', ['init', '-q'], {cwd: checkout.root});
      execFileSync('git', [
        'remote', 'add', 'origin', 'git@github.com:fixture-org/platform-components.git',
      ], {cwd: checkout.root});
      execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], {
        cwd: checkout.root,
      });
      execFileSync('git', ['config', 'user.name', 'Fixture'], {cwd: checkout.root});
      execFileSync('git', ['add', '.'], {cwd: checkout.root});
      execFileSync('git', ['commit', '-q', '-m', 'Distribution'], {cwd: checkout.root});
      execFileSync('git', ['switch', '-q', '--detach'], {cwd: checkout.root});
      const result = require('node:child_process').spawnSync(
        path.join(checkout.root, 'bootstrap/configure-workshop.sh'), [], {
          cwd: checkout.root,
          encoding: 'utf8',
          env: {
            ...process.env,
            DEVELOPER_CHARTS_REPOSITORY_URL: 'https://example.invalid/developer-charts.git',
            DEVELOPER_CHARTS_REVISION: 'v1.0.2',
            DEVELOPER_CHARTS_VERSION: '1.0.2',
            SOFTWARE_TEMPLATES_REPOSITORY_URL: 'https://example.invalid/software-templates.git',
            SOFTWARE_TEMPLATES_REVISION: 'v1.1.1',
            SOFTWARE_TEMPLATES_VERSION: '1.1.1',
          },
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('detached HEAD is not a configuration branch');
      expect(exists(checkout.root, 'configuration')).toBe(false);
    } finally {
      checkout.cleanup();
    }
  });
});
