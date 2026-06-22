// One-off icon generator. The only Sox artwork we have is a .webp, which Windows
// (and electron-builder) can't use for an app icon — they need .ico/.png. Rather
// than depend on ImageMagick/sharp (absent here), we borrow Electron's bundled
// Chromium, which decodes webp natively: render the webp onto canvases at several
// sizes, read each back as PNG, and assemble a multi-resolution .ico by hand.
//
//   npm run icon   (alias for: electron electron/make-icon.cjs)
//
// Outputs build/icon.ico + build/icon.png (electron-builder installer/exe icon)
// and public/icon.png (the runtime BrowserWindow + favicon icon, bundled by Vite).
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'personalities', 'sox.webp');
// Standard Windows icon sizes; Explorer/taskbar/installer each pick the best fit.
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// Assemble a single .ico from per-size PNGs. Windows Vista+ (and electron-builder)
// accept PNG-compressed icon entries, so each size is just its PNG bytes verbatim.
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;
  images.forEach((img, i) => {
    const e = i * 16;
    // 256 is stored as 0 in the single-byte width/height fields.
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, e + 0);
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1);
    entries.writeUInt8(0, e + 2); // palette count (0 = none)
    entries.writeUInt8(0, e + 3); // reserved
    entries.writeUInt16LE(1, e + 4); // color planes
    entries.writeUInt16LE(32, e + 6); // bits per pixel
    entries.writeUInt32LE(img.buffer.length, e + 8); // image byte size
    entries.writeUInt32LE(offset, e + 12); // image byte offset
    offset += img.buffer.length;
  });

  return Buffer.concat([header, entries, ...images.map((img) => img.buffer)]);
}

async function run() {
  const webp = fs.readFileSync(SRC).toString('base64');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  await win.loadURL('data:text/html,<body></body>');

  // Draw the webp into a square canvas at each size (contain-fit, centered, on a
  // transparent background) and read it back as a PNG data URL.
  const dataUrls = await win.webContents.executeJavaScript(`(async () => {
    const sizes = ${JSON.stringify(SIZES)};
    const img = new Image();
    img.src = 'data:image/webp;base64,${webp}';
    await img.decode();
    const out = {};
    for (const s of sizes) {
      const c = document.createElement('canvas');
      c.width = s; c.height = s;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, s, s);
      const scale = Math.min(s / img.width, s / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
      out[s] = c.toDataURL('image/png');
    }
    return out;
  })()`);

  const images = SIZES.map((size) => ({ size, buffer: Buffer.from(dataUrls[size].split(',')[1], 'base64') }));
  const png256 = images.find((img) => img.size === 256).buffer;

  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), buildIco(images));
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), png256);
  fs.writeFileSync(path.join(ROOT, 'public', 'icon.png'), png256);

  console.log('Wrote build/icon.ico, build/icon.png, public/icon.png');
  win.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(run).catch((error) => {
  console.error(error);
  app.exit(1);
});
