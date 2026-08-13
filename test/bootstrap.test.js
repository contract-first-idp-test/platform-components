const {execFileSync} = require('node:child_process');
const path = require('node:path');
const YAML = require('yaml');
const {repositoryRoot: root} = require('./helpers/paths');
const {read, render} = require('./helpers/manifests');
const {createPristineRepository} = require('./helpers/configured-repository');

describe('platform target bootstrap', () => {
  test('distribution template defines the required platform target contract', () => {
    const source = read(root, 'bootstrap/catalog-info.template.yaml');
    const template = YAML.parse(source);
    expect(template).toMatchObject({
      kind: 'Resource',
      spec: {
        type: 'contract-first-idp-target',
        platform: {
          configuration: {}, cluster: {}, argocd: {}, dependencies: {},
          schemaRegistry: {}, registry: {}, services: {}, build: {},
        },
      },
    });
    for (const token of [
      'PLATFORM_REPO_URL', 'PLATFORM_REVISION', 'SCM_HOST',
      'CLUSTER_API_URL', 'ROUTER_DOMAIN',
    ]) expect(source).toContain(`@@${token}@@`);
  });

  test('configure-workshop creates a renderable target from Git and cluster inputs', () => {
    const checkout = createPristineRepository();
    try {
      execFileSync('git', ['init', '-q'], {cwd: checkout.root});
      execFileSync('git', [
        'remote', 'add', 'origin', 'git@github.com:fixture-org/platform-components.git',
      ], {cwd: checkout.root});
      execFileSync('git', ['switch', '-q', '-c', 'test'], {cwd: checkout.root});

      const fixtureBin = path.join(checkout.root, 'test/fixtures/bin');
      execFileSync(path.join(checkout.root, 'bootstrap/configure-workshop.sh'), [], {
        cwd: checkout.root,
        env: {...process.env, PATH: `${fixtureBin}${path.delimiter}${process.env.PATH}`},
      });

      const catalogSource = read(checkout.root, 'catalog-info.yaml');
      const catalog = YAML.parse(catalogSource);
      expect(catalogSource).not.toContain('@@');
      expect(catalog.spec.platform.configuration).toMatchObject({
        repositoryUrl: 'https://github.com/fixture-org/platform-components.git',
        revision: 'test',
      });
      expect(catalog.spec.platform.cluster).toMatchObject({
        apiUrl: expect.any(String),
        routerDomain: expect.any(String),
      });

      const resources = render(checkout.root, '.');
      const targetConfig = resources.find(resource =>
        resource.kind === 'Secret' && resource.metadata.name === 'platform-target-config');
      expect(Buffer.from(targetConfig.data['platform.yaml'], 'base64').toString())
        .toBe(catalogSource);
      const rootApplication = resources.find(resource => resource.kind === 'Application');
      expect(rootApplication.spec.source).toMatchObject({
        repoURL: catalog.spec.platform.configuration.repositoryUrl,
        targetRevision: catalog.spec.platform.configuration.revision,
      });
    } finally {
      checkout.cleanup();
    }
  });
});
