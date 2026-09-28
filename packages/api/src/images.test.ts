import assert from 'node:assert/strict';
import { test } from 'vitest';

import { isPublicImageUrl, publicImageUrl } from './images.js';

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
