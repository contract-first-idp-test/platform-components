# Workshop installation

The repository has one supported workshop-oriented inventory. Membership in
`root/platform-applicationset.yaml` means that Argo CD creates and reconciles that Application.
There are no profiles or generated target render directories.

Every repository managed by the Contract-First IDP golden paths stores its primary entity
descriptor at `/catalog-info.yaml`. The configured GitHub catalog provider discovers that path
across the workshop organization. Golden paths also immediately register their generated root
descriptor for prompt task feedback and repositories outside the provider's organization scope.
No duplicate explicit platform-target URL location is configured.

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

3. Generate the public target and configure the two bootstrap repository coordinates.

   ```bash
   ./bootstrap/configure-workshop.sh \
     group:default/backstage-admins
   ```

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

9. Configure that Argo CD instance and give the active user administrator access.

   ```bash
   oc apply -k bootstrap/gitops/instance
   oc adm groups add-users gitops-admins "$(oc whoami)"
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
