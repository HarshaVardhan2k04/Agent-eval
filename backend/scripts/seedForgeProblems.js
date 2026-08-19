/**
 * Seed the GLOBAL forge_problems catalog from the two sources of truth:
 *   1. the promptforge master catalog (~35-problem list + winning levers)
 *   2. agent-server-dev/prompt_lab/problem_matrix.csv (layer_for_fix + which have detectors)
 *
 * The catalog `id` numbering matches the matrix `btc_problem` numbers, so we join on it.
 * Idempotent: ON CONFLICT (id) DO NOTHING — never clobbers a human-edited row
 * (how_solved, filter_territory, applicability). Run: node scripts/seedForgeProblems.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sequelize } = require('../src/models');

const CATALOG =
  process.env.PROMPTFORGE_CATALOG ||
  path.join(os.homedir(), '.claude/skills/promptforge/references/problem-catalog.csv');
const MATRIX =
  process.env.PROBLEM_MATRIX ||
  '/home/celume/Documents/projects/engage_dev_environment/agent-server-dev/prompt_lab/problem_matrix.csv';

// Minimal quote-aware CSV line splitter (handles "a,b" quoted fields + "" escapes).
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  // Join wrapped lines: a row continues while quotes are unbalanced.
  const rawLines = text.split(/\r?\n/).filter((l) => l.length);
  const rows = [];
  let buf = '';
  for (const line of rawLines) {
    buf = buf ? buf + '\n' + line : line;
    const quotes = (buf.match(/"/g) || []).length;
    if (quotes % 2 === 0) { rows.push(buf); buf = ''; }
  }
  if (buf) rows.push(buf);
  const header = splitCsvLine(rows[0]).map((h) => h.trim());
  return rows.slice(1).map((r) => {
    let cells = splitCsvLine(r);
    // Some source rows have UNQUOTED commas inside the 2nd field (e.g. catalog p10/p14:
    // "Robotic bot-words ('I understand','got it','certainly')"). When that happens the
    // row has more cells than the header — merge the overflow back into column 2 so the
    // trailing columns (category/filter/lever) stay aligned.
    if (cells.length > header.length) {
      const extra = cells.length - header.length;
      cells = [
        cells[0],
        cells.slice(1, 2 + extra).join(','),
        ...cells.slice(2 + extra),
      ];
    }
    const obj = {};
    header.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
    return obj;
  });
}

// From problem_matrix.csv: map btc problem number -> layer_for_fix, and the set that has a detector.
function buildMatrixMaps() {
  const layerByBtc = {};
  const detectorByBtc = new Set();
  if (!fs.existsSync(MATRIX)) {
    console.warn(`[seed] matrix not found at ${MATRIX} — using inline overrides only`);
    return { layerByBtc, detectorByBtc };
  }
  const rows = parseCsv(fs.readFileSync(MATRIX, 'utf8'));
  for (const row of rows) {
    // Behavioural rows carry the BTC number in btc_problem ("3 verbatim-repeat");
    // STRESS_* rows carry it in the behaviour column ("10 bot-words") with
    // btc_problem = "stress-only". Check both.
    const src = /^\s*\d/.test(row.btc_problem || '') ? row.btc_problem : row.behaviour;
    const m = (src || '').match(/^\s*(\d+)/);
    if (!m) continue;
    const id = m[1];
    if (row.layer_for_fix) layerByBtc[id] = row.layer_for_fix.trim();
    // Both behavioural probes and STRESS_* rows are real detectors.
    detectorByBtc.add(id);
  }
  return { layerByBtc, detectorByBtc };
}

// Fallback layer routing for catalog problems the matrix doesn't mention (best-effort; humans can refine).
const LAYER_OVERRIDE = {
  4: 'universal', 5: 'universal', 9: 'universal', 11: 'universal', 15: 'universal',
  17: 'universal', 26: 'vertical', 27: 'campaign', 32: 'universal', 33: 'vertical',
  34: 'universal', 35: 'universal', 36: 'universal', 37: 'universal', 38: 'campaign',
  39: 'universal', 40: 'universal',
};

async function main() {
  if (!fs.existsSync(CATALOG)) {
    console.error(`[seed] catalog not found at ${CATALOG}`);
    process.exit(1);
  }
  const catalog = parseCsv(fs.readFileSync(CATALOG, 'utf8'));
  const { layerByBtc, detectorByBtc } = buildMatrixMaps();

  let inserted = 0;
  for (const p of catalog) {
    const id = `p${p.id}`;
    const layer_for_fix = layerByBtc[p.id] || LAYER_OVERRIDE[p.id] || null;
    const has_detector = detectorByBtc.has(p.id);
    // catalog filter_territory column: 'Y' = genuine filter-territory; 'cracked'/'partial'/'N' = not.
    const filter_territory = (p.filter_territory || '').toLowerCase() === 'y';
    await sequelize.query(
      `INSERT INTO forge_problems
         (id, behaviour, btc_problem, layer_for_fix, category, filter_territory,
          winning_lever, applicability_json, has_detector, source)
       VALUES (:id, :behaviour, :btc, :layer, :category, :filter, :lever, '{}'::jsonb, :det, 'catalog')
       ON CONFLICT (id) DO NOTHING`,
      {
        replacements: {
          id,
          behaviour: p.problem || '',
          btc: `${p.id} ${p.problem || ''}`.slice(0, 200),
          layer: layer_for_fix,
          category: p.category || null,
          filter: filter_territory,
          lever: p.winning_lever || null,
          det: has_detector,
        },
      }
    );
    inserted++;
  }
  const [[{ count }]] = await sequelize.query(`SELECT COUNT(*)::int AS count FROM forge_problems`);
  console.log(`[seed] processed ${inserted} catalog problems; forge_problems now has ${count} rows`);
  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
