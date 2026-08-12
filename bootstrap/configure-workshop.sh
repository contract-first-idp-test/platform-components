#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'configure-workshop: %s\n' "$*" >&2
  exit 1
}

[[ $# -eq 0 ]] || die 'usage: ./bootstrap/configure-workshop.sh'

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
template=$root/bootstrap/catalog-info.template.yaml
kustomization=$root/bootstrap/root/kustomization.yaml
[[ -s $template && -s $kustomization ]] || die 'bootstrap templates are missing'

remote=$(git -C "$root" remote get-url origin) || die 'could not read Git remote origin'
revision=$(git -C "$root" branch --show-current) || die 'could not read the current branch'
cluster_api_url=$(oc whoami --show-server) || die 'log into the target cluster with oc'
cluster_name=$(oc get infrastructure cluster \
  -o jsonpath='{.status.infrastructureName}') || die 'could not discover the infrastructure name'
router_domain=$(oc get ingress.config.openshift.io cluster \
  -o jsonpath='{.spec.domain}') || die 'could not discover the router domain'
bash "$root/bootstrap/preflight.sh" || die 'Keycloak Operator scope preflight failed'

case $remote in
  https://*) repository_coordinate=${remote#https://} ;;
  git@*:*) repository_coordinate=${remote#git@}; repository_coordinate=${repository_coordinate/:/\/} ;;
  ssh://git@*) repository_coordinate=${remote#ssh://git@} ;;
  *) die 'origin must use a common GitHub HTTPS or SSH form' ;;
esac
repository_coordinate=${repository_coordinate%.git}
scm_host=${repository_coordinate%%/*}
repository_path=${repository_coordinate#*/}
organization=${repository_path%%/*}
repository=${repository_path#*/}
part='[A-Za-z0-9][A-Za-z0-9._-]*'
[[ $scm_host =~ ^[A-Za-z0-9.-]+$ && $organization =~ ^${part}$ &&
  $repository =~ ^${part}$ && $repository_path != */*/* ]] ||
  die 'origin must identify one GitHub organization and repository'
repository_url=https://$scm_host/$organization/$repository.git

cluster_api_url=${cluster_api_url%/}
router_domain=${router_domain%.}
[[ -n $revision && $revision =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ &&
  $revision != *..* && $revision != *//* ]] || die 'current branch is empty or invalid'
[[ $cluster_api_url =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die 'cluster API URL is invalid'
[[ $cluster_name =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die 'cluster name is invalid'
label='[a-z0-9]([a-z0-9-]*[a-z0-9])?'
[[ $router_domain =~ ^${label}(\.${label})+$ ]] || die 'router domain is invalid'

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
rendered=$temporary/catalog-info.yaml
cp "$template" "$rendered"

replace() {
  local token=$1 value=$2 escaped next=$temporary/catalog-info.next
  escaped=$(printf '%s' "$value" | sed 's/[&|\\]/\\&/g')
  sed "s|@@${token}@@|${escaped}|g" "$rendered" > "$next"
  mv "$next" "$rendered"
}

replace PLATFORM_REPO_URL "$repository_url"
replace PLATFORM_REVISION "$revision"
replace SCM_HOST "$scm_host"
replace SCM_ORGANIZATION "$organization"
replace SCM_REPOSITORY "$repository"
replace CLUSTER_API_URL "$cluster_api_url"
replace CLUSTER_NAME "$cluster_name"
replace ROUTER_DOMAIN "$router_domain"
grep -q '@@' "$rendered" && die 'catalog template contains an unreplaced token'
mv "$rendered" "$root/catalog-info.yaml"

escaped_url=$(printf '%s' "$repository_url" | sed 's/[&|\\]/\\&/g')
escaped_revision=$(printf '%s' "$revision" | sed 's/[&|\\]/\\&/g')
sed -e "s|^      - PLATFORM_REPO_URL=.*|      - PLATFORM_REPO_URL=$escaped_url|" \
  -e "s|^      - PLATFORM_REVISION=.*|      - PLATFORM_REVISION=$escaped_revision|" \
  "$kustomization" > "$temporary/kustomization.yaml"
mv "$temporary/kustomization.yaml" "$kustomization"

printf 'Configured catalog-info.yaml for %s on %s.\n' "$repository_url" "$cluster_name"
