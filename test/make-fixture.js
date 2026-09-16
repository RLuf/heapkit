#!/usr/bin/env node
/* Build a tiny but valid V8 .heapsnapshot fixture for testing HeapKit.
 * Layout: (root) -> Window -> [Leaky x3] each -> a JWT string.
 * Also one detached-ish node and one ArrayBuffer-like node.
 */
'use strict';
const fs = require('fs');

// node_fields: type, name, id, self_size, edge_count, detachedness
// edge_fields: type, name_or_index, to_node
const node_types = [["hidden","array","string","object","native","synthetic","closure"], "string", "number", "number", "number", "number"];
const edge_types = [["context","element","property","internal","hidden","shortcut","weak"], "string_or_number", "node"];

const strings = [];
const S = s => { const i = strings.indexOf(s); return i >= 0 ? i : strings.push(s) - 1; };

const NF = 6, EF = 3;
const nodes = [];
const edges = [];
// we push nodes first, fixing edge_count after we know each node's edges
const nodeEdges = []; // array of [ [etype,nameIdx,toNodeIndex], ... ]

function addNode(type, name, self_size, detached = 0) {
  const idx = nodes.length / NF;
  nodes.push(type, S(name), idx + 1, self_size, 0, detached); // edge_count filled later
  nodeEdges.push([]);
  return idx;
}
function addEdge(from, etype, name, to) { nodeEdges[from].push([etype, typeof name === 'number' ? name : S(name), to]); }

const T = { object: 3, native: 4, synthetic: 5, closure: 6, string: 2 };
const E = { element: 1, property: 2, internal: 3 };

const root = addNode(T.synthetic, "(GC roots)", 0);
const win  = addNode(T.native, "Window", 100);
addEdge(root, E.element, 0, win);

const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcDEFghijKLmno";
const LEAKS = parseInt(process.argv[3] || "3", 10);
for (let k = 0; k < LEAKS; k++) {
  const leak = addNode(T.object, "Leaky", 32);
  addEdge(win, E.property, "leak" + k, leak);
  const sid = addNode(T.string, jwt, jwt.length * 2);
  addEdge(leak, E.property, "token", sid);
}
// a detached node + an arraybuffer-ish native
const det = addNode(T.native, "Detached <div>", 40, 2);
addEdge(win, E.property, "ghost", det);
const abd = addNode(T.native, "system / JSArrayBufferData", 4194304);
addEdge(win, E.property, "buf", abd);

// finalize edge_count + flatten edges in node order
let flat = [];
for (let i = 0; i < nodeEdges.length; i++) {
  nodes[i * NF + 4] = nodeEdges[i].length;
  for (const [et, nm, to] of nodeEdges[i]) flat.push(et, nm, to);
}

const snap = {
  snapshot: {
    meta: {
      node_fields: ["type", "name", "id", "self_size", "edge_count", "detachedness"],
      node_types,
      edge_fields: ["type", "name_or_index", "to_node"],
      edge_types,
    },
    node_count: nodes.length / NF,
    edge_count: flat.length / EF,
  },
  nodes,
  edges: flat.map((v, i) => (i % EF === EF - 1 ? v * NF : v)), // to_node is index*NF in V8 format
  strings,
};
const out = process.argv[2] || "fixture.heapsnapshot";
fs.writeFileSync(out, JSON.stringify(snap));
console.log("wrote", out, "-", snap.snapshot.node_count, "nodes");
