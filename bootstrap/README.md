# Workshop installation

The repository has one supported workshop-oriented inventory. Membership in
`root/platform-applicationset.yaml` means that Argo CD creates and reconciles that Application.
There are no profiles or generated target render directories.

Every repository managed by the Contract-First IDP golden paths stores its primary entity
descriptor at `/catalog-info.yaml`. The configured GitHub catalog provider discovers that path
across every repository visible through installations of the CF-IDP GitHub App. Golden paths also
immediately register their generated root descriptor for prompt task feedback. No duplicate
explicit platform-target URL location is configured.

## Identity and GitHub prerequisites

The workshop Keycloak realm is `platform`. It provisions the human groups
`platform-maintainers`, `domain-maintainers`, `domain-contributors`, and `domain-viewers`, plus the
Microcks `microcks/manager` subgroup. The only human demo user is configured by
`DEMO_USER_USERNAME` and `DEMO_USER_PASSWORD` (the example username is `platform-user`); it belongs
to `platform-maintainers`, `domain-maintainers`, and `microcks/manager`. The existing
`service-account-backstage` and `service-account-microcks-serviceaccount` machine identities remain
separate.

`platform-maintainers` owns platform capabilities, templates, and configuration.
`domain-maintainers` owns Domain and tenant workload entities.

The workshop currently configures one CF-IDP GitHub App for Developer Hub and OpenShift Dev Spaces.
Developer Hub uses its App ID and private key to obtain installation tokens for catalog discovery
and machine automation. Dev Spaces uses the App's client ID and client secret to authorize each
developer; Git operations run as that user and remain limited by the user's GitHub permissions and
the repositories available to the App installation. Developer Hub human sign-in remains Keycloak.

Do not create a separate GitHub OAuth App for Dev Spaces. Dev Spaces never receives the App private
key, and Developer Hub does not need a GitHub login callback.

## Software Templates catalog

The public platform target declares the released Software Templates repository, revision, and root
catalog path under `spec.platform.dependencies.softwareTemplates`. Developer Hub derives one
revision-aware catalog URL from that declaration and explicitly loads the Software Templates root
`Location`. 

Adopters therefore do not need to fork `software-templates` into their own organization.

To change the Software Templates release, update its dependency coordinates in
`bootstrap/catalog-info.template.yaml` and the committed platform target. The workshop helper does
not construct catalog URLs or inspect dependency repositories.

## User-managed configuration

`catalog-info.yaml`
: Generated and committed public platform-target contract used by Backstage, the golden paths, and
  the platform ApplicationSet.

`bootstrap/root/platform-applicationset.yaml`
: Committed operational component and operator selection. Remove an entry before installation to
  prevent its Application from being created.

`bootstrap/secrets.env`
: Local ignored credential values used only to create `platform-secrets`.

Removing an inventory entry after installation is not a supported uninstall procedure. The
ApplicationSet uses create/update-only lifecycle behavior and preserves deployed resources. Plan a
component-specific uninstall separately, and review dependencies called out beside the inventory
entries before changing the default list.

Adding an ordinary Kustomize-based component requires only its reusable base and one compact list
entry. It never requires a change to `configure-workshop.sh`.

## Install

1. Fork this repository, clone your fork, and check out the branch Argo CD should watch.

   ```bash
   git clone git@github.com:YOUR_ORGANIZATION/platform-components.git
   cd platform-components
   git switch main
   ```

2. Log into the target OpenShift cluster as a cluster administrator.

   ```bash
   oc login https://api.YOUR_WORKSHOP_CLUSTER:6443
   ```

3. Generate the public target and configure the two bootstrap repository coordinates, then display
   the Dev Spaces URL and callback derived from the discovered router domain.

   ```bash
   ./bootstrap/configure-workshop.sh
   ROUTER_DOMAIN="$(oc get ingress.config.openshift.io cluster -o jsonpath='{.spec.domain}')"
   printf 'Dev Spaces URL: https://devspaces.%s\n' "$ROUTER_DOMAIN"
   printf 'GitHub callback: https://devspaces.%s/api/oauth/callback\n' "$ROUTER_DOMAIN"
   ```

   The current `CheCluster` does not set a custom hostname. OpenShift Dev Spaces 3.28 therefore
   produces `https://devspaces.<router-domain>`, so the callback is known before installation. The
   post-install `CheCluster.status.cheURL` check below remains authoritative.

## Create the CF-IDP GitHub App

Create this one App after determining the router domain and before populating any workshop secrets.
If an existing CF-IDP GitHub App already has the settings below, reuse it and install it into the
workshop organization.

1. In the App-owning GitHub account or organization, open **Settings → Developer settings → GitHub
   Apps → New GitHub App**.
2. Configure the App fields:

   | GitHub field | Workshop value |
   | --- | --- |
   | GitHub App name | A globally unique name such as `CF-IDP Workshop` |
   | Homepage URL | `https://devspaces.<router-domain>/` using the value displayed above |
   | Callback URL | `https://devspaces.<router-domain>/api/oauth/callback` |
   | Webhook | Clear **Active**; the App does not receive GitHub event deliveries |
   | Where can this GitHub App be installed? | **Any account**, so participating organizations can install this existing App |

   The callback is for the Dev Spaces user authorization flow only. The repository webhooks created
   by golden paths target Argo CD and are separate from the disabled GitHub App webhook receiver.

3. Under **Permissions & events**, request only these permissions:

   | Scope | Permission |
   | --- | --- |
   | Repository: Administration | Read and write |
   | Repository: Contents | Read and write |
   | Repository: Pull requests | Read and write |
   | Repository: Webhooks | Read and write |
   | Repository: Metadata | Read-only |
   | Organization: Members | Read-only |

   These cover repository creation, contents and pull requests, branch protection, existing-team
   assignment, repository webhooks, catalog discovery, and Dev Spaces Git operations. No GitHub
   Issues, Actions Secrets, Environments, Variables, or Workflows permission is used by CF-IDP.

4. Select **Create GitHub App**. On the App settings page, record the **App ID** and **Client ID**.
5. Under **Client secrets**, generate a client secret and record it when GitHub displays it.
6. Under **Private keys**, generate and download a private key. On Linux, encode the downloaded PEM
   as one uninterrupted line:

   ```bash
   base64 -w 0 ~/Downloads/cf-idp-workshop.private-key.pem
   ```

   Paste that output directly after `GITHUB_APP_PRIVATE_KEY_BASE64=`; do not paste or manually escape
   the multiline PEM.
7. On the App page, select **Install App** and install it into the workshop GitHub organization. For
   the workshop, grant **All repositories** so catalog discovery and newly created golden-path
   repositories stay in scope.

Map the GitHub values into `bootstrap/secrets.env` exactly as follows:

| GitHub value | Workshop key | Consumer |
| --- | --- | --- |
| App ID | `GITHUB_APP_ID` | Developer Hub |
| Client ID | `GITHUB_APP_CLIENT_ID` | Developer Hub and Dev Spaces |
| Client secret | `GITHUB_APP_CLIENT_SECRET` | Developer Hub and Dev Spaces |
| Base64-encoded private-key PEM | `GITHUB_APP_PRIVATE_KEY_BASE64` | Developer Hub only, decoded by External Secrets |

## Onboard a participating GitHub organization

App creation is a one-time platform activity. For every organization that will host CF-IDP Domains:

1. Install the existing CF-IDP GitHub App into that organization; do not create an App per Domain or
   organization.
2. Create `domain-maintainers`, `domain-contributors`, and `domain-viewers` teams if they do not
   already exist.
3. Grant the installation access to every repository the platform must discover or manage. If the
   organization restricts the installation to selected repositories, its administrators must also
   add each newly created golden-path repository.

The golden paths grant the fixed teams `maintain`, `push`, and `pull` access respectively; they do
not create teams. Domains in one organization intentionally share these populations. Use a separate
GitHub organization when a Domain needs independent SCM populations, but install the same App.

## Continue the installation

4. Review the generated root `catalog-info.yaml`.

5. Review `bootstrap/root/platform-applicationset.yaml`. Remove Applications that are not suitable
   for this infrastructure target, considering the dependency comments in the inventory.

6. Commit and push the public configuration.

   ```bash
   git add catalog-info.yaml bootstrap/root/kustomization.yaml \
     bootstrap/root/platform-applicationset.yaml
   git commit -m "configure workshop platform"
   git push
   ```

7. Create and populate the ignored local credential file.

   ```bash
   cp bootstrap/secrets.env.example bootstrap/secrets.env
   ${EDITOR:-vi} bootstrap/secrets.env
   ```

8. Install OpenShift GitOps and wait for its existing `openshift-gitops` Argo CD instance.

   ```bash
   oc apply -k bootstrap/gitops/operator
   until oc get argocd/openshift-gitops -n openshift-gitops >/dev/null 2>&1; do sleep 5; done
   oc wait --for=condition=Available deployment/openshift-gitops-server \
     -n openshift-gitops --timeout=10m
   ```

9. Configure that Argo CD instance. The committed `gitops-admins` Group already includes the
   workshop `admin` user.

   ```bash
   oc apply -k bootstrap/gitops/instance
   ```

10. Create the private bootstrap Secret from the ignored local file.

    ```bash
    oc apply -f components/external-secrets/namespace.yaml
    oc create secret generic platform-secrets \
      -n cf-idp-secrets \
      --from-env-file=bootstrap/secrets.env \
      --dry-run=client -o yaml | oc apply -f -
    ```

11. Apply the one root Kustomization.

    ```bash
    oc kustomize bootstrap/root \
      --load-restrictor=LoadRestrictionsNone |
    oc apply -f -
    ```

12. Watch the ApplicationSet create the selected Applications and follow convergence.

    ```bash
    oc get applicationsets.argoproj.io -n openshift-gitops
    oc get applications.argoproj.io -n openshift-gitops -w
    oc get externalsecrets.external-secrets.io -A
    ```

ApplicationSet expansion requires the live OpenShift GitOps controller. Local validation renders
the bootstrap resources and verifies the inventory/template contract, but does not reimplement the
controller.

## Verify the Developer Hub and Dev Spaces GitHub App integrations

Verify Developer Hub receives all four App-derived values without printing them:

```bash
oc get externalsecret rhdh-secrets -n developer-hub
oc get secret rhdh-secrets -n developer-hub \
  -o go-template='{{range $key, $_ := .data}}{{$key}}{{"\n"}}{{end}}'
oc rollout status deployment/backstage-backstage -n developer-hub --timeout=10m
```

Sign in to Developer Hub through Keycloak. Confirm a GitHub-backed catalog entity is discovered, or
run one golden path and verify that its repository and pull request are created. There is no GitHub
option on the Developer Hub sign-in page.

Verify the supported Dev Spaces secret shape and retrieve the authoritative installed URL:

```bash
oc get externalsecret github-oauth-config -n openshift-devspaces
oc get secret github-oauth-config -n openshift-devspaces
oc get checluster devspaces \
  -n openshift-devspaces \
  -o jsonpath='{.status.cheURL}{"\n"}'
```

The reported URL must be the origin used in the App callback plus `/api/oauth/callback`. Open a Dev
Spaces workspace for a GitHub repository, authorize the CF-IDP GitHub App when prompted, and confirm
clone, pull, and push work without configuring a personal access token or a second OAuth App.

Domain and System repositories notify both the Argo CD server and ApplicationSet controller on
push. The endpoint hostnames are generated from the workshop router domain; normal Git polling
remains the recovery path.
