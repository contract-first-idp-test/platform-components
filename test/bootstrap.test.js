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
          configuration: {valuesPath: 'catalog-info.yaml'},
          cluster: {}, argocd: {}, dependencies: {}, schemaRegistry: {},
          registry: {}, services: {}, build: {},
        },
      },
    });
    for (const token of [
      'PLATFORM_REPO_URL', 'PLATFORM_REVISION', 'SCM_HOST', 'SCM_ORGANIZATION',
      'SCM_REPOSITORY', 'CLUSTER_API_URL', 'CLUSTER_NAME', 'ROUTER_DOMAIN',
    ]) expect(source).toContain(`@@${token}@@`);
  });

  test('configure-workshop turns a pristine fork into a renderable configured target', () => {
    const checkout = createPristineRepository();
    try {
      expect(exists(checkout.root, 'catalog-info.yaml')).toBe(false);
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
        env: {...process.env, PATH: `${fixtureBin}${path.delimiter}${process.env.PATH}`},
      });

      expect(exists(checkout.root, 'catalog-info.yaml')).toBe(true);
      expect(sha256(applicationSet)).toBe(applicationSetBefore);
      const catalogSource = read(checkout.root, 'catalog-info.yaml');
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

      const resources = render(checkout.root, '.');
      const targetConfig = resources.find(resource =>
        resource.kind === 'Secret' && resource.metadata.name === 'platform-target-config');
      expect(Buffer.from(targetConfig.data['platform.yaml'], 'base64').toString())
        .toBe(catalogSource);
      const rootApplication = resources.find(resource =>
        resource.kind === 'Application' && resource.metadata.name === 'platform-root');
      expect(rootApplication.spec.source).toMatchObject({
        repoURL: 'https://github.com/fixture-org/platform-components.git',
        targetRevision: 'test',
        path: '.',
      });
      const generatedSet = resources.find(resource => resource.kind === 'ApplicationSet');
      expect(generatedSet.spec.generators[0].matrix.generators[0].git).toMatchObject({
        repoURL: 'https://github.com/fixture-org/platform-components.git',
        revision: 'test',
      });
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
});
