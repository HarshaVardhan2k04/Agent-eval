// READ-ONLY access to the production `prompts` table (layered mode's "import universal /
// import vertical" pickers). agent_db_dev lives in the SAME Postgres server as agent_eval,
// so credentials are derived from the existing DATABASE_URL — only the database name
// changes (Postgres cannot cross-database query on one connection, so this is a second
// small lazy pool, max 2). Every connection is forced read-only; we never write back.
//
// Override the database name with AGENT_DB_NAME (default: agent_db_dev — the one holding
// the real prompts rows).
const { Sequelize, QueryTypes } = require('sequelize');

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:admin@localhost:6666/agent_eval';
const AGENT_DB_NAME = process.env.AGENT_DB_NAME || 'agent_db_dev';

function isConfigured() {
  try {
    new URL(DATABASE_URL);
    return true;
  } catch (_e) {
    return false;
  }
}

let _seq = null;
function getSequelize() {
  if (_seq) return _seq;
  const u = new URL(DATABASE_URL); // same server/user/pass, different database
  u.pathname = `/${AGENT_DB_NAME}`;
  _seq = new Sequelize(u.toString(), {
    dialect: 'postgres',
    logging: false,
    pool: { max: 2, min: 0, idle: 10000, acquire: 20000 },
    define: { timestamps: false, underscored: true },
    hooks: {
      // Belt-and-braces: an import can never mutate the prompts library.
      afterConnect: async (conn) => {
        await conn.query('SET SESSION default_transaction_read_only = on');
      },
    },
  });
  return _seq;
}

const ALLOWED_TYPES = new Set(['universal', 'vertical', 'campaign', 'addon']);

// List prompt rows of a type (id + friendly_name) for the picker — no prompt body,
// to keep the list light; use getById for the full JSON.
async function listByType(type) {
  if (!ALLOWED_TYPES.has(type)) throw new Error(`invalid prompt_type '${type}'`);
  const seq = getSequelize();
  return seq.query(
    `SELECT id, prompt_type, friendly_name FROM prompts WHERE prompt_type = :type ORDER BY friendly_name`,
    { replacements: { type }, type: QueryTypes.SELECT }
  );
}

// Full layer row by id (prompt JSON + override_keys) — snapshotted into the run at start.
async function getById(id) {
  const seq = getSequelize();
  const rows = await seq.query(
    `SELECT id, prompt_type, prompt, override_keys, friendly_name FROM prompts WHERE id = :id LIMIT 1`,
    { replacements: { id }, type: QueryTypes.SELECT }
  );
  return rows[0] || null;
}

module.exports = { isConfigured, listByType, getById, AGENT_DB_NAME };
