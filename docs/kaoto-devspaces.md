# Kaoto Camel Designer in Dev Spaces

Kaoto is delivered as the **Kaoto Camel Designer VS Code extension**, not as an OpenShift Operator or custom resource.

This repository configures Dev Spaces to use `https://open-vsx.org`. The companion software templates complete the integration by placing this recommendation in every Camel workspace:

```json
{
  "recommendations": ["redhat.vscode-kaoto"]
}
```

When a workspace starts, Dev Spaces resolves the recommendation through Open VSX and installs the extension into the hosted IDE. The platform preflight verifies that the cluster can reach the Open VSX API.

`ENABLE_KAOTO_DEVSPACES=true` documents and validates this dependency. It requires `ENABLE_DEVSPACES=true`; it does not create a Kaoto Application.
