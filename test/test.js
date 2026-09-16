#!/usr/bin/env node
/* HeapKit self-test: build a fixture, run each command, assert expected output. */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const dir = __dirname;
const fixture = path.join(dir, 'fixture.heapsnapshot');
const heapkit = path.join(dir, '..', 'heapkit.js');
const secrets = path.join(dir, '..', 'heap-secrets.js');
const mk = path.join(dir, 'make-fixture.js');

execFileSync('node', [mk, fixture]);

let pass = 0, fail = 0;
const run = (script, args) => execFileSync('node', [script, fixture, ...args], { encoding: 'utf8' });
const assert = (name, cond) => { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name); } };

const summary = run(heapkit, ['summary']);
assert('summary lists 3 Leaky', /3[^\n]*Leaky/.test(summary));

const find = run(heapkit, ['find', 'Leaky']);
assert('find Leaky = 3', /3[^\n]*object \| Leaky/.test(find));

const detached = run(heapkit, ['detached']);
assert('detached finds the div', /Detached <div>/.test(detached));

const buffers = run(heapkit, ['buffers']);
assert('buffers finds 4MiB ArrayBuffer', /4194304/.test(buffers));

const retain = run(heapkit, ['retain', 'Leaky']);
assert('retain reaches a root', /ROOT/.test(retain) && /Window/.test(retain));

const sec = run(secrets, []);
assert('secrets finds 3 JWTs', /\[JWT\][^\n]*3 occurrence/.test(sec));
assert('secrets masks by default', sec.indexOf('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ') === -1);

const b2 = path.join(dir, 'b2.heapsnapshot'), a2 = path.join(dir, 'a2.heapsnapshot');
execFileSync('node', [mk, b2, '3']);
execFileSync('node', [mk, a2, '7']);
const diff = execFileSync('node', [heapkit, b2, 'diff', a2], { encoding: 'utf8' });
assert('diff detects Leaky growth (+4)', /[+]4[^\n]*Leaky/.test(diff));
fs.unlinkSync(b2); fs.unlinkSync(a2);

fs.unlinkSync(fixture);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
