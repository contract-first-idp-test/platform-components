const YAML = require('yaml');
const {repositoryRoot} = require('./helpers/paths');
const {read, render} = require('./helpers/manifests');
const {createConfiguredRepository} = require('./helpers/configured-repository');

const clusterScopedKinds = new Set([
  'Namespace', 'ClusterRole', 'ClusterRoleBinding',
  'ClusterSecretStore', 'ExternalSecretsConfig',
]);

function apiGroup(resource) {
  const apiVersion = resource.apiVersion || '';
  return apiVersion.includes('/') ? apiVersion.split('/')[0] : '';
}

function permits(rules, group, kind) {
  return (rules || []).some(rule =>
    (rule.group === '*' || rule.group === group) &&
    (rule.kind === '*' || rule.kind === kind));
}

function permitsDestination(project, server, namespace) {
  return project.spec.destinations.some(destination =>
    (destination.server === '*' || destination.server === server) &&
    (destination.namespace === '*' || destination.namespace === namespace));
}

const inventory = YAML.parse(read(
  repositoryRoot, 'bootstrap/root/platform-applicationset.yaml',
)).spec.generators[0].matrix.generators[1].list.elements;

describe('ApplicationSet inventory AppProject permissions', () => {
  let repository;
  let root;
  let projects;
  let platformRepo;
  let destinationServer;

  beforeAll(() => {
    repository = createConfiguredRepository();
    root = repository.root;
    const renderedRoot = render(root, '.');
    const applicationSet = renderedRoot.find(resource => resource.kind === 'ApplicationSet');
    projects = new Map(renderedRoot
      .filter(resource => resource.kind === 'AppProject')
      .map(project => [project.metadata.name, project]));
    platformRepo = applicationSet.spec.generators[0].matrix.generators[0].git.repoURL;
    destinationServer = YAML.parse(read(root, 'catalog-info.yaml'))
      .spec.platform.argocd.destinationServer;
  });

  afterAll(() => repository.cleanup());

  test.each(inventory.map(item => [item.name, item]))(
    '%s has source, destination, and rendered-resource permissions',
    (_name, item) => {
      const project = projects.get(item.project);
      expect(project).toBeDefined();
      expect(project.spec.sourceRepos).toContain(platformRepo);
      expect(permitsDestination(project, destinationServer, item.namespace)).toBe(true);

      if (item.renderer === 'directory') {
        expect(item).toMatchObject({name: 'tenant-admissions', path: 'tenants'});
        return;
      }

      for (const resource of render(root, item.path)) {
        const group = apiGroup(resource);
        const kind = resource.kind;
        if (clusterScopedKinds.has(kind)) {
          expect(permits(project.spec.clusterResourceWhitelist, group, kind)).toBe(true);
          if (kind === 'Namespace') {
            expect(permitsDestination(
              project, destinationServer, resource.metadata.name,
            )).toBe(true);
          }
        } else {
          expect(permits(project.spec.namespaceResourceWhitelist, group, kind)).toBe(true);
          const namespace = resource.metadata?.namespace || item.namespace;
          expect(permitsDestination(project, destinationServer, namespace)).toBe(true);
        }
      }
    },
  );
});
