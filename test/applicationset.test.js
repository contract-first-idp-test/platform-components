const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const YAML = require('yaml');
const {read, exists, parseDocuments, render} = require('./helpers/manifests');
const {createConfiguredRepository} = require('./helpers/configured-repository');

function renderWithRouterDomain(root, relative, routerDomain) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-component-'));
  const component = path.join(temporary, path.basename(relative));
  try {
    fs.cpSync(path.join(root, relative), component, {recursive: true});
    const kustomizationPath = path.join(component, 'kustomization.yaml');
    const kustomization = YAML.parse(fs.readFileSync(kustomizationPath, 'utf8'));
    kustomization.commonAnnotations = {
      ...kustomization.commonAnnotations,
      'platform.contract-first.io/router-domain': routerDomain,
    };
    fs.writeFileSync(kustomizationPath, YAML.stringify(kustomization));
    return parseDocuments(execFileSync('oc', ['kustomize', component], {encoding: 'utf8'}));
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}

describe('platform ApplicationSet rendering', () => {
  let repository;
  let root;
  let applicationSet;
  let inventory;

  beforeAll(() => {
    repository = createConfiguredRepository();
    root = repository.root;
    applicationSet = YAML.parse(read(root, 'bootstrap/root/platform-applicationset.yaml'));
    inventory = applicationSet.spec.generators[0].matrix.generators[1].list.elements;
  });

  afterAll(() => repository.cleanup());

  test('configured root renders its GitOps entrypoints and target configuration', () => {
    const resources = render(root, '.');
    for (const kind of ['Application', 'ApplicationSet', 'AppProject']) {
      expect(resources.some(resource => resource.kind === kind)).toBe(true);
    }
    const targetConfig = resources.find(resource =>
      resource.kind === 'Secret' && resource.metadata.name === 'platform-target-config');
    expect(Buffer.from(targetConfig.data['platform.yaml'], 'base64').toString())
      .toBe(read(root, 'catalog-info.yaml'));
  });

  test('GitOps exposes the ApplicationSet webhook with policy override enabled', () => {
    const resources = render(root, 'bootstrap/gitops/instance');
    const argo = resources.find(resource => resource.kind === 'ArgoCD');
    expect(argo.spec.applicationSet.extraCommandArgs).toContain('--enable-policy-override');
    expect(resources.find(resource => resource.kind === 'Route')).toMatchObject({
      spec: {port: {targetPort: 'webhook'}},
    });
  });

  test('uses target-selected sources and a deletion-safe synchronization policy', () => {
    expect(applicationSet.spec.template.spec.source).toMatchObject({
      repoURL: '{{ .spec.platform.configuration.repositoryUrl }}',
      targetRevision: '{{ .spec.platform.configuration.revision }}',
      path: '{{ .path }}',
    });
    expect(applicationSet.spec.syncPolicy).toMatchObject({
      applicationsSync: 'create-update',
      preserveResourcesOnDeletion: true,
    });
  });

  test('every inventory path renders and each dedicated namespace has one owner', () => {
    const sharedNamespaces = new Set(['openshift-operators', 'openshift-gitops']);
    const namespaceOwners = new Map();
    for (const item of inventory) {
      expect(exists(root, item.path)).toBe(true);
      if (item.renderer === 'directory') continue;
      const resources = render(root, item.path);
      for (const namespace of resources.filter(resource => resource.kind === 'Namespace')) {
        const owners = namespaceOwners.get(namespace.metadata.name) || [];
        namespaceOwners.set(namespace.metadata.name, [...owners, item.name]);
      }
    }
    for (const namespace of new Set(inventory.map(item => item.namespace))) {
      if (!sharedNamespaces.has(namespace)) {
        expect(namespaceOwners.get(namespace)).toHaveLength(1);
      }
    }
  });

  test('router-domain replacement connects identity and API services', () => {
    const domain = YAML.parse(read(root, 'catalog-info.yaml')).spec.platform.cluster.routerDomain;
    const keycloak = renderWithRouterDomain(root, 'components/keycloak', domain);
    expect(keycloak.find(resource => resource.kind === 'Keycloak').spec.hostname.hostname)
      .toContain(domain);

    const apicurio = renderWithRouterDomain(root, 'components/apicurio', domain)
      .find(resource => resource.kind === 'ApicurioRegistry3');
    expect(apicurio.spec.app.ingress.host).toContain(domain);
    expect(apicurio.spec.app.auth.authServerUrl).toContain(domain);

    const microcks = renderWithRouterDomain(root, 'components/microcks', domain);
    expect(YAML.stringify(microcks)).toContain(domain);
    expect(YAML.stringify([...keycloak, apicurio, ...microcks])).not.toContain('.invalid');
  });
});
