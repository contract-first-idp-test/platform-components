#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'configure-workshop: %s\n' "$*" >&2
  exit 1
}

required() {
  local name=$1
  [[ -n ${!name:-} ]] || die "$name is required"
}

repository_coordinate() {
  local remote=$1 coordinate
  case $remote in
    https://*) coordinate=${remote#https://} ;;
    git@*:*) coordinate=${remote#git@}; coordinate=${coordinate/:/\/} ;;
    ssh://git@*) coordinate=${remote#ssh://git@} ;;
    *) die "unsupported Git repository URL: $remote" ;;
  esac
  printf '%s\n' "${coordinate%.git}"
}

[[ $# -eq 0 ]] || die 'usage: ./bootstrap/configure-workshop.sh'

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
catalog_template=$root/bootstrap/catalog-info.template.yaml
distribution_template=$root/bootstrap/platform-distribution.template.yaml
configuration_kustomization=$root/bootstrap/configuration.kustomization.template.yaml
bootstrap_kustomization=$root/bootstrap/kustomization.yaml
for source in "$catalog_template" "$distribution_template" \
  "$configuration_kustomization" "$bootstrap_kustomization"; do
  [[ -s $source ]] || die "bootstrap template is missing: $source"
done

required DEVELOPER_CHARTS_REPOSITORY_URL
required DEVELOPER_CHARTS_REVISION
required DEVELOPER_CHARTS_VERSION
required SOFTWARE_TEMPLATES_REPOSITORY_URL
required SOFTWARE_TEMPLATES_REVISION
required SOFTWARE_TEMPLATES_VERSION

remote=$(git -C "$root" remote get-url origin) || die 'could not read Git remote origin'
configuration_revision=$(git -C "$root" branch --show-current) ||
  die 'could not read the mutable configuration branch'
[[ -n $configuration_revision ]] ||
  die 'detached HEAD is not a configuration branch; create or switch to a branch first'

configuration_coordinate=$(repository_coordinate "$remote")
scm_host=${configuration_coordinate%%/*}
repository_path=${configuration_coordinate#*/}
organization=${repository_path%%/*}
repository=${repository_path#*/}
part='[A-Za-z0-9][A-Za-z0-9._-]*'
[[ $scm_host =~ ^[A-Za-z0-9.-]+$ && $organization =~ ^${part}$ &&
  $repository =~ ^${part}$ && $repository_path != */*/* ]] ||
  die 'origin must identify one GitHub organization and repository'
repository_url=https://$scm_host/$organization/$repository.git

software_coordinate=$(repository_coordinate "$SOFTWARE_TEMPLATES_REPOSITORY_URL")
software_host=${software_coordinate%%/*}
software_path=${software_coordinate#*/}
software_organization=${software_path%%/*}
software_repository=${software_path#*/}
[[ $software_host =~ ^[A-Za-z0-9.-]+$ && $software_organization =~ ^${part}$ &&
  $software_repository =~ ^${part}$ && $software_path != */*/* ]] ||
  die 'SOFTWARE_TEMPLATES_REPOSITORY_URL must identify one organization and repository'

platform_version=$(sed -n 's/^version:[[:space:]]*//p' "$root/release.yaml")
platform_distribution_repository_url=${PLATFORM_DISTRIBUTION_REPOSITORY_URL:-$repository_url}
platform_distribution_revision=${PLATFORM_DISTRIBUTION_REVISION:-v$platform_version}
tag='^v[0-9]+\.[0-9]+\.[0-9]+$'
version='^[0-9]+\.[0-9]+\.[0-9]+$'
[[ $platform_version =~ $version ]] || die 'release.yaml version is invalid'
[[ $platform_distribution_revision =~ $tag &&
  $platform_distribution_revision == v$platform_version ]] ||
  die 'platform distribution revision must be the exact tag matching release.yaml'
[[ $DEVELOPER_CHARTS_VERSION =~ $version && $DEVELOPER_CHARTS_REVISION =~ $tag &&
  $DEVELOPER_CHARTS_REVISION == v$DEVELOPER_CHARTS_VERSION ]] ||
  die 'developer-charts revision must be the exact tag matching its version'
[[ $SOFTWARE_TEMPLATES_VERSION =~ $version && $SOFTWARE_TEMPLATES_REVISION =~ $tag &&
  $SOFTWARE_TEMPLATES_REVISION == v$SOFTWARE_TEMPLATES_VERSION ]] ||
  die 'software-templates revision must be the exact tag matching its version'
[[ ! $configuration_revision =~ $tag ]] ||
  die 'configuration and tenant admission must use a mutable branch, not a release tag'
[[ $configuration_revision =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ &&
  $configuration_revision != *..* && $configuration_revision != *//* ]] ||
  die 'configuration branch is invalid'

cluster_api_url=$(oc whoami --show-server) || die 'log into the target cluster with oc'
cluster_name=$(oc get infrastructure cluster \
  -o jsonpath='{.status.infrastructureName}') || die 'could not discover the infrastructure name'
router_domain=$(oc get ingress.config.openshift.io cluster \
  -o jsonpath='{.spec.domain}') || die 'could not discover the router domain'
bash "$root/bootstrap/preflight.sh" || die 'Keycloak Operator scope preflight failed'
cluster_api_url=${cluster_api_url%/}
router_domain=${router_domain%.}
[[ $cluster_api_url =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die 'cluster API URL is invalid'
[[ $cluster_name =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die 'cluster name is invalid'
label='[a-z0-9]([a-z0-9-]*[a-z0-9])?'
[[ $router_domain =~ ^${label}(\.${label})+$ ]] || die 'router domain is invalid'

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
rendered=$temporary/catalog-info.yaml
cp "$catalog_template" "$rendered"

replace() {
  local token=$1 value=$2 escaped next=$temporary/next
  escaped=$(printf '%s' "$value" | sed 's/[&|\\]/\\&/g')
  sed "s|@@${token}@@|${escaped}|g" "$rendered" > "$next"
  mv "$next" "$rendered"
}

replace PLATFORM_REPO_URL "$repository_url"
replace PLATFORM_CONFIGURATION_REVISION "$configuration_revision"
replace PLATFORM_DISTRIBUTION_REPO_URL "$platform_distribution_repository_url"
replace PLATFORM_DISTRIBUTION_REVISION "$platform_distribution_revision"
replace PLATFORM_VERSION "$platform_version"
replace SCM_HOST "$scm_host"
replace SCM_ORGANIZATION "$organization"
replace SCM_REPOSITORY "$repository"
replace SOFTWARE_TEMPLATES_HOST "$software_host"
replace SOFTWARE_TEMPLATES_ORGANIZATION "$software_organization"
replace SOFTWARE_TEMPLATES_REPOSITORY "$software_repository"
replace SOFTWARE_TEMPLATES_REPO_URL "$SOFTWARE_TEMPLATES_REPOSITORY_URL"
replace SOFTWARE_TEMPLATES_REVISION "$SOFTWARE_TEMPLATES_REVISION"
replace SOFTWARE_TEMPLATES_VERSION "$SOFTWARE_TEMPLATES_VERSION"
replace DEVELOPER_CHARTS_REPO_URL "$DEVELOPER_CHARTS_REPOSITORY_URL"
replace DEVELOPER_CHARTS_REVISION "$DEVELOPER_CHARTS_REVISION"
replace DEVELOPER_CHARTS_VERSION "$DEVELOPER_CHARTS_VERSION"
replace CLUSTER_API_URL "$cluster_api_url"
replace CLUSTER_NAME "$cluster_name"
replace ROUTER_DOMAIN "$router_domain"
grep -q '@@' "$rendered" && die 'catalog template contains an unreplaced token'

mkdir -p "$root/configuration"
mv "$rendered" "$root/configuration/catalog-info.yaml"
cp "$configuration_kustomization" "$root/configuration/kustomization.yaml"
rendered=$temporary/platform-distribution.yaml
cp "$distribution_template" "$rendered"
replace PLATFORM_REPO_URL "$repository_url"
replace PLATFORM_CONFIGURATION_REVISION "$configuration_revision"
replace PLATFORM_DISTRIBUTION_REPO_URL "$platform_distribution_repository_url"
replace PLATFORM_DISTRIBUTION_REVISION "$platform_distribution_revision"
grep -q '@@' "$rendered" && die 'distribution template contains an unreplaced token'
mv "$rendered" "$root/configuration/platform-distribution.yaml"

escaped_url=$(printf '%s' "$repository_url" | sed 's/[&|\\]/\\&/g')
escaped_revision=$(printf '%s' "$configuration_revision" | sed 's/[&|\\]/\\&/g')
sed -e "s|^      - PLATFORM_CONFIGURATION_REPO_URL=.*|      - PLATFORM_CONFIGURATION_REPO_URL=$escaped_url|" \
  -e "s|^      - PLATFORM_CONFIGURATION_REVISION=.*|      - PLATFORM_CONFIGURATION_REVISION=$escaped_revision|" \
  "$bootstrap_kustomization" > "$temporary/bootstrap-kustomization.yaml"
mv "$temporary/bootstrap-kustomization.yaml" "$bootstrap_kustomization"

printf 'Configured %s at %s; platform distribution remains %s at %s.\n' \
  "$repository_url" "$configuration_revision" \
  "$platform_distribution_repository_url" "$platform_distribution_revision"
