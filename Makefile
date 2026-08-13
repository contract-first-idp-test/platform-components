SHELL := /usr/bin/env bash
.PHONY: test release-check test-install test-clean check validate render render-gitops-operator render-gitops-instance

test: test-install
	npm test --prefix test

release-check: test
	npm run --prefix test test:release
	node test/validate-release.js
	oc kustomize . >/dev/null

test-install:
	npm ci --prefix test --loglevel=error

test-clean:
	rm -rf test/node_modules

check: test

validate: test

render:
	oc kustomize .

render-gitops-operator:
	oc kustomize bootstrap/gitops/operator

render-gitops-instance:
	oc kustomize bootstrap/gitops/instance
