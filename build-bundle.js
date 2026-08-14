const { build } = require('esbuild');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Only bundle renderer.js (browser context, no require).
// preload.js must NOT be bundled: it runs in Electron's Node context with
// full require() support, and bundling it would break contextBridge because
// esbuild would try to inline require('electron') which is not a real npm pkg.
const ROOT = __dirname;
const items = [
  { entry: path.join(ROOT, 'renderer.js'), outfile: path.join(ROOT, 'renderer.js'), platform: 'browser' },
];

async function doBuild() {
  const backups = [];
  try {
    for (const it of items) {
      if (!fs.existsSync(it.entry)) continue;
      const orig = fs.readFileSync(it.entry, 'utf8');
      const bak = it.entry + '.bak';
      fs.writeFileSync(bak, orig, 'utf8');
      backups.push({ file: it.entry, bak });

      // bundle with esbuild into a temp file
      const tmpOut = it.entry + '.tmp.js';
      // iife format is required for <script src> loading in the browser/renderer context.
      // cjs format would wrap code in a CommonJS module that never auto-executes in the browser.
      await build({
        entryPoints: [it.entry],
        bundle: true,
        minify: true,
        platform: it.platform,
        format: 'iife',
        outfile: tmpOut,
        define: { 'process.env.NODE_ENV': '"production"' },
      });

      const code = fs.readFileSync(tmpOut, 'utf8');

      // No obfuscation, just copy the esbuild output
      fs.writeFileSync(it.outfile, code, 'utf8');

      // remove temp
      fs.unlinkSync(tmpOut);
      console.log('Bundled & obfuscated:', it.entry);
    }

    // Run local electron-builder binary from node_modules to avoid relying on npx
    console.log('Running electron-builder...');
    // Pass through any CLI flags (e.g. --win / --mac / --linux)
    const flags = process.argv.slice(2);
    let flagsArr = flags.length ? flags : null;
    if (!flagsArr) {
      // default to current platform to avoid cross-platform build errors
      if (process.platform === 'win32') flagsArr = ['--win'];
      else if (process.platform === 'darwin') flagsArr = ['--mac'];
      else if (process.platform === 'linux') flagsArr = ['--linux'];
      else flagsArr = ['--win'];
    }
    const ebBin = path.join(ROOT, 'node_modules', '.bin', 'electron-builder' + (process.platform === 'win32' ? '.cmd' : ''));
    let res;
    if (process.platform === 'win32') {
      // On Windows run via cmd /c to execute the .cmd wrapper
      res = spawnSync('cmd', ['/c', ebBin, ...flagsArr], { stdio: 'inherit' });
    } else {
      res = spawnSync(ebBin, flagsArr, { stdio: 'inherit' });
    }
    if (res.error) throw res.error;
    if (res.status !== 0) throw new Error('electron-builder failed with code ' + res.status);

  } catch (err) {
    console.error('Build failed:', err);
    process.exitCode = 1;
  } finally {
    // restore backups
    for (const b of backups) {
      try {
        const bakContent = fs.readFileSync(b.bak, 'utf8');
        fs.writeFileSync(b.file, bakContent, 'utf8');
        fs.unlinkSync(b.bak);
        console.log('Restored original:', b.file);
      } catch (e) {
        console.warn('Failed to restore backup for', b.file, e);
      }
    }
  }
}

// ensure required modules are available and run
(async () => {
  try {
    await doBuild();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
