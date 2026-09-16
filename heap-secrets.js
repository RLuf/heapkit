#!/usr/bin/env node
/*
 * heap-secrets.js — scan a V8 .heapsnapshot for secrets left in memory.
 *
 * Security-research use: after auth flows, browser heaps frequently retain
 * JWTs, bearer tokens, API keys, session ids and even plaintext passwords in
 * live strings — sometimes long after the UI "logged out". This finds them.
 *
 *   node --max-old-space-size=8192 heap-secrets.js <file.heapsnapshot> [--full]
 *
 * Values are MASKED by default (first6…last3 + length). Pass --full to print
 * raw matches (do this only on your own snapshot, never share the output).
 *
 * MIT.
 */
'use strict';
const fs = require('fs');
const file = process.argv[2];
const FULL = process.argv.includes('--full');
if (!file) { console.error('usage: node heap-secrets.js <file.heapsnapshot> [--full]'); process.exit(1); }

const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
const meta = snap.snapshot.meta;
const NF = meta.node_fields.length;
const iType = meta.node_fields.indexOf('type');
const iName = meta.node_fields.indexOf('name');
const nodes = snap.nodes, S = snap.strings, N = nodes.length / NF;
const strTypes = new Set(['string', 'concatenated string', 'sliced string']);

const mask = s => s.length <= 10 ? '*'.repeat(s.length) : `${s.slice(0,6)}…${s.slice(-3)} (len ${s.length})`;

// Detectors: name → (test, why)
const RULES = [
  ['JWT',            s => /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/.test(s)],
  ['Google API key', s => /\bAIza[0-9A-Za-z_-]{35}\b/.test(s)],
  ['Bearer token',   s => /\bBearer\s+[A-Za-z0-9._-]{20,}/.test(s)],
  ['AWS access key', s => /\bAKIA[0-9A-Z]{16}\b/.test(s)],
  ['Slack token',    s => /\bxox[baprs]-[0-9A-Za-z-]{10,}/.test(s)],
  ['GitHub token',   s => /\bgh[pousr]_[A-Za-z0-9]{36}\b/.test(s)],
  ['Stripe key',     s => /\b[sr]k_(live|test)_[0-9A-Za-z]{16,}/.test(s)],
  ['Private key',    s => /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(s)],
  ['OAuth code',     s => /\b(code|access_token|refresh_token|id_token)=[A-Za-z0-9._-]{16,}/.test(s)],
  ['Password field', s => /"?pass(word|wd)?"?\s*[:=]\s*["'][^"']{4,}["']/i.test(s)],
  ['Session cookie', s => /\b(SID|SSID|HSID|__Secure-\w+|sessionid|session_id)=[A-Za-z0-9._%-]{10,}/.test(s)],
];

const hits = new Map(); // rule → Map(masked → count)
let scanned = 0;
for (let i = 0; i < N; i++) {
  if (!strTypes.has(meta.node_types[0][nodes[i*NF + iType]])) continue;
  const s = S[nodes[i*NF + iName]];
  if (!s || s.length < 12 || s.length > 8192) continue;
  scanned++;
  for (const [name, test] of RULES) {
    if (test(s)) {
      const key = FULL ? s.slice(0, 200) : mask(s);
      const m = hits.get(name) || new Map();
      m.set(key, (m.get(key) || 0) + 1);
      hits.set(name, m);
    }
  }
}

console.log(`scanned ${scanned.toLocaleString()} strings in ${file}`);
if (!hits.size) { console.log('\nNo secrets matched. ✅'); process.exit(0); }
console.log(FULL ? '\n⚠  RAW values (do not share):' : '\n⚠  Potential secrets in heap (masked):');
for (const [name, m] of hits) {
  console.log(`\n[${name}]  ${[...m.values()].reduce((a,b)=>a+b,0)} occurrence(s)`);
  for (const [v, c] of [...m].sort((a,b)=>b[1]-a[1]).slice(0, 15))
    console.log(`   x${c}  ${v}`);
}
console.log('\nTip: run heapkit.js retain "<class>" to see who keeps a secret-bearing object alive.');
