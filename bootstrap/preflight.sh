#!/usr/bin/env bash
set -euo pipefail

target=cf-idp-keycloak
conflicts=''

while read -r namespace name targets copied_from owned_apis; do
  case "$owned_apis" in
    *keycloaks.k8s.keycloak.org*) ;;
    *) continue ;;
  esac
  [[ $copied_from == '<none>' ]] || continue
  [[ $namespace == "$target" ]] && continue
  case ",$targets," in
    *",$target,"*|',<none>,')
      conflicts+="${namespace}/${name} (effective targets: ${targets})"$'\n'
      ;;
  esac
done < <(oc get clusterserviceversions.operators.coreos.com -A --no-headers \
  -o 'custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,TARGETS:.metadata.annotations.olm\.targetNamespaces,COPIED_FROM:.metadata.labels.olm\.copiedFrom,OWNED_APIS:.spec.customresourcedefinitions.owned[*].name')

if [[ -n $conflicts ]]; then
  printf 'Keycloak Operator scope preflight failed: another Keycloak Operator has an effective watch scope that includes namespace %s:\n%s' \
    "$target" "$conflicts" >&2
  printf 'Move CF-IDP to a disjoint namespace or narrow the existing operator scope before continuing.\n' >&2
  exit 1
fi

printf 'Keycloak Operator scope preflight passed for namespace %s.\n' "$target"
