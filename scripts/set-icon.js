const { rcedit } = require('rcedit');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const version = pkg.version;
const exePath = path.join(__dirname, '../dist/win-unpacked/StandBuddy.exe');
const iconPath = path.join(__dirname, '../assets/tray.ico');
const zipPath = path.join(__dirname, `../dist/StandBuddy-${version}-win.zip`);
const unpackedDir = path.join(__dirname, '../dist/win-unpacked');

async function main() {
  console.log('Setting EXE icon...');
  await rcedit(exePath, { icon: iconPath });
  console.log('Icon set successfully.');

  // Remove old ZIP and recreate with updated EXE
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  console.log('Creating ZIP...');
  const sevenZip = path.join(__dirname, '../node_modules/7zip-bin/win/x64/7za.exe');
  execSync(`"${sevenZip}" a -tzip "${zipPath}" "${unpackedDir}/*"`, { stdio: 'inherit' });
  console.log(`Done: ${zipPath}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
