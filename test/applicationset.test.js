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

describe('uniform platform ApplicationSet rendering', () => {
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

  test('configured fixture renders the complete platform root', () => {
    const bootstrap = render(root, '.');
    expect(bootstrap.filter(resource => resource.kind === 'Application')).toHaveLength(1);
    expect(bootstrap.find(resource => resource.kind === 'Application').metadata.name)
      .toBe('platform-configuration');
    const configuration = render(root, 'configuration');
    expect(configuration.filter(resource => resource.kind === 'Application')).toHaveLength(1);
    const distribution = render(root, 'bootstrap/root');
    expect(distribution.filter(resource => resource.kind === 'ApplicationSet')).toHaveLength(2);
    expect(distribution.filter(resource => resource.kind === 'AppProject')).toHaveLength(5);

    const fixture = read(root, 'configuration/catalog-info.yaml');
    const targetConfig = configuration.find(resource =>
      resource.kind === 'Secret' && resource.metadata.name === 'platform-target-config');
    expect(Buffer.from(targetConfig.data['platform.yaml'], 'base64').toString()).toBe(fixture);
  });

  test('GitOps bootstrap enables ApplicationSet policy control and its webhook', () => {
    expect(render(root, 'bootstrap/gitops/operator').map(resource => resource.kind))
      .toEqual(['Namespace', 'OperatorGroup', 'Subscription']);
    const resources = render(root, 'bootstrap/gitops/instance');
    const argo = resources.find(resource => resource.kind === 'ArgoCD');
    expect(argo.spec.applicationSet.extraCommandArgs).toEqual(['--enable-policy-override']);
    expect(argo.spec.resourceIgnoreDifferences).toEqual({
      resourceIdentifiers: [{
        group: '',
        kind: 'ServiceAccount',
        customization: {jsonPointers: ['/imagePullSecrets']},
      }],
    });
    expect(resources.find(resource => resource.kind === 'Route')).toMatchObject({
      metadata: {name: 'openshift-gitops-applicationset-controller'},
      spec: {
        port: {targetPort: 'webhook'},
        to: {kind: 'Service', name: 'openshift-gitops-applicationset-controller'},
      },
    });
  });

  test('uses one common Kustomize source and conservative shared sync policy', () => {
    expect(inventory).toHaveLength(21);
    expect(applicationSet.spec.generators[0].matrix.generators[0].git.files)
      .toEqual([{path: 'configuration/catalog-info.yaml'}]);
    expect(applicationSet.spec.template.spec.source).toEqual({
      repoURL: '{{ .spec.platform.distribution.repositoryUrl }}',
      targetRevision: '{{ .spec.platform.distribution.revision }}',
      path: '{{ .path }}',
      kustomize: {commonAnnotations: {
        'platform.contract-first.io/router-domain':
          '{{ .spec.platform.cluster.routerDomain }}',
      }},
    });
    expect(applicationSet.spec.template.spec.syncPolicy).toMatchObject({
      automated: {prune: true, selfHeal: true},
      retry: {
        limit: 10,
        backoff: {duration: '10s', factor: 2, maxDuration: '2m'},
      },
    });
    expect(applicationSet.spec.templatePatch.match(/SkipDryRunOnMissingResource=true/g))
      .toHaveLength(1);
    expect(applicationSet.spec.templatePatch).not.toContain('CreateNamespace=true');
    expect(applicationSet.spec.syncPolicy).toEqual({
      applicationsSync: 'create-update', preserveResourcesOnDeletion: true,
    });
  });

  test('every platform path is valid and each non-shared destination has one namespace owner', () => {
    const sharedNamespaces = new Set(['openshift-operators', 'openshift-gitops']);
    const namespaceOwners = new Map();
    for (const item of inventory) {
      expect(exists(root, item.path)).toBe(true);
      if (item.renderer === 'directory') continue;
      expect(exists(root, path.join(item.path, 'kustomization.yaml'))).toBe(true);
      const resources = render(root, item.path);
      for (const namespace of resources.filter(resource => resource.kind === 'Namespace')) {
        const owners = namespaceOwners.get(namespace.metadata.name) || [];
        namespaceOwners.set(namespace.metadata.name, [...owners, item.name]);
      }
    }
    for (const namespace of new Set(inventory.map(item => item.namespace))) {
      if (sharedNamespaces.has(namespace)) continue;
      expect(namespaceOwners.get(namespace)).toHaveLength(1);
    }
  });

  test('tenant admission is the only directory-rendered exception', () => {
    expect(inventory.find(item => item.name === 'tenant-admissions')).toEqual({
      name: 'tenant-admissions',
      project: 'tenant-admissions',
      namespace: 'openshift-gitops',
      path: 'tenants',
      renderer: 'directory',
      source: 'configuration',
    });
    expect(inventory.filter(item => item.name !== 'tenant-admissions')
      .every(item => item.renderer === undefined)).toBe(true);
    expect(applicationSet.spec.templatePatch).toMatch(
      /renderer" \| default "kustomize"\) "directory"[\s\S]*kustomize: null[\s\S]*directory:\s*\n\s+recurse: true/,
    );
    expect(applicationSet.spec.templatePatch).toContain("exclude: '*/admission.yaml'");
  });

  test('existing Domain Applications continuously follow the selected chart tag', () => {
    const domainSet = YAML.parse(read(root, 'bootstrap/root/tenant-domain-applicationset.yaml'));
    expect(domainSet.spec.generators[0].matrix.generators[0].git.files)
      .toEqual([{path: 'configuration/catalog-info.yaml'}]);
    expect(domainSet.spec.generators[0].matrix.generators[1].git.files)
      .toEqual([{path: 'tenants/*/admission.yaml'}]);
    expect(domainSet.spec.template.spec.sources[0]).toMatchObject({
      repoURL: '{{ .spec.platform.dependencies.developerCharts.repositoryUrl }}',
      targetRevision: '{{ .spec.platform.dependencies.developerCharts.revision }}',
      path: 'charts/domain/environment',
    });
    expect(read(root, 'bootstrap/root/tenant-domain-applicationset.yaml'))
      .not.toMatch(/targetRevision: v[0-9]+\.[0-9]+\.[0-9]+/);
  });

  test('contains no component-specific or external runtime renderer logic', () => {
    const source = read(root, 'bootstrap/root/platform-applicationset.yaml');
    expect(applicationSet.spec.templatePatch)
      .not.toMatch(/Keycloak|CheCluster|ApicurioRegistry3|QuayIntegration/);
    expect(source).not.toMatch(/renderer: (keycloak|devspaces|apicurio|quay-bridge|microcks)/);
    expect(source).not.toMatch(/microcks\.io\/helm|chart: microcks|sources:/);
    expect(exists(root, 'components/microcks/deployment.yaml')).toBe(true);
    expect(render(root, 'components/microcks').some(resource =>
      resource.kind === 'Deployment' && resource.metadata.name === 'microcks')).toBe(true);
  });

  test('component-local replacements interpret the fixture router domain', () => {
    const domain = YAML.parse(read(root, 'configuration/catalog-info.yaml'))
      .spec.platform.cluster.routerDomain;
    const keycloak = renderWithRouterDomain(root, 'components/keycloak', domain);
    expect(keycloak.find(resource => resource.kind === 'Keycloak').spec.hostname.hostname)
      .toBe(`https://cf-idp-keycloak-keycloak.${domain}`);
    expect(keycloak.find(resource => resource.kind === 'Route').spec.host)
      .toBe(`cf-idp-keycloak-keycloak.${domain}`);

    const devspaces = renderWithRouterDomain(root, 'components/devspaces', domain);
    expect(devspaces.find(resource => resource.kind === 'CheCluster').spec.networking.hostname)
      .toBe(`devspaces.${domain}`);

    const apicurio = renderWithRouterDomain(root, 'components/apicurio', domain)
      .find(resource => resource.kind === 'ApicurioRegistry3');
    expect(apicurio.spec.app.ingress.host).toBe(`apicurio.${domain}`);
    expect(apicurio.spec.ui.ingress.host).toBe(`apicurio-ui.${domain}`);
    expect(apicurio.spec.app.auth.authServerUrl)
      .toBe(`https://cf-idp-keycloak-keycloak.${domain}/realms/platform`);
    expect(apicurio.spec.ui.env).toContainEqual({
      name: 'REGISTRY_API_URL', value: `https://apicurio.${domain}/apis/registry/v3`,
    });

    const quay = renderWithRouterDomain(root, 'components/quay-bridge', domain)
      .find(resource => resource.kind === 'QuayIntegration');
    expect(quay.spec.quayHostname).toBe(`https://registry-quay-quay.${domain}`);

    const microcks = renderWithRouterDomain(root, 'components/microcks', domain);
    expect(microcks.find(resource =>
      resource.kind === 'Route' && resource.metadata.name === 'microcks').spec.host)
      .toBe(`microcks.${domain}`);
    const deployment = microcks.find(resource =>
      resource.kind === 'Deployment' && resource.metadata.name === 'microcks');
    expect(deployment.spec.template.spec.containers[0].env).toEqual(expect.arrayContaining([
      {name: 'KEYCLOAK_URL', value: `https://cf-idp-keycloak-keycloak.${domain}`},
      {name: 'KEYCLOAK_PUBLIC_URL', value: `https://cf-idp-keycloak-keycloak.${domain}`},
    ]));
    expect(JSON.stringify(microcks)).not.toContain('.invalid');
  });
});
