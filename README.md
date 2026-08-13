# Contract-First IDP Platform Components

Install the shared OpenShift services that support the Contract-First IDP workshop. This is the
starting repository for workshop installers and platform engineers evaluating or operating the
platform.

## Overview

The repository bootstraps OpenShift GitOps and declares the operators and shared services used by
Developer Hub, the golden paths, tenant workloads, API publication, and managed Resources. A
configured fork is the source of truth for one workshop target; Argo CD reconciles that Git state
onto the cluster.

Installers normally need only this repository. Released `software-templates` and
`developer-charts` dependencies are consumed from the versions recorded in the target contract.

## Getting Started

Start with the [workshop installation guide](docs/installation.md). It contains prerequisites,
GitHub App setup, exact commands, validation, and troubleshooting.

The minimal installation path is:

1. Fork and clone this repository, log in to OpenShift, and run
   `./bootstrap/configure-workshop.sh`.
2. Configure and install the CF-IDP GitHub App, create the standard teams, and populate the
   ignored `bootstrap/secrets.env` file.
3. Commit and push the generated public target configuration.
4. Install OpenShift GitOps, create the cluster credential Secret, and apply the root
   Kustomization.
5. Let Argo CD reconcile the selected platform services.

## Platform Services

The default target includes OpenShift GitOps, Pipelines, Developer Hub, Dev Spaces, Quay, Schema
Registry, identity, External Secrets, and supported Resource operators. See the
[component inventory](docs/component-inventory.md) for delivery methods and pinned versions.

## Architecture

The configured root `catalog-info.yaml` is the public platform-target contract. The root
ApplicationSet combines that contract with the selected inventory, while credentials remain in a
separate cluster Secret. See [Architecture](docs/architecture.md) for the ownership, discovery,
identity, and configuration contracts.

## Documentation

- [Installation](docs/installation.md)
- [Architecture](docs/architecture.md)
- [Component inventory](docs/component-inventory.md)
- [Operations](docs/operations.md)
- [Validation and development](docs/validation.md)
- [Release policy](docs/release-versioning.md)

## Repository Structure

| Path | Purpose |
| --- | --- |
| `bootstrap/` | Configuration helper and OpenShift GitOps bootstrap manifests |
| `bootstrap/root/platform-applicationset.yaml` | Selected operators and shared services |
| `components/` | Kustomize components for platform services |
| `operators/` | Operator installation and configuration |
| `tenants/` | GitOps admission entries for tenant Domains |
| `docs/` | Installation, architecture, operations, inventory, and validation guides |
| `test/` | Deterministic repository and rendered-manifest tests |

After configuration, the main files owned by an installer are the generated `catalog-info.yaml`,
the root `kustomization.yaml`, the ApplicationSet inventory, and the ignored
`bootstrap/secrets.env` credential file.

## Development

Run the deterministic validation suite from the repository root:

```bash
make test
```

The direct equivalent is `npm ci --prefix test` followed by `npm test --prefix test`. Sibling
checkouts are needed only when validating coordinated source changes across all three projects.
