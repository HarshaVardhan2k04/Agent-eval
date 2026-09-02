// Central model registry + associations. Import { sequelize, ...models } from here.
const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');


// Test STT
const SttBatch = require('./SttBatch')(sequelize, DataTypes);
const SttResult = require('./SttResult')(sequelize, DataTypes);

// Call Analysis
const CallBatch = require('./CallBatch')(sequelize, DataTypes);
const CallAnalysis = require('./CallAnalysis')(sequelize, DataTypes);

// Flow Builder
const Flow = require('./Flow')(sequelize, DataTypes);

// Settings (single-user key/value)
const AppSetting = require('./AppSetting')(sequelize, DataTypes);

// RAG Testing
const RagTest = require('./RagTest')(sequelize, DataTypes);

// Forge (PromptForge optimizer — replaces old Prompt Eval). Consolidated house-style
// schema: run (parent w/ JSONB sub-entities) + versions + global problem catalog + events.
const ForgeRun = require('./ForgeRun')(sequelize, DataTypes);
const ForgeProblem = require('./ForgeProblem')(sequelize, DataTypes);
const ForgeVersion = require('./ForgeVersion')(sequelize, DataTypes);
const ForgeEvent = require('./ForgeEvent')(sequelize, DataTypes);
const ForgeDataset = require('./ForgeDataset')(sequelize, DataTypes);
const ForgeArena = require('./ForgeArena')(sequelize, DataTypes);
const ForgeSim = require('./ForgeSim')(sequelize, DataTypes);
const ForgeLlm = require('./ForgeLlm')(sequelize, DataTypes);

// --- associations ---



SttBatch.hasMany(SttResult, { foreignKey: 'batch_id', onDelete: 'CASCADE' });
SttResult.belongsTo(SttBatch, { foreignKey: 'batch_id' });

CallBatch.hasMany(CallAnalysis, { foreignKey: 'batch_id', onDelete: 'CASCADE' });
CallAnalysis.belongsTo(CallBatch, { foreignKey: 'batch_id' });

// Forge: a run owns its versions and events; everything else is JSONB on the run row.
ForgeRun.hasMany(ForgeVersion, { foreignKey: 'run_id', onDelete: 'CASCADE' });
ForgeVersion.belongsTo(ForgeRun, { foreignKey: 'run_id' });
ForgeRun.hasMany(ForgeEvent, { foreignKey: 'run_id', onDelete: 'CASCADE' });
ForgeEvent.belongsTo(ForgeRun, { foreignKey: 'run_id' });

module.exports = {
  sequelize,
  SttBatch,
  SttResult,
  CallBatch,
  CallAnalysis,
  Flow,
  AppSetting,
  RagTest,
  ForgeRun,
  ForgeProblem,
  ForgeVersion,
  ForgeEvent,
  ForgeDataset,
  ForgeArena,
  ForgeSim,
  ForgeLlm,
};
