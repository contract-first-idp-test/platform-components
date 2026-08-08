# Workshop installation

Set up a workshop-ready Contract-First IDP on OpenShift with a small bootstrap and a declarative
GitOps handoff. You will configure this repository for one cluster, add the external credentials,
and start OpenShift GitOps. The public workshop configuration lives in the root
`catalog-info.yaml`; private values stay in an ignored local file and a cluster Secret.

The happy path is: clone, configure the target, configure GitHub, commit, bootstrap GitOps, and
start the platform.

## Before you begin

You need:

- cluster-admin access to an OpenShift cluster;
- a GitHub organization for the workshop and permission to install a GitHub App there;
- a fork of `platform-components` in an organization or account you can push to;
- `git` and `oc` on your workstation.

## Install

1. Clone the platform repository.

   ```bash
   git clone git@github.com:YOUR_ORGANIZATION/platform-components.git
   cd platform-components
   git switch main
   ```

2. Configure the workshop target.

   Log in as a cluster administrator, then run the supported configuration helper from the
   repository root.

   ```bash
   oc login https://api.YOUR_WORKSHOP_CLUSTER:6443
   ./bootstrap/configure-workshop.sh
   ```

   The helper generates `catalog-info.yaml` and updates the bootstrap repository coordinates.
   `catalog-info.yaml` is the source of truth for this workshop target. It contains the cluster
   identity, GitHub organization and repository, router-derived service URLs, Dev Spaces URL and
   GitHub callback, and the other public platform configuration. Open it for a quick review; later
   steps refer to values in this descriptor instead of reconstructing them from the cluster.

3. Configure GitHub and credentials.

   Configure the CF-IDP GitHub App with the values in your generated `catalog-info.yaml`; follow
   [Configure the CF-IDP GitHub App](#configure-the-cf-idp-github-app), then install the App into the
   workshop organization. Confirm that `domain-maintainers`, `domain-contributors`, and
   `domain-viewers` exist before using the golden paths.

   Create the ignored credential file and populate the GitHub App values, workshop user values,
   and the other required external credentials.

   ```bash
   cp bootstrap/secrets.env.example bootstrap/secrets.env
   ${EDITOR:-vi} bootstrap/secrets.env
   ```

   Keep `bootstrap/secrets.env` local; it must not be committed.

4. Commit the workshop configuration.

   Optional: if the default component inventory is not appropriate for this cluster, make the
   changes described in [Customize the platform inventory](#customize-the-platform-inventory)
   before committing.

   ```bash
   git add catalog-info.yaml bootstrap/root/kustomization.yaml \
     bootstrap/root/platform-applicationset.yaml
   git commit -m "configure workshop platform"
   git push
   ```

5. Bootstrap OpenShift GitOps.

   Install the operator, wait until its Argo CD instance is available, and apply the workshop
   instance configuration.

   ```bash
   oc apply -k bootstrap/gitops/operator
   until oc get argocd/openshift-gitops -n openshift-gitops >/dev/null 2>&1; do sleep 5; done
   oc wait --for=condition=Available deployment/openshift-gitops-server \
     -n openshift-gitops --timeout=10m
   oc apply -k bootstrap/gitops/instance
   ```

6. Start the platform.

   Create the private bootstrap Secret from the ignored credential file, then apply the root
   GitOps state.

   ```bash
   oc apply -f components/external-secrets/namespace.yaml
   oc create secret generic platform-secrets \
     -n cf-idp-secrets \
     --from-env-file=bootstrap/secrets.env \
     --dry-run=client -o yaml | oc apply -f -

   oc kustomize bootstrap/root \
     --load-restrictor=LoadRestrictionsNone |
   oc apply -f -
   ```

   From this point forward, Argo CD owns platform convergence.

   Optionally, confirm that the selected platform Applications have appeared:

   ```bash
   oc get applications.argoproj.io -n openshift-gitops
   ```

## What's next?

Open Developer Hub using `spec.platform.services.developerHub.url` from `catalog-info.yaml`. Sign in
through Keycloak with `DEMO_USER_USERNAME` and `DEMO_USER_PASSWORD` from your local
`bootstrap/secrets.env`, then explore the available Software Templates.

For a deeper installation check, see [Validation](../docs/validation.md#installation-validation).
For ongoing changes and credential rotation, see [Operations](../docs/operations.md).

## Configure the CF-IDP GitHub App

Create one CF-IDP GitHub App, or reuse an existing App with the settings below. Read all
cluster-specific URLs from the generated `catalog-info.yaml`.

1. In the App-owning GitHub account or organization, open **Settings → Developer settings → GitHub
   Apps → New GitHub App**.
2. Configure the App:

   | GitHub field | Workshop value |
   | --- | --- |
   | GitHub App name | A globally unique name such as `CF-IDP Workshop` |
   | Homepage URL | `spec.platform.services.devSpaces.url` from `catalog-info.yaml` |
   | Callback URL | `spec.platform.services.devSpaces.githubCallbackUrl` from `catalog-info.yaml` |
   | Webhook | Clear **Active** |
   | Where can this GitHub App be installed? | **Any account** |

3. Under **Permissions & events**, request only these permissions:

   | Scope | Permission |
   | --- | --- |
   | Repository: Administration | Read and write |
   | Repository: Contents | Read and write |
   | Repository: Pull requests | Read and write |
   | Repository: Webhooks | Read and write |
   | Repository: Metadata | Read-only |
   | Organization: Members | Read-only |

   These permissions support repository creation and updates, pull requests, branch protection,
   team assignment, catalog discovery, and repository webhooks. CF-IDP does not require GitHub
   Issues, Actions Secrets, Environments, Variables, or Workflows permission.

4. Select **Create GitHub App**. Record the **App ID** and **Client ID**.
5. Generate a client secret under **Client secrets** and record it when GitHub displays it.
6. Generate and download a private key under **Private keys**. On Linux, encode the PEM as one
   uninterrupted line:

   ```bash
   base64 -w 0 ~/Downloads/cf-idp-workshop.private-key.pem
   ```

   Paste that single-line output after `GITHUB_APP_PRIVATE_KEY_BASE64=`; do not paste or manually
   escape the multiline PEM.

7. Select **Install App** and install it into the workshop organization. For the workshop, grant
   **All repositories** so new golden-path repositories remain available to automation and catalog
   discovery.
8. Map the recorded values into `bootstrap/secrets.env`:

   | GitHub value | Workshop key | Consumer |
   | --- | --- | --- |
   | App ID | `GITHUB_APP_ID` | Developer Hub |
   | Client ID | `GITHUB_APP_CLIENT_ID` | Developer Hub and Dev Spaces |
   | Client secret | `GITHUB_APP_CLIENT_SECRET` | Developer Hub and Dev Spaces |
   | Base64-encoded private-key PEM | `GITHUB_APP_PRIVATE_KEY_BASE64` | Developer Hub |

CF-IDP uses one GitHub App for Developer Hub platform automation and Dev Spaces developer Git
authorization. Developer Hub login remains Keycloak-based.
Do not create a separate GitHub OAuth App for Dev Spaces. See
[Architecture](../docs/architecture.md) for the token and catalog-discovery details.

## Onboard another GitHub organization

An additional participating organization reuses the existing CF-IDP GitHub App:

1. Install the App into that organization; do not create another App.
2. Create or maintain `domain-maintainers`, `domain-contributors`, and `domain-viewers`.
3. Grant the App installation access to the repositories the platform should discover or manage.

The golden paths grant these teams `maintain`, `push`, and `pull` access respectively; they do not
create the teams. If the App installation is limited to selected repositories, an organization
administrator must also add each new golden-path repository. Domains in one organization share
these team populations; use another organization when a Domain needs independent SCM populations,
and install the same App there.

## Customize the platform inventory

The default workshop works without inventory changes. The committed
`bootstrap/root/platform-applicationset.yaml` is the operator and shared-service inventory for this
target. Before the first installation, you may remove entries that are unsuitable for the cluster;
review the dependency comments beside those entries and the [component inventory](../docs/component-inventory.md).

Adding an ordinary Kustomize-based component requires its reusable base and a compact inventory
entry; it does not require a change to `configure-workshop.sh`. Removing an entry after installation
is not an uninstall procedure. See [Operations](../docs/operations.md) before removing deployed
components.

## Troubleshooting and further validation

The install flow intentionally stops after the GitOps handoff and one optional Application query.
Use [Validation](../docs/validation.md) for deeper Developer Hub, Dev Spaces, External Secrets, and
ApplicationSet checks. Use [Operations](../docs/operations.md) for credential rotation,
reconciliation changes, and component lifecycle guidance.
