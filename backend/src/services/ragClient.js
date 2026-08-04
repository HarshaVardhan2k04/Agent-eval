// Generic client for ANY RAG endpoint (the base URL is supplied per request, not
// hardcoded) + the engine (Gemma answer generation + RAG metric suite).
const { engineUrl } = require('../config/app');

// Trim a trailing slash so `${base}/search` is always well-formed.
function clean(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

async function collections(baseUrl) {
  const res = await fetch(`${clean(baseUrl)}/collections`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`RAG API /collections: ${res.status}`);
  return res.json();
}

// params: { query, collection, search_type, top_k, alpha, rerank, distance_threshold }
async function search(baseUrl, params) {
  const res = await fetch(`${clean(baseUrl)}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`RAG API /search: ${res.status} ${t}`);
  }
  return res.json();
}

// Ask Gemma to answer the query using ONLY the retrieved chunks.
async function generateAnswer(query, chunks) {
  const ctx = chunks.map((c) => `- ${c}`).join('\n');
  const prompt = `Answer the question using ONLY the context below. If the context does not contain the answer, say you don't know.\n\nContext:\n${ctx}\n\nQuestion: ${query}\nAnswer:`;
  const res = await fetch(`${engineUrl}/api/llm/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, max_tokens: 400 }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`Engine generate: ${res.status}`);
  const d = await res.json();
  return (d.response || '').trim();
}

// Run the applicable RAG metrics on the engine.
async function ragSuite(body) {
  const res = await fetch(`${engineUrl}/api/metrics/rag-suite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Engine rag-suite: ${res.status} ${t}`);
  }
  return res.json();
}

module.exports = { collections, search, generateAnswer, ragSuite };
