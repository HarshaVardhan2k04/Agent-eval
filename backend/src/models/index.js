// Central model registry + associations. Import { sequelize, ...models } from here.
const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

// Prompt Eval (existing tables)
const Eval = require('./Eval')(sequelize, DataTypes);
const PromptVersion = require('./PromptVersion')(sequelize, DataTypes);
const ScenarioResult = require('./ScenarioResult')(sequelize, DataTypes);
const EvalEvent = require('./EvalEvent')(sequelize, DataTypes);

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

// --- associations ---
Eval.hasMany(PromptVersion, { foreignKey: 'eval_id', onDelete: 'CASCADE' });
PromptVersion.belongsTo(Eval, { foreignKey: 'eval_id' });

Eval.hasMany(ScenarioResult, { foreignKey: 'eval_id', onDelete: 'CASCADE' });
ScenarioResult.belongsTo(Eval, { foreignKey: 'eval_id' });

Eval.hasMany(EvalEvent, { foreignKey: 'eval_id', onDelete: 'CASCADE' });
EvalEvent.belongsTo(Eval, { foreignKey: 'eval_id' });

SttBatch.hasMany(SttResult, { foreignKey: 'batch_id', onDelete: 'CASCADE' });
SttResult.belongsTo(SttBatch, { foreignKey: 'batch_id' });

CallBatch.hasMany(CallAnalysis, { foreignKey: 'batch_id', onDelete: 'CASCADE' });
CallAnalysis.belongsTo(CallBatch, { foreignKey: 'batch_id' });

module.exports = {
  sequelize,
  Eval,
  PromptVersion,
  ScenarioResult,
  EvalEvent,
  SttBatch,
  SttResult,
  CallBatch,
  CallAnalysis,
  Flow,
  AppSetting,
  RagTest,
};
