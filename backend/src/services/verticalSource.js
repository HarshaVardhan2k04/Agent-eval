// Production call-import sources ("verticals"). Each vertical is a separate
// production Postgres (read-only) + a GCS bucket holding call recordings. We
// connect lazily, only ever run SELECTs against the shared `calls` schema
// (id/transcript/gcs_path/gcs_bucket), and stream recordings out of GCS.
//
// Credentials live ONLY in the gitignored backend/.env under VERTICAL_<KEY>_*.
// Nothing is hardcoded here; a vertical with no env config reports unconfigured
// and is disabled in the UI.
const { Sequelize, QueryTypes } = require('sequelize');
const { Storage } = require('@google-cloud/storage');

// key -> display label. Maps to the production repos:
//   sales       -> call_nova_platform_backend_sales
//   automobile  -> automobile_backend
//   consultancy -> visa-backend (prod; NOT consultancy_dev)
const VERTICALS = [
  { key: 'sales', label: 'Sales' },
  { key: 'automobile', label: 'Automobile' },
  { key: 'consultancy', label: 'Consultancy' },
];

const MAX_IDS = 500; // cap per import request — a guard, not a product limit

function envFor(key) {
  const P = `VERTICAL_${key.toUpperCase()}_`;
  const e = process.env;
  const db = {
    host: e[`${P}DB_HOST`],
    port: e[`${P}DB_PORT`] ? Number(e[`${P}DB_PORT`]) : 5432,
    database: e[`${P}DB_NAME`],
    username: e[`${P}DB_USER`],
    password: e[`${P}DB_PASSWORD`],
  };
  const gcs = {
    projectId: e[`${P}GCP_PROJECT_ID`],
    keyFilename: e[`${P}GCP_CREDENTIALS`],
    bucket: e[`${P}GCS_BUCKET`],
  };
  const dbConfigured = !!(db.host && db.database && db.username);
  const gcsConfigured = !!(gcs.projectId && gcs.keyFilename && gcs.bucket);
  return { db, gcs, dbConfigured, gcsConfigured };
}

// --- lazy singletons per vertical -----------------------------------------
const _seq = new Map();
const _buckets = new Map();

function getSequelize(key) {
  if (_seq.has(key)) return _seq.get(key);
  const { db, dbConfigured } = envFor(key);
  if (!dbConfigured) throw new Error(`vertical '${key}' has no database config`);
  const sequelize = new Sequelize(db.database, db.username, db.password, {
    host: db.host,
    port: db.port,
    dialect: 'postgres',
    logging: false,
    pool: { max: 3, min: 0, idle: 10000, acquire: 20000 },
    // Belt-and-braces: force every connection read-only so an import can never
    // mutate a production DB even if a query were changed by mistake.
    hooks: {
      afterConnect: async (conn) => {
        await conn.query('SET SESSION default_transaction_read_only = on');
      },
    },
  });
  _seq.set(key, sequelize);
  return sequelize;
}

function getBucket(key, bucketName) {
  const { gcs, gcsConfigured } = envFor(key);
  if (!gcsConfigured) throw new Error(`vertical '${key}' has no GCS config`);
  const name = bucketName || gcs.bucket;
  const cacheKey = `${key}:${name}`;
  if (_buckets.has(cacheKey)) return _buckets.get(cacheKey);
  if (!getBucket._storage) getBucket._storage = new Map();
  let storage = getBucket._storage.get(key);
  if (!storage) {
    storage = new Storage({ projectId: gcs.projectId, keyFilename: gcs.keyFilename });
    getBucket._storage.set(key, storage);
  }
  const bucket = storage.bucket(name);
  _buckets.set(cacheKey, bucket);
  return bucket;
}

// --- public API ------------------------------------------------------------

// List verticals with config flags so the UI can enable/disable them.
//   configured    = fully usable (DB + GCS)  — needed for STT import (re-transcribes audio)
//   dbConfigured  = transcript fetch works    — enough for Analyze Calls import
//   gcsConfigured = recording download/playback works
function listVerticals() {
  return VERTICALS.map((v) => {
    const { dbConfigured, gcsConfigured } = envFor(v.key);
    return {
      key: v.key, label: v.label,
      configured: dbConfigured && gcsConfigured,
      dbConfigured, gcsConfigured,
    };
  });
}

function isVertical(key) {
  return VERTICALS.some((v) => v.key === key);
}

// True when a vertical's Postgres creds are present (transcript fetch works even
// without GCS — Analyze Calls only needs the transcript to score).
function dbConfigured(key) {
  return !!envFor(key).dbConfigured;
}

// Fetch call rows by id from a vertical's `calls` table (SELECT only).
// Returns rows in the SAME ORDER as the requested ids (missing ids omitted).
async function fetchCalls(key, callIds) {
  if (!isVertical(key)) throw new Error(`unknown vertical '${key}'`);
  const ids = [...new Set((callIds || []).map((s) => String(s).trim()).filter(Boolean))];
  if (!ids.length) return [];
  if (ids.length > MAX_IDS) throw new Error(`too many call ids (${ids.length} > ${MAX_IDS})`);

  const sequelize = getSequelize(key);
  const rows = await sequelize.query(
    `SELECT id, transcript, gcs_path, gcs_bucket, direction, duration, start_time, agent_id
       FROM calls
      WHERE id IN (:ids)`,
    { replacements: { ids }, type: QueryTypes.SELECT },
  );

  // Preserve the user's paste order; index by id.
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  return ids.map((id) => byId.get(id) || { id, _missing: true });
}

// Download a recording's bytes from GCS. Uses the row's gcs_bucket when present,
// else the vertical's configured default bucket.
async function downloadRecording(key, gcsPath, gcsBucket) {
  if (!gcsPath) throw new Error('call has no gcs_path');
  const bucket = getBucket(key, gcsBucket);
  const [buf] = await bucket.file(gcsPath).download();
  return buf;
}

// A short-lived signed URL for playback in the detail view.
async function signedUrl(key, gcsPath, gcsBucket, ttlMs = 15 * 60 * 1000) {
  if (!gcsPath) return null;
  const bucket = getBucket(key, gcsBucket);
  const [url] = await bucket.file(gcsPath).getSignedUrl({
    version: 'v4', action: 'read', expires: Date.now() + ttlMs,
  });
  return url;
}

module.exports = {
  listVerticals, isVertical, dbConfigured, fetchCalls, downloadRecording, signedUrl, MAX_IDS,
};
