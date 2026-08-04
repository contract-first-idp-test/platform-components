const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const root = path.resolve(__dirname, '..');
const clusterScopedKinds = new Set([
  'Namespace', 'ClusterRole', 'ClusterRoleBinding',
  'ClusterSecretStore', 'ExternalSecretsConfig',
]);

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function documents(source) {
  return YAML.parseAllDocuments(source).map(document => {
    if (document.errors.length) {
      throw new Error(document.errors.map(error => error.message).join('\n'));
    }
    return document.toJSON();
  }).filter(Boolean);
}

function render(relative) {
  return documents(execFileSync('oc', [
    'kustomize', relative, '--load-restrictor=LoadRestrictionsNone',
  ], {cwd: root, encoding: 'utf8'}));
}

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

describe('ApplicationSet inventory AppProject contracts', () => {
  const renderedRoot = render('bootstrap/root');
  const applicationSet = renderedRoot.find(resource => resource.kind === 'ApplicationSet');
  const projects = new Map(renderedRoot
    .filter(resource => resource.kind === 'AppProject')
    .map(project => [project.metadata.name, project]));
  const inventory = applicationSet.spec.generators[0].matrix.generators[1].list.elements;
  const platformRepo = applicationSet.spec.generators[0].matrix.generators[0].git.repoURL;
  const destinationServer = YAML.parse(read('catalog-info.yaml')).spec.platform.argocd.destinationServer;

  test.each(inventory.map(item => [item.name, item]))(
    '%s has source, destination, and resource permissions for its rendered output',
    (_name, item) => {
      const project = projects.get(item.project);
      expect(project).toBeDefined();
      expect(project.spec.sourceRepos).toContain(platformRepo);
      expect(permitsDestination(project, destinationServer, item.namespace)).toBe(true);

      if (item.renderer === 'microcks') {
        expect(project.spec.sourceRepos).toContain('https://microcks.io/helm');
      }

      if (item.renderer === 'directory') {
        expect(item).toMatchObject({name: 'tenant-admissions', path: 'tenants'});
        return;
      }

      for (const resource of render(item.path)) {
        const group = apiGroup(resource);
        const kind = resource.kind;
        if (clusterScopedKinds.has(kind)) {
          expect({item: item.name, group, kind, permitted: permits(
            project.spec.clusterResourceWhitelist, group, kind,
          )}).toEqual({item: item.name, group, kind, permitted: true});
          if (kind === 'Namespace') {
            expect({item: item.name, namespace: resource.metadata.name, permitted: permitsDestination(
              project, destinationServer, resource.metadata.name,
            )}).toEqual({item: item.name, namespace: resource.metadata.name, permitted: true});
          }
        } else {
          expect({item: item.name, group, kind, permitted: permits(
            project.spec.namespaceResourceWhitelist, group, kind,
          )}).toEqual({item: item.name, group, kind, permitted: true});
          const namespace = resource.metadata?.namespace || item.namespace;
          expect({item: item.name, namespace, permitted: permitsDestination(
            project, destinationServer, namespace,
          )}).toEqual({item: item.name, namespace, permitted: true});
        }
      }
    },
  );

  test('known narrow permissions remain explicit', () => {
    expect(permits(
      projects.get('platform-infrastructure').spec.clusterResourceWhitelist, '', 'Namespace',
    )).toBe(true);
    expect(permitsDestination(
      projects.get('platform-services'), destinationServer, 'openshift-pipelines-resolvers',
    )).toBe(true);
  });
});
