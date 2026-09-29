#!/usr/bin/env node
// Sign a plugin repository so the bridge will install it.
//
//   node scripts/sign-plugin.mjs keygen [--out FILE]   make a signing key, once, and keep it
//   node scripts/sign-plugin.mjs sign   [--key FILE]   write plugin.sig for this repository
//   node scripts/sign-plugin.mjs verify                check plugin.sig against the files
//   node scripts/sign-plugin.mjs fingerprint [--key FILE]
//
// The key comes from --key, or from $VRCNEXT_SIGNING_KEY (64 hex characters), which is how a
// GitHub Actions secret reaches it. Nothing is ever fetched: this file and Node's built-in
// crypto are the whole toolchain, on purpose — a signing step that downloads its own signer is
// not a signing step.
//
// What is signed is the *tracked* tree, read through `git ls-files`, because that is exactly
// what the bridge's shallow clone will contain. The bytes come from git's own objects, not from
// this disk: with `core.autocrlf` set, a Windows checkout holds CRLF where the clone holds LF, and
// a digest of the working tree would never match. A dirty working tree is refused rather than
// signed, since it is not what anyone else receives. A tracked symlink is refused too, because
// the bridge refuses any tree that contains one.
//
// The format is documented in the bridge: crates/vrcnext-bridge-plugins/src/signing.rs.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as signBytes, verify as verifyBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TREE_DOMAIN = Buffer.from('vrcnext-plugin-tree-v1\n');
const MESSAGE_DOMAIN = Buffer.from('vrcnext-plugin-signature-v1\n');
const SIGNATURE_FILE = 'plugin.sig';

/** DER wrappers, so a raw 32-byte Ed25519 key can become a Node KeyObject without a library. */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function fail(message) {
  process.stderr.write(`sign-plugin: ${message}\n`);
  process.exit(1);
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Every tracked file except the signature itself, as `{ path, object }` in path order.
 *
 * A submodule is skipped: the bridge's clone does not fetch one, so it holds an empty directory
 * there, which contributes nothing. A symlink is refused, as the bridge refuses it.
 */
function trackedFiles(root) {
  const listed = git('-C', root, 'ls-files', '-s', '-z').split('\0').filter(Boolean);
  const files = [];
  for (const line of listed) {
    const [meta, path] = line.split('\t');
    const [mode, object] = meta.split(' ');
    if (mode === '160000') continue;
    if (mode === '120000') fail(`${path} is a symlink; the bridge refuses a tree that contains one`);
    if (path === SIGNATURE_FILE) continue;
    files.push({ path, object });
  }
  // Byte order, as the bridge sorts: not localeCompare, which would disagree on case.
  return files.sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
}

/** The committed bytes of each object, read in one `git cat-file --batch`. */
function blobs(root, objects) {
  if (objects.length === 0) return [];
  const out = execFileSync('git', ['-C', root, 'cat-file', '--batch'], {
    input: `${objects.join('\n')}\n`,
    maxBuffer: 64 * 1024 * 1024,
  });
  const result = [];
  let at = 0;
  for (const object of objects) {
    const newline = out.indexOf(0x0a, at);
    const [name, type, size] = out.subarray(at, newline).toString('utf8').split(' ');
    if (name !== object || type !== 'blob') fail(`git could not read ${object}`);
    const start = newline + 1;
    const end = start + Number(size);
    result.push(out.subarray(start, end));
    at = end + 1;
  }
  return result;
}

/** Refuse to sign bytes nobody else will receive. */
function requireCleanTree(root) {
  const dirty = git('-C', root, 'status', '--porcelain', '-z')
    .split('\0')
    .filter(Boolean)
    .filter((entry) => entry.slice(3) !== SIGNATURE_FILE);
  if (dirty.length > 0) {
    fail(`the working tree has uncommitted changes:\n  ${dirty.join('\n  ')}\ncommit them first; the signature covers what a clone gets, not what is on this disk`);
  }
}

/** The digest the bridge will recompute: path, NUL, length, contents, in path order. */
export function treeDigest(root, files) {
  const hash = createHash('sha256');
  hash.update(TREE_DOMAIN);
  const contents = blobs(root, files.map((file) => file.object));
  for (const [index, { path }] of files.entries()) {
    const bytes = contents[index];
    const length = Buffer.alloc(8);
    length.writeBigUInt64LE(BigInt(bytes.length));
    hash.update(Buffer.from(path, 'utf8'));
    hash.update(Buffer.from([0]));
    hash.update(length);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

/** The bytes the signature covers: the domain, the plugin id, the digest. */
function message(id, digest) {
  return Buffer.concat([MESSAGE_DOMAIN, Buffer.from(`${id}\n${digest}\n`, 'utf8')]);
}

/** A key id: the first 16 bytes of the public key's SHA-256, in groups of four. */
export function keyId(publicHex) {
  const digest = createHash('sha256').update(publicHex.toLowerCase()).digest('hex').slice(0, 32);
  return (digest.match(/.{4}/g) ?? []).join('-');
}

function privateFromSeed(hex) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex.trim())) {
    fail('the signing key must be 64 hex characters (32 bytes)');
  }
  const der = Buffer.concat([PKCS8_PREFIX, Buffer.from(hex.trim(), 'hex')]);
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function publicHexOf(key) {
  const der = createPublicKey(key).export({ format: 'der', type: 'spki' });
  return Buffer.from(der.subarray(der.length - 32)).toString('hex');
}

function loadKey(flags) {
  const fromFile = flags.key === undefined ? undefined : readFileSync(flags.key, 'utf8');
  const hex = fromFile ?? process.env.VRCNEXT_SIGNING_KEY;
  if (hex === undefined || hex.trim() === '') {
    fail('no signing key: pass --key FILE or set VRCNEXT_SIGNING_KEY to 64 hex characters');
  }
  return privateFromSeed(hex);
}

function pluginId(root) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'));
    if (typeof manifest.id !== 'string' || manifest.id === '') throw new Error('no id');
    return manifest.id;
  } catch {
    return fail('plugin.json is missing or has no "id"; run this in a plugin repository');
  }
}

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!name.startsWith('--')) fail(`unexpected argument ${name}`);
    flags[name.slice(2)] = argv[index + 1];
  }
  return flags;
}

function keygen(flags) {
  const out = flags.out ?? 'vrcnext-signing-key.txt';
  const { privateKey } = generateKeyPairSync('ed25519');
  const der = privateKey.export({ format: 'der', type: 'pkcs8' });
  const seed = Buffer.from(der.subarray(der.length - 32)).toString('hex');
  writeFileSync(out, `${seed}\n`, { mode: 0o600 });
  const publicHex = publicHexOf(privateKey);
  process.stdout.write(
    `private key written to ${out} (keep it; there is no way to recover it)\n` +
      `public key  ${publicHex}\n` +
      `fingerprint ${keyId(publicHex)}\n\n` +
      `Put the contents of ${out} in a repository secret named VRCNEXT_SIGNING_KEY,\n` +
      `and publish the fingerprint where your users can check it.\n`,
  );
}

function sign(flags) {
  const root = git('rev-parse', '--show-toplevel').trim();
  requireCleanTree(root);
  const id = pluginId(root);
  const key = loadKey(flags);
  const digest = treeDigest(root, trackedFiles(root));
  const publicKey = publicHexOf(key);
  const file = {
    version: 1,
    algorithm: 'ed25519',
    id,
    publicKey,
    digest,
    signature: signBytes(null, message(id, digest), key).toString('hex'),
    signedAt: Math.floor(Date.now() / 1000),
  };
  writeFileSync(join(root, SIGNATURE_FILE), `${JSON.stringify(file, null, 2)}\n`);
  process.stdout.write(`signed ${id} as ${keyId(publicKey)} (${digest.slice(0, 12)}…)\n`);
}

function verify() {
  const root = git('rev-parse', '--show-toplevel').trim();
  const id = pluginId(root);
  let file;
  try {
    file = JSON.parse(readFileSync(join(root, SIGNATURE_FILE), 'utf8'));
  } catch {
    return fail(`no usable ${SIGNATURE_FILE}; run "sign" first`);
  }
  if (file.version !== 1 || file.algorithm !== 'ed25519') fail('unsupported signature format');
  if (file.id !== id) fail(`the signature is for plugin "${file.id}", not "${id}"`);
  const digest = treeDigest(root, trackedFiles(root));
  if (digest !== file.digest) fail('the tracked files no longer match the signature; sign again');
  const spki = Buffer.concat([SPKI_PREFIX, Buffer.from(file.publicKey, 'hex')]);
  const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  const ok = verifyBytes(null, message(id, digest), publicKey, Buffer.from(file.signature, 'hex'));
  if (!ok) fail('the signature does not verify against the key it names');
  process.stdout.write(`${id} verifies as ${keyId(file.publicKey)}\n`);
}

function fingerprint(flags) {
  const publicHex = publicHexOf(loadKey(flags));
  process.stdout.write(`public key  ${publicHex}\nfingerprint ${keyId(publicHex)}\n`);
}

const [command, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);
switch (command) {
  case 'keygen':
    keygen(flags);
    break;
  case 'sign':
    sign(flags);
    break;
  case 'verify':
    verify();
    break;
  case 'fingerprint':
    fingerprint(flags);
    break;
  default:
    process.stdout.write(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 19).map((line) => line.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(command === undefined ? 0 : 1);
}
