SHELL := /usr/bin/env bash
.PHONY: check validate render render-gitops-operator render-gitops-instance

check:
	npm test

validate: check

render:
	oc kustomize bootstrap/root --load-restrictor=LoadRestrictionsNone

render-gitops-operator:
	oc kustomize bootstrap/gitops/operator --load-restrictor=LoadRestrictionsNone

render-gitops-instance:
	oc kustomize bootstrap/gitops/instance --load-restrictor=LoadRestrictionsNone
