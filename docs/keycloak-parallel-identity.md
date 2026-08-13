# Parallel Keycloak architecture

[Back to the repository overview](../README.md)

## Decision

CF-IDP deliberately owns a Keycloak instance for platform identity and client lifecycle. When a
workshop or environment already has a Keycloak identity provider, CF-IDP can run alongside it
instead of taking it over. The environment-owned provider remains outside CF-IDP ownership,
including its operator, operands, realms, and cluster authentication configuration.

The current implementation installs the community Keycloak Operator from the `fast` channel,
starting from 26.7.1. Its OperatorGroup, operator, Keycloak instance, realm imports, and
`KeycloakOIDCClient` resources are confined to `cf-idp-keycloak`.

## Platform capability

Declarative `KeycloakOIDCClient` resources are a significant platform capability. They make OIDC
client lifecycle GitOps-managed and composable with the rest of a Domain's declarative platform
state. CF-IDP can create a client from reviewed Git state instead of requiring a user to create it
manually in an identity-provider console.

The current Domain onboarding path combines that API with External Secrets Operator (ESO). Domain
manifests declare password generation, canonical client Secrets, controlled projection into
`cf-idp-keycloak`, and `KeycloakOIDCClient` resources that consume those Secrets. This provides
declarative client creation together with secret generation and distribution; users do not
manually manufacture or copy client credentials.

Today this supports the tenant publisher clients used by Apicurio and Microcks. A future
opportunity is to apply the same composable pattern to richer tenant and System onboarding. That is
an architectural direction, not an implemented workflow or lifecycle guarantee in this release.

## Why a parallel instance

A separate namespace-scoped instance gives CF-IDP a clear ownership boundary. The platform can
rely on declarative client APIs and ESO integration without changing or assuming control of an
environment-owned identity provider. It also lets CF-IDP evolve its platform realm and client
contract through its own GitOps lifecycle while leaving unrelated environment identities alone.

Namespace scope does not make coexistence automatic. Another Keycloak Operator must not
effectively watch `cf-idp-keycloak`, and all installed operators must be compatible with the shared,
cluster-scoped Keycloak CRDs. CF-IDP guarantees the scope of its own OperatorGroup; operators are
responsible for verifying other effective watch scopes and shared CRD compatibility. See
[Installation](installation.md) for optional inspection commands and
[Operations](operations.md#keycloak-operator-and-clients) for ongoing checks.
