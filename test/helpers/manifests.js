const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function exists(root, relative) {
  return fs.existsSync(path.join(root, relative));
}

function parseDocuments(source) {
  return YAML.parseAllDocuments(source).map(document => {
    if (document.errors.length) {
      throw new Error(document.errors.map(error => error.message).join('\n'));
    }
    return document.toJSON();
  }).filter(Boolean);
}

function render(root, relative) {
  return parseDocuments(execFileSync('oc', ['kustomize', relative], {
    cwd: root,
    encoding: 'utf8',
  }));
}

module.exports = {read, exists, parseDocuments, render};
