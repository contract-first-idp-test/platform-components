'use strict';

const semver = require('semver');

const dependencies = [
  ['platform-components', 'platformComponents'],
  ['developer-charts', 'developerCharts'],
];

function validateCompatibility(input) {
  const releaseVersion = semver.valid(input.releaseVersion);
  if (!releaseVersion) {
    throw new Error(`software-templates release version is not valid SemVer: ${input.releaseVersion}`);
  }

  for (const [displayName, key] of dependencies) {
    const range = semver.validRange(input.requires[key]);
    if (!range) {
      throw new Error(`software-templates ${input.releaseVersion} has an invalid ${displayName} range: ${input.requires[key]}`);
    }
    const selected = semver.valid(input.selected[key]);
    if (!selected) {
      throw new Error(`PlatformTarget ${displayName} version is not valid SemVer: ${input.selected[key]}`);
    }
    if (!semver.satisfies(selected, range)) {
      throw new Error(
        `software-templates ${input.releaseVersion} requires ${displayName} ${input.requires[key]}; ` +
        `the selected PlatformTarget provides ${displayName} ${input.selected[key]}`,
      );
    }
  }

  return {compatible: true};
}

module.exports = {validateCompatibility};
