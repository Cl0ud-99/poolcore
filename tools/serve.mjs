import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'site');
const PORT = Number(process.env.PORT || 5273);
const HOST = process.env.HOST || '127.0.0.1';
// HTTPS is required for the browser to treat this origin as a secure context.
// Pointer Lock (which is what pins the cursor to the centre) is refused on a
// plain-http LAN address, so over http://192.168.x.x the cursor can never be
// captured no matter what the page does. Pass --https (or HTTPS=1) to serve TLS.
const USE_TLS = process.argv.includes('--https') || process.env.HTTPS === '1';
const CERT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'dev-cert.pem');
const KEY = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'dev-key.pem');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream',
  '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml',
};
function handler(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('404 ' + p); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    res.end(data);
  });
}

// Serve http and https side by side. A single-protocol server is a footgun:
// switching to TLS to obtain Pointer Lock would otherwise make the page
// unreachable for anyone who has not imported the self-signed certificate yet.
// 5273 stays plain http (always reachable), 5274 adds TLS (secure context).
const TLS_PORT = Number(process.env.TLS_PORT || (PORT + 1));

const httpServer = http.createServer(handler);
httpServer.listen(PORT, HOST, () => {
  console.log('serving ' + ROOT);
  console.log('  http    http://127.0.0.1:' + PORT);
  if (HOST === '0.0.0.0' || HOST === '::') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) console.log('  http    http://' + n.address + ':' + PORT);
      }
    }
  }
});

if (fs.existsSync(CERT) && fs.existsSync(KEY)) {
  const httpsServer = https.createServer(
    { cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) }, handler);
  httpsServer.listen(TLS_PORT, HOST, () => {
    console.log('  https   https://127.0.0.1:' + TLS_PORT + '   <- secure context, pointer lock works');
    if (HOST === '0.0.0.0' || HOST === '::') {
      for (const list of Object.values(os.networkInterfaces())) {
        for (const n of list || []) {
          if (n.family === 'IPv4' && !n.internal) {
            console.log('  https   https://' + n.address + ':' + TLS_PORT + '   <- secure context, pointer lock works');
          }
        }
      }
    }
  });
  httpsServer.on('error', (e) => {
    console.log('  https   disabled (' + e.code + ')');
  });
} else {
  console.log('');
  console.log('  (no tools/dev-cert.pem - run "node tools/gen-cert.mjs" to enable https)');
}

console.log('');
console.log('  Click the view once to capture the cursor. Both URLs above work;');
console.log('  if the browser declines to lock over plain http, the https URL is');
console.log('  the guaranteed path.');
