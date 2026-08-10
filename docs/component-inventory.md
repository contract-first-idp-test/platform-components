# Component Inventory

[Back to the repository overview](../README.md)

| Capability | Delivery | Pinned channel/version for the workshop target |
|---|---|---|
| OpenShift GitOps | Red Hat Operator | `gitops-1.21` / 1.21.1 |
| External Secrets | Red Hat Operator | `stable-v1` / 1.2.0 |
| cert-manager | Red Hat Operator, install/adopt | `stable-v1` |
| RHBK | Red Hat Operator, install/adopt | `stable-v26.4` |
| PostgreSQL | Certified Crunchy Operator | `v5` / 5.8.8 |
| Developer Hub | Red Hat Operator | `fast` / 1.10.2 at discovery time |
| Dev Spaces | Red Hat Operator | `stable` / 3.29.1 at discovery time |
| Pipelines | Red Hat Operator | `pipelines-1.23` / 1.23.1 |
| Apicurio Registry | Red Hat Operator | `3.2.x` / 3.2.6-r2 |
| Quay | Red Hat Operator | `stable-3.18` / 3.18.0 |
| Quay Bridge | Red Hat Operator | `stable-3.18` / 3.18.0 |
| Microcks | Kustomize manifests | 1.14.0 |
| Hawtio | Red Hat Operator | `v2` / 2.0.0 catalog build |
| Apicurito | Community Operator, optional | `1.0.x` / 1.0.3 |
| Kaoto Camel Designer | Dev Spaces extension | `redhat.vscode-kaoto` from Open VSX |

## Kaoto in Dev Spaces

Kaoto is delivered as the Kaoto Camel Designer VS Code extension, not as an Operator or custom
resource. This repository configures Dev Spaces to use `https://open-vsx.org`; the software
templates recommend `redhat.vscode-kaoto` in each generated Camel workspace. Dev Spaces installs
the extension when the workspace starts. Kaoto follows the selected Dev Spaces Application and
does not create a separate platform Application.

Dev Spaces uses the CF-IDP GitHub App client credentials for per-user GitHub authorization. It
does not receive the App private key used by Developer Hub automation. See
[Installation](installation.md#configure-the-cf-idp-github-app) and
[Validation](validation.md#github-app-integrations).
