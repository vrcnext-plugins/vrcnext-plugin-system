import assert from 'node:assert/strict';
import { test } from 'vitest';

import { newestFirst, timeAgo } from './time.js';

const DAY = 86_400_000;

const NOW = Date.parse('2026-09-27T12:00:00Z');

test('timeAgo is coarse and human', () => {
  assert.equal(timeAgo('2026-09-27T11:59:40Z', NOW), 'just now');
  assert.equal(timeAgo('2026-09-27T11:59:00Z', NOW), '1 minute ago');
  assert.equal(timeAgo('2026-09-27T11:15:00Z', NOW), '45 minutes ago');
  assert.equal(timeAgo('2026-09-27T09:00:00Z', NOW), '3 hours ago');
  assert.equal(timeAgo('2026-09-25T09:00:00Z', NOW), '2 days ago');
  assert.equal(timeAgo('garbage', NOW), 'just now');
  assert.equal(timeAgo('2026-09-27T13:00:00Z', NOW), 'just now', 'the future is not in the past');
});

test('past days it reports months, then years', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  assert.equal(timeAgo(now - 29 * DAY, now), '29 days ago');
  assert.equal(timeAgo(now - 60 * DAY, now), '2 months ago');
  assert.equal(timeAgo(now - 364 * DAY, now), '12 months ago');
  assert.equal(timeAgo(now - 400 * DAY, now), '1 year ago');
  assert.equal(timeAgo(new Date(now - 800 * DAY), now), '2 years ago');
});

test('newestFirst orders by timestamp and drops what cannot be read', () => {
  const events = [
    { timestamp: '2026-09-27T10:00:00Z', name: 'middle' },
    { timestamp: 'not a date', name: 'unreadable' },
    { timestamp: '2026-09-27T11:00:00Z', name: 'newest' },
    { timestamp: '2026-09-26T10:00:00Z', name: 'oldest' },
  ];
  assert.deepEqual(newestFirst(events).map((e) => e.name), ['newest', 'middle', 'oldest']);
  assert.deepEqual(newestFirst(undefined), []);
  assert.deepEqual(newestFirst([]), []);
});

test('newestFirst takes a timestamp however it is held', () => {
  const now = Date.now();
  const items = [{ timestamp: now - 1000 }, { timestamp: new Date(now) }];
  assert.deepEqual(newestFirst(items), [items[1], items[0]]);
});
