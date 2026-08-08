# Kaoto Camel Designer in Dev Spaces

Kaoto is delivered as the **Kaoto Camel Designer VS Code extension**, not as an OpenShift Operator or custom resource.

This repository configures Dev Spaces to use `https://open-vsx.org`. The companion software templates complete the integration by placing this recommendation in every Camel workspace:

```json
{
  "recommendations": ["redhat.vscode-kaoto"]
}
```

When a workspace starts, Dev Spaces resolves the recommendation through Open VSX and installs the extension into the hosted IDE. The platform preflight verifies that the cluster can reach the Open VSX API.

Dev Spaces and Developer Hub are currently configured against one CF-IDP GitHub App. Dev Spaces
receives only its client ID and client secret; it never receives the App private key or uses
Developer Hub's machine installation token. See the
[workshop GitHub App setup](../bootstrap/README.md#configure-the-cf-idp-github-app) and
[verification flow](validation.md#github-app-integrations).

Kaoto follows the selected Dev Spaces Application; it does not create a separate platform Application.
