// Standalone desktop shell. Serves the built dist/ over a FIXED loopback port so
// localStorage saves (origin-keyed) stay stable across launches — listen(0)/file://
// would silently wipe them. Secure defaults: no node integration, sandboxed.
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist');
const PORT = 8123;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2', '.hdr': 'image/vnd.radiance',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2',
};

function serve() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path.join(DIST, 'index.html')))
      return reject(new Error('dist/ not built — run `npm run build` first.'));
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      const file = path.join(DIST, url === '/' ? 'index.html' : url);
      if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; } // path-traversal guard
      fs.readFile(file, (err, data) => {
        if (err) { // SPA fallback to index.html
          fs.readFile(path.join(DIST, 'index.html'), (e2, html) =>
            e2 ? res.writeHead(404).end('not found')
              : res.writeHead(200, { 'Content-Type': 'text/html' }).end(html));
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(`http://127.0.0.1:${PORT}`));
    server.on('error', reject);
  });
}

async function createWindow() {
  const url = await serve();
  const win = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#06060c', autoHideMenuBar: true,
    title: 'Rogue Hero 4',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL(url);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
