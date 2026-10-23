// Dev-only helper: serves ./generated with CORS + Private-Network-Access headers so the
// generated scripts can be loaded into TradingView's Pine Editor for compile checks.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
const dir = process.argv[2] ?? 'generated';
createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.end();
  try {
    if (req.url === '/bridge') {
      res.setHeader('Content-Type', 'text/html');
      return res.end(`<!doctype html><title>bridge</title><body>posting…<script>
        (async () => {
          const names = await (await fetch('/')).json();
          const files = {};
          for (const n of names) files[n] = await (await fetch('/' + encodeURIComponent(n))).text();
          (window.opener || window.parent).postMessage({ pineFiles: files }, '*');
          document.body.textContent = 'posted ' + names.length + ' files';
        })();
      </script>`);
    }
    if (req.url === '/') return res.end(JSON.stringify((await readdir(dir)).filter((f) => f.endsWith('.pine'))));
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(await readFile(join(dir, basename(decodeURIComponent(req.url)))));
  } catch { res.statusCode = 404; res.end('not found'); }
}).listen(8790, '127.0.0.1', () => console.log('serving', dir, 'on 8790'));
