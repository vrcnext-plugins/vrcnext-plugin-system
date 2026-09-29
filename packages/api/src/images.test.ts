import assert from 'node:assert/strict';
import { test } from 'vitest';

import { imageCacheKey, isPublicImageUrl, publicImageUrl } from './images.js';

test('VRChat\'s own addresses are the ones that travel', () => {
  assert.equal(isPublicImageUrl('https://api.vrchat.cloud/api/1/image/file_x/1/256'), true);
  assert.equal(isPublicImageUrl('https://api.vrchat.cloud/api/1/file/file_x/5/file'), true);
});

test('VRCNext\'s image cache is this machine, whatever it is called', () => {
  for (const url of [
    'http://localhost:51956/imgcache/Users/usr_x.png?thumb=96',
    'http://127.0.0.1:51956/imgcache/Users/usr_x.png',
    'http://[::1]:51956/imgcache/Users/usr_x.png',
    'http://192.168.2.11/img.png',
    'http://10.0.0.5/img.png',
    'http://172.16.4.4/img.png',
    'http://169.254.169.254/img.png',
    'http://nas.local/img.png',
  ]) {
    assert.equal(isPublicImageUrl(url), false, `${url} must not be called public`);
  }
});

test('what is not an http address at all is not one that travels', () => {
  for (const url of ['', 'assets/Avatars/default.png', 'data:image/png;base64,AAAA', 'file:///home/b/x.png', 'not a url']) {
    assert.equal(isPublicImageUrl(url), false, `${url} must not be called public`);
  }
});

test('publicImageUrl empties what cannot travel, so the field drops', () => {
  assert.equal(publicImageUrl('https://api.vrchat.cloud/api/1/image/file_x/1/256'), 'https://api.vrchat.cloud/api/1/image/file_x/1/256');
  assert.equal(publicImageUrl('http://localhost:51956/imgcache/Users/usr_x.png'), '');
  assert.equal(publicImageUrl(undefined), '');
});

test('a cache URL yields the key VRCNext filed the picture under', () => {
  assert.equal(imageCacheKey('http://localhost:51956/imgcache/Users/usr_1.png?v=639262291030685619'), 'Users/usr_1');
  assert.equal(imageCacheKey('http://localhost:51956/imgcache/Users/usr_1.png?v=1&thumb=96'), 'Users/usr_1');
  assert.equal(imageCacheKey('http://localhost:51956/imgcache/Avatars/avtr_1.webp'), 'Avatars/avtr_1');
  // VRC+ decorations are the same id with a suffix, and are keys in their own right.
  assert.equal(imageCacheKey('http://localhost:51956/imgcache/Users/usr_1_pfp.png'), 'Users/usr_1_pfp');
  assert.equal(imageCacheKey('http://127.0.0.1:51956/imgcache/Groups/grp_1.png'), 'Groups/grp_1');
});

test('anything that is not one of VRCNext\'s cache addresses has no key', () => {
  // A public URL needs no translating.
  assert.equal(imageCacheKey('https://api.vrchat.cloud/api/1/image/file_1/1/800'), undefined);
  // Local, but not the image cache.
  assert.equal(imageCacheKey('http://localhost:51956/app/index.html'), undefined);
  assert.equal(imageCacheKey('http://localhost:51956/vrcphotos/x.png'), undefined);
  // Not a `Subdir/entityId` pair.
  assert.equal(imageCacheKey('http://localhost:51956/imgcache/Users/sub/usr_1.png'), undefined);
  assert.equal(imageCacheKey('http://localhost:51956/imgcache/usr_1.png'), undefined);
  assert.equal(imageCacheKey('http://localhost:51956/imgcache/../../etc/passwd'), undefined);
  assert.equal(imageCacheKey('not a url'), undefined);
  assert.equal(imageCacheKey(undefined), undefined);
});
