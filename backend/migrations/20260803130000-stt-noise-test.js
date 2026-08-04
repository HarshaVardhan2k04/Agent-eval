'use strict';

// Noise test: mix a preset/custom noise into a clean recording, transcribe the
// noisy audio, score WER/CER vs the reference. Each row records which noise and
// at what intensity (source_type='noise'; the "Clean" baseline row has neither).
module.exports = {
  async up(queryInterface) {
    const sql = queryInterface.sequelize;
    await sql.query(`ALTER TABLE stt_results ADD COLUMN IF NOT EXISTS noise_label TEXT`);
    await sql.query(`ALTER TABLE stt_results ADD COLUMN IF NOT EXISTS noise_level TEXT`);
  },

  async down(queryInterface) {
    const sql = queryInterface.sequelize;
    await sql.query(`ALTER TABLE stt_results DROP COLUMN IF EXISTS noise_label`);
    await sql.query(`ALTER TABLE stt_results DROP COLUMN IF EXISTS noise_level`);
  },
};
