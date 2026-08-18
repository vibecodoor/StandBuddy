// steam-scan.js
// Discovers installed Steam games and guesses each game's main executable,
// so the Game Limiter can suggest a list instead of requiring a manual .exe pick.
//
// Pure Node, no native modules, no npm deps. Windows-only (Steam paths + registry).
//
// Flow:
//  1. Locate Steam (registry HKCU\Software\Valve\Steam\SteamPath, then defaults).
//  2. Parse steamapps\libraryfolders.vdf for every library folder (multi-drive).
//  3. For each appmanifest_*.acf read the game name + install dir.
//  4. Scan common\<installdir> for .exe files, score candidates, pick the best.
//
// Returns: [{ name, exe, appid }]  (exe is lowercase "game.exe"; sorted by name)

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

// Executable names that are almost never the game itself.
const EXE_BLOCKLIST = [
  'unitycrashhandler', 'unityplayer', 'crashreport', 'crashpad', 'crashhandler',
  'vcredist', 'dxsetup', 'dxwebsetup', 'directx', 'dotnet', 'dotnetfx',
  'redist', 'vc_redist', 'oalinst', 'eac', 'easyanticheat', 'battleye',
  'be_setup', 'setup', 'unins', 'uninstall', 'installer', 'install',
  'cleanup', 'config', 'configurator', 'settings', 'touchup', 'notification',
  'helper', 'service', 'updater', 'update', 'patcher', 'report', 'reporter',
  'subprocess', 'crashsender', 'werfault'
];

function isBlocked(baseLower) {
  return EXE_BLOCKLIST.some((p) => baseLower.includes(p));
}

// Steam "apps" that aren't games (runtimes, redistributables, tools).
const APPID_BLOCKLIST = new Set([
  '228980',   // Steamworks Common Redistributables
  '1070560',  // Steam Linux Runtime 1.0 (scout)
  '1391110',  // Steam Linux Runtime 2.0 (soldier)
  '1628350',  // Steam Linux Runtime 3.0 (sniper)
  '1493710'   // Proton Experimental
]);
const NAME_BLOCKLIST = /redistributable|linux runtime|\bproton\b|steamvr|steam controller/i;

function isNonGame(appid, name) {
  if (appid && APPID_BLOCKLIST.has(appid)) return true;
  return NAME_BLOCKLIST.test(name || '');
}

// Locate the Steam install directory.
function getSteamPath() {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { windowsHide: true },
      (err, stdout) => {
        let p = null;
        if (!err && stdout) {
          const m = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i);
          if (m) p = m[1].trim().replace(/\//g, '\\');
        }
        const candidates = [
          p,
          'C:\\Program Files (x86)\\Steam',
          'C:\\Program Files\\Steam'
        ].filter(Boolean);
        for (const c of candidates) {
          try {
            if (fs.existsSync(path.join(c, 'steamapps'))) return resolve(c);
          } catch (_) {}
        }
        resolve(null);
      }
    );
  });
}

// Extract every "key" "value" pair from a VDF text body.
function parseVdfPairs(text) {
  const pairs = [];
  const re = /"([^"]+)"\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    pairs.push([m[1], m[2]]);
  }
  return pairs;
}

// All Steam library folders (the main one + libraryfolders.vdf entries).
async function getLibraryFolders(steamPath) {
  const libs = new Set([steamPath]);
  const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  try {
    const text = await fsp.readFile(vdfPath, 'utf8');
    for (const [key, value] of parseVdfPairs(text)) {
      if (key.toLowerCase() === 'path' && value) {
        libs.add(value.replace(/\\\\/g, '\\'));
      }
    }
  } catch (_) {}
  return [...libs];
}

// Parse one appmanifest_*.acf into { appid, name, installdir }.
function parseManifest(text) {
  const out = {};
  for (const [key, value] of parseVdfPairs(text)) {
    const k = key.toLowerCase();
    if (k === 'appid') out.appid = value;
    else if (k === 'name') out.name = value;
    else if (k === 'installdir') out.installdir = value;
  }
  return out;
}

// Recursively collect .exe files under a directory (bounded for safety).
async function collectExes(root, maxDepth = 4, maxFiles = 600) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > maxDepth || found.length >= maxFiles) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const ent of entries) {
      if (found.length >= maxFiles) return;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full, depth + 1);
      } else if (ent.isFile() && /\.exe$/i.test(ent.name)) {
        let size = 0;
        try { size = (await fsp.stat(full)).size; } catch (_) {}
        found.push({ full, base: ent.name, depth, size });
      }
    }
  }
  await walk(root, 0);
  return found;
}

// Lowercase, strip non-alphanumerics — for fuzzy name comparison.
function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Pick the most likely game executable from a candidate list.
function pickBestExe(exes, gameName, installdir) {
  const targets = [normalize(gameName), normalize(installdir)].filter(Boolean);
  let best = null;
  let bestScore = -Infinity;

  for (const exe of exes) {
    const baseLower = exe.base.toLowerCase().replace(/\.exe$/, '');
    if (isBlocked(baseLower)) continue;

    const baseNorm = normalize(baseLower);
    let score = 0;

    // Name similarity to the game / install folder.
    for (const t of targets) {
      if (!t || !baseNorm) continue;
      if (baseNorm === t) score += 100;
      else if (t.includes(baseNorm) || baseNorm.includes(t)) score += 50;
    }

    // Bigger binaries are more likely to be the game (cap the contribution).
    score += Math.min(exe.size / (1024 * 1024), 60); // up to +60 for >=60MB

    // Prefer executables near the install root.
    score -= exe.depth * 8;

    if (score > bestScore) {
      bestScore = score;
      best = exe;
    }
  }

  // Fallback: if everything was blocked, take the largest exe outright.
  if (!best && exes.length) {
    best = exes.reduce((a, b) => (b.size > a.size ? b : a));
  }
  return best;
}

// Main entry: list installed Steam games with a guessed executable each.
async function listGames() {
  const steamPath = await getSteamPath();
  if (!steamPath) return [];

  const libs = await getLibraryFolders(steamPath);
  const seenAppIds = new Set();
  const games = [];

  for (const lib of libs) {
    const appsDir = path.join(lib, 'steamapps');
    let files;
    try {
      files = await fsp.readdir(appsDir);
    } catch (_) {
      continue;
    }
    for (const file of files) {
      if (!/^appmanifest_\d+\.acf$/i.test(file)) continue;
      let info;
      try {
        info = parseManifest(await fsp.readFile(path.join(appsDir, file), 'utf8'));
      } catch (_) {
        continue;
      }
      if (!info.installdir || !info.name) continue;
      if (isNonGame(info.appid, info.name)) continue;
      if (info.appid && seenAppIds.has(info.appid)) continue;
      if (info.appid) seenAppIds.add(info.appid);

      const gameDir = path.join(appsDir, 'common', info.installdir);
      const exes = await collectExes(gameDir);
      const best = pickBestExe(exes, info.name, info.installdir);
      if (!best) continue; // no usable executable found

      games.push({
        name: info.name,
        exe: best.base.toLowerCase(),
        appid: info.appid || ''
      });
    }
  }

  games.sort((a, b) => a.name.localeCompare(b.name));
  return games;
}

module.exports = { listGames };
