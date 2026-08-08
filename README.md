# Contract-First IDP Platform Components

Set up a workshop-ready Internal Developer Platform on OpenShift with one GitOps repository.

This is the place to start if you are installing Contract-First IDP. Fork this repository, choose
the platform components you want, provide the workshop credentials, and let OpenShift GitOps
reconcile the installation.

## Start here

- **Installing the workshop:** follow the [workshop installation](bootstrap/README.md).
- **Reviewing the platform:** see the [component inventory](docs/component-inventory.md) and
  [architecture](docs/architecture.md).
- **Running the platform:** use the [operations guide](docs/operations.md).
- **Contributing a change:** start with [validation](docs/validation.md).

Installers normally need only this repository. The released `software-templates` and
`developer-charts` dependencies are consumed for you; sibling checkouts are needed only by
contributors testing coordinated source changes.

## The installation in six steps

The [complete workshop guide](bootstrap/README.md) includes prerequisites, review points, and
verification commands. The happy path is:

1. Fork and clone this repository.
2. Log in to OpenShift as a cluster administrator.
3. Run `bootstrap/configure-workshop.sh` to generate the public platform target.
4. Create the CF-IDP GitHub App used by Developer Hub and Dev Spaces, add the derived Dev Spaces
   callback, and install it into the workshop organization.
5. Review and commit the selected platform Applications.
6. Create the local credentials Secret and apply the root bootstrap Kustomization.

The repository keeps configuration intentionally small and visible:

| File | What you manage |
| --- | --- |
| [`catalog-info.yaml`](catalog-info.yaml) | The generated public platform-target contract used by Backstage and the golden paths |
| [`bootstrap/root/platform-applicationset.yaml`](bootstrap/root/platform-applicationset.yaml) | The operators and shared services selected for this target |
| `bootstrap/secrets.env` | Ignored local credentials used to create the platform Secret |

There are no hidden profiles or generated target directories. The committed ApplicationSet is the
inventory that Argo CD creates and keeps reconciled.

## What this repository provides

The default workshop inventory includes the platform services behind the developer experience:
OpenShift GitOps, Pipelines, Developer Hub, Dev Spaces, Quay, Schema Registry, identity, secrets,
and supported Resource operators. See the [component inventory](docs/component-inventory.md) for
the exact channels and versions.

Once installed:

- Developer Hub discovers repository-root `catalog-info.yaml` descriptors;
- golden paths create reviewable repositories and pull requests instead of writing to the cluster;
- Argo CD combines tenant intent with released charts and reconciles OpenShift resources;
- platform credentials remain in the cluster, outside public catalog contracts.

The workshop identity contract uses realm `platform`, with `platform-maintainers` owning platform
capabilities and `domain-maintainers` owning tenant entities. Developer Hub and Dev Spaces are
currently configured against one CF-IDP GitHub App: Developer Hub uses installation credentials for
machine automation, while Dev Spaces uses its client credentials to authorize each GitHub user.
Developer Hub human sign-in stays on Keycloak. The
[workshop installation](bootstrap/README.md#create-the-cf-idp-github-app) is the authoritative App
creation and credential-mapping procedure.

The released implementation paths are `domain/environment`, `system/environment`, `api/openapi`,
`component/openjdk`, and `resource/postgresql` under `developer-charts/charts`. Every repository
created by a golden path keeps its primary Backstage entity at `/catalog-info.yaml`, making
discovery and ownership predictable.

## Contributing

The deterministic test suite requires Node.js and npm, but workshop installation does not:

```bash
make test
```

The direct equivalent is:

```bash
npm ci --prefix test
npm test --prefix test
```

All test tooling lives under `test/`; this repository itself is not an npm package. `make check`
is an alias for `make test`.

## More documentation

- [Workshop installation](bootstrap/README.md)
- [Architecture](docs/architecture.md)
- [Component inventory](docs/component-inventory.md)
- [Operations](docs/operations.md)
- [Workshop target contract](docs/workshop-target.md)
