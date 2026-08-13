'use strict';

const {createBackendModule} = require('@backstage/backend-plugin-api');
const {
  createTemplateAction,
  scaffolderActionsExtensionPoint,
} = require('@backstage/plugin-scaffolder-node');
const {validateCompatibility} = require('./compatibility.cjs');

const action = createTemplateAction({
  id: 'contract-first-idp:validate-compatibility',
  description: 'Validate selected CF-IDP versions with the standard node-semver implementation.',
  supportsDryRun: true,
  schema: {
    input: {
      releaseVersion: z => z.string(),
      requires: z => z.object({
        platformComponents: z.string(),
        developerCharts: z.string(),
      }),
      selected: z => z.object({
        platformComponents: z.string(),
        developerCharts: z.string(),
      }),
    },
    output: {
      compatible: z => z.boolean(),
    },
  },
  async handler(ctx) {
    const result = validateCompatibility(ctx.input);
    ctx.output('compatible', result.compatible);
  },
});

const moduleDefinition = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'contract-first-idp-compatibility',
  register({registerInit}) {
    registerInit({
      deps: {scaffolder: scaffolderActionsExtensionPoint},
      async init({scaffolder}) {
        scaffolder.addActions(action);
      },
    });
  },
});

module.exports.default = moduleDefinition;
