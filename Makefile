SHELL := /usr/bin/env bash
.PHONY: validate render render-full render-minimal

validate:
	python3 scripts/validate.py

render:
	oc kustomize profiles/workshop --load-restrictor=LoadRestrictionsNone

render-full:
	oc kustomize profiles/full --load-restrictor=LoadRestrictionsNone

render-minimal:
	oc kustomize profiles/minimal --load-restrictor=LoadRestrictionsNone
