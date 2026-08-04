SHELL := /usr/bin/env bash
.PHONY: test test-install test-clean check validate render render-gitops-operator render-gitops-instance

test: test-install
	npm test --prefix test

test-install:
	npm ci --prefix test --loglevel=error

test-clean:
	rm -rf test/node_modules

check: test

validate: test

render:
	oc kustomize bootstrap/root --load-restrictor=LoadRestrictionsNone

render-gitops-operator:
	oc kustomize bootstrap/gitops/operator --load-restrictor=LoadRestrictionsNone

render-gitops-instance:
	oc kustomize bootstrap/gitops/instance --load-restrictor=LoadRestrictionsNone
