# Initial coordinated baseline

`v1.0.0` is the first intentional coordinated release of `platform-components`,
`software-templates`, and `developer-charts`. There is no earlier public platform release history
or compatibility migration contract.

For installations built from an earlier draft of this baseline:

- rename `PLATFORM_REPO_REVISION` to `PLATFORM_CONFIG_REVISION` and set it to a mutable branch;
- replace the combined `platform-bootstrap` Secret with credential-only `platform-secrets`;
- remove derived endpoint keys such as `ROUTER_DOMAIN`, `DEVELOPER_HUB_*`, `KEYCLOAK_*_URL`,
  `QUAY_HOST`, `QUAY_URL`, `APICURIO_API_URL`, `MICROCKS_*`, `HAWTIO_HOST`, and `GITEA_*` from
  `config/platform.env`; runtime values now belong to the target YAML;
- retain only the documented direct keys `APICURIO_APP_HOST`, `APICURIO_UI_HOST`, and
  `QUAY_INTEGRATION_URL`;
- remove the Microcks OLM subscription and let the normal service Application install chart 1.14.0.

The service boundaries now use product names consistently:

- `components/registry`, Application `registry`, and namespace `registry` become
  `components/quay`, Application `quay`, and namespace `quay`;
- `components/schemas`, Application `schemas`, and namespace `schemas` become
  `components/apicurio`, Application `apicurio`, and namespace `apicurio`;
- the Quay CR is `QuayRegistry/registry`, so its operator-managed Route changes to
  `registry-quay-quay.<router-domain>`; Apicurio's explicitly configured ingress hosts do not
  change with its namespace.

These are new namespaces, not in-place renames. Before allowing Argo CD to prune the old
Applications, back up and migrate any Quay object storage/database state and Apicurio PostgreSQL
state that must survive. Pruning the old Applications can delete their namespaces and persistent
volume claims.

Software Templates and Developer Charts remain pinned at `v1.0.0`. Platform configuration and
tenant admission track the configured branch.
