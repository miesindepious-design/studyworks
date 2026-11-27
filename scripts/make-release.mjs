/**
 * scripts/make-release.mjs
 *
 * Run after `npm run tauri:build` to:
 *   1. Sign the NSIS installer with your private key
 *   2. Update releases/latest.json with the new version + signature
 *   3. Print what to upload to GitHub Releases
 *
 * Usage:
 *   node scripts/make-release.mjs
 *
 * Requires TAURI_SIGNING_PRIVATE_KEY in .env (already set up).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createSign } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, '..');

// ── Read .env for the private key ────────────────────────────────────────────
const envPath = resolve(root, '.env');
const envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const privKeyB64 = envText.match(/^TAURI_SIGNING_PRIVATE_KEY=(.+)$/m)?.[1]?.trim() ?? '';
if (!privKeyB64) {
  console.error('❌  TAURI_SIGNING_PRIVATE_KEY not found in .env');
  process.exit(1);
}

// ── Read the current version from tauri.conf.json ────────────────────────────
const tauriConf  = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const version    = tauriConf.version;
const exePath    = resolve(root, `src-tauri/target/release/bundle/nsis/StudyWorks_${version}_x64-setup.exe`);

if (!existsSync(exePath)) {
  console.error(`❌  Installer not found: ${exePath}`);
  console.error('    Run `npm run tauri:build` first.');
  process.exit(1);
}

// ── Sign the installer ───────────────────────────────────────────────────────
const privKeyDer = Buffer.from(privKeyB64, 'base64');
const exeBytes   = readFileSync(exePath);
const signer     = createSign('sha512');
signer.update(exeBytes);
signer.end();
const signature  = signer.sign({ key: privKeyDer, format: 'der', type: 'pkcs8', dsaEncoding: 'der' }).toString('base64');

// ── Update releases/latest.json ──────────────────────────────────────────────
const releaseFile = resolve(root, 'releases/latest.json');
const existing    = JSON.parse(readFileSync(releaseFile, 'utf8'));

const updated = {
  ...existing,
  version,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/miesindepious-design/studyworks/releases/download/v${version}/StudyWorks_${version}_x64-setup.exe`,
    },
  },
};

writeFileSync(releaseFile, JSON.stringify(updated, null, 2) + '\n', 'utf8');

console.log(`\n✅  Release v${version} prepared.\n`);
console.log('Next steps:');
console.log(`  1. git add releases/latest.json && git commit -m "release: v${version}" && git push`);
console.log(`  2. Go to github.com/miesindepious-design/studyworks/releases/new`);
console.log(`  3. Tag: v${version}`);
console.log(`  4. Upload:  src-tauri/target/release/bundle/nsis/StudyWorks_${version}_x64-setup.exe`);
console.log(`             src-tauri/target/release/bundle/msi/StudyWorks_${version}_x64_en-US.msi`);
console.log(`  5. Publish the release.\n`);
console.log('Existing users will see the update banner next time they open the app.');
