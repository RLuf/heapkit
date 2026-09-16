# HeapKit — Security Edition

Offline analyzer for V8 `.heapsnapshot` files (Chrome / Node) that opens
snapshots too big for the DevTools UI. Two tools, zero dependencies, Node 18+.

## heapkit.js — leak forensics
```
node --max-old-space-size=8192 heapkit.js <file.heapsnapshot> [summary|find <re>|retain <#id|name>|detached|buffers]
```
- `summary`  top constructors by count / self-size
- `find`     objects/closures matching a regex
- `retain`   retainer path to GC root (the reason it leaks)
- `detached` detached DOM nodes (browser leaks)
- `buffers`  largest ArrayBuffers + who retains them

## heap-secrets.js — secrets left in memory  (security research)
```
node --max-old-space-size=8192 heap-secrets.js <file.heapsnapshot> [--full]
```
Scans live strings for JWTs, Google/AWS/Stripe/GitHub/Slack keys, bearer tokens,
OAuth codes, session cookies, private keys, and plaintext password fields.
Values are **masked** by default. Real snapshots routinely retain auth tokens
long after the UI "logged out" — this finds them.

Pair them: `heap-secrets.js` finds a token, `heapkit.js retain` shows what keeps
it alive.

## License
MIT.
