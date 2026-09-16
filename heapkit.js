#!/usr/bin/env node
/*
 * HeapKit — offline analyzer for V8 .heapsnapshot files (Chrome / Node).
 * Finds what leaks and why, on snapshots too big for the DevTools UI.
 *
 * Usage:
 *   node --max-old-space-size=8192 heapkit.js <file.heapsnapshot> [command] [pattern]
 *
 * Commands:
 *   summary            top constructors by count and retained self-size (default)
 *   find <regex>       objects/closures whose type|name match the regex
 *   retain <id|name>   retainer path to a GC root for a node id (#123) or exact name
 *   detached           detached DOM nodes + un-removed listeners (browser snapshots)
 *   buffers            largest ArrayBuffers and who retains them
 *
 * MIT licensed. (c) HeapKit.
 */
'use strict';
const fs = require('fs');

const file = process.argv[2];
const cmd = process.argv[3] || 'summary';
const arg = process.argv[4] || '';
if (!file) { console.error('usage: node heapkit.js <file.heapsnapshot> [summary|find <re>|retain <id|name>|detached|buffers]'); process.exit(1); }

console.error(`[heapkit] reading ${file} ...`);
const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
const meta = snap.snapshot.meta;
const NF = meta.node_fields.length, EF = meta.edge_fields.length;
const NT = meta.node_types[0], ET = meta.edge_types[0];
const iType = meta.node_fields.indexOf('type'), iName = meta.node_fields.indexOf('name');
const iSelf = meta.node_fields.indexOf('self_size'), iEdge = meta.node_fields.indexOf('edge_count');
const iId = meta.node_fields.indexOf('id');
const iDet = meta.node_fields.indexOf('detachedness');
const eType = meta.edge_fields.indexOf('type'), eName = meta.edge_fields.indexOf('name_or_index'), eTo = meta.edge_fields.indexOf('to_node');
const nodes = snap.nodes, edges = snap.edges, S = snap.strings, N = nodes.length / NF;
console.error(`[heapkit] ${N.toLocaleString()} nodes, ${(edges.length / EF).toLocaleString()} edges`);

const first = new Uint32Array(N + 1);
for (let i = 0, e = 0; i < N; i++) { first[i] = e; e += nodes[i * NF + iEdge] * EF; first[N] = e; }
const name = i => S[nodes[i * NF + iName]];
const type = i => NT[nodes[i * NF + iType]];
const size = i => nodes[i * NF + iSelf];
const id = i => nodes[i * NF + iId];
const det = i => iDet >= 0 ? nodes[i * NF + iDet] : 0;
const label = i => `#${id(i)} ${type(i)} "${String(name(i)).slice(0, 90)}" (${size(i)}B)${det(i) === 2 ? ' [DETACHED]' : ''}`;
function* out(i) { for (let e = first[i]; e < first[i + 1]; e += EF) { const t = ET[edges[e + eType]]; const n = (t === 'element' || t === 'hidden') ? edges[e + eName] : S[edges[e + eName]]; yield { t, n, to: edges[e + eTo] / NF, e }; } }
const edgeLabel = e => { const t = ET[edges[e + eType]]; const n = (t === 'element' || t === 'hidden') ? edges[e + eName] : S[edges[e + eName]]; return `${t}[${n}]`; };

function buildRetainers() {
  const rc = new Uint32Array(N + 1);
  for (let i = 0; i < N; i++) for (const { to } of out(i)) rc[to + 1]++;
  for (let i = 0; i < N; i++) rc[i + 1] += rc[i];
  const rf = new Uint32Array(rc[N]), re = new Uint32Array(rc[N]), fill = new Uint32Array(N);
  for (let i = 0; i < N; i++) for (let e = first[i]; e < first[i + 1]; e += EF) { const to = edges[e + eTo] / NF; const p = rc[to] + fill[to]++; rf[p] = i; re[p] = e; }
  return { rc, rf, re };
}
function pathToRoot(i, R) {
  const prev = new Map([[i, null]]); const q = [i];
  while (q.length) { const x = q.shift();
    if (type(x) === 'synthetic') { const p = []; let c = x; while (c !== null) { p.push(c); c = prev.get(c)?.node ?? null; } return p.map((n, k) => (k ? '  <- ' + edgeLabel(prev.get(p[k - 1]).e) + ' ' : 'ROOT ') + label(n)); }
    for (let j = R.rc[x]; j < R.rc[x + 1]; j++) { const f = R.rf[j], e = R.re[j]; if (ET[edges[e + eType]] === 'weak') continue; if (!prev.has(f)) { prev.set(f, { node: x, e }); if (prev.size < 300000) q.push(f); } } }
  return ['(no strong path to root)'];
}

if (cmd === 'summary') {
  const agg = new Map();
  for (let i = 0; i < N; i++) { const t = type(i); if (['string', 'concatenated string', 'sliced string', 'number', 'code', 'hidden', 'bigint'].includes(t)) continue; const k = t + ' | ' + name(i); const a = agg.get(k) || { n: 0, s: 0 }; a.n++; a.s += size(i); agg.set(k, a); }
  const rows = [...agg];
  console.log('\n=== TOP 30 by instance count ===');
  for (const [k, v] of rows.sort((a, b) => b[1].n - a[1].n).slice(0, 30)) console.log(String(v.n).padStart(9), String(v.s).padStart(11) + 'B', k);
  console.log('\n=== TOP 30 by self size ===');
  for (const [k, v] of rows.sort((a, b) => b[1].s - a[1].s).slice(0, 30)) console.log(String(v.n).padStart(9), String(v.s).padStart(11) + 'B', k);
} else if (cmd === 'find') {
  const re = new RegExp(arg || '.', 'i'); const agg = new Map();
  for (let i = 0; i < N; i++) { const k = type(i) + ' | ' + name(i); if (re.test(k)) { const a = agg.get(k) || { n: 0, s: 0 }; a.n++; a.s += size(i); agg.set(k, a); } }
  console.log(`\n=== matches for /${arg}/i ===`);
  for (const [k, v] of [...agg].sort((a, b) => b[1].n - a[1].n).slice(0, 60)) console.log(String(v.n).padStart(8), String(v.s).padStart(10) + 'B', k);
} else if (cmd === 'retain') {
  const R = buildRetainers();
  let targets = [];
  if (arg.startsWith('#')) { const want = +arg.slice(1); for (let i = 0; i < N; i++) if (id(i) === want) targets.push(i); }
  else { for (let i = 0; i < N; i++) if (name(i) === arg) targets.push(i); }
  console.log(`\n=== retainer paths for "${arg}" (${targets.length} node(s)) ===`);
  for (const t of targets.slice(0, 8)) { console.log('\n' + label(t)); for (const l of pathToRoot(t, R)) console.log('  ' + l); }
} else if (cmd === 'detached') {
  const R = buildRetainers();
  let d = 0, ds = 0; const names = new Map();
  for (let i = 0; i < N; i++) if (det(i) === 2) { d++; ds += size(i); const k = String(name(i)).slice(0, 60); names.set(k, (names.get(k) || 0) + 1); }
  console.log(`\n=== detached DOM: ${d} nodes, ${ds}B self ===`);
  for (const [k, c] of [...names].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(String(c).padStart(7), k);
} else if (cmd === 'buffers') {
  const R = buildRetainers();
  const abs = []; for (let i = 0; i < N; i++) if (name(i) === 'system / JSArrayBufferData') abs.push(i);
  abs.sort((a, b) => size(b) - size(a));
  console.log(`\n=== ${abs.length} ArrayBuffers; largest + retainers ===`);
  for (const a of abs.slice(0, 5)) { console.log('\n' + label(a)); for (const l of pathToRoot(a, R)) console.log('  ' + l); }
} else { console.error('unknown command:', cmd); process.exit(1); }
