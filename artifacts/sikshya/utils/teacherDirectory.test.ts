import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTeacherDirectory } from './teacherDirectory.ts';
import { matches } from './search.ts';

test('Discover can find a new unrated teacher beyond the first 100 results', async () => {
  const teachers = Array.from({ length: 197 }, (_, i) => ({ userId: i + 1, name: `Tutor ${i}` }));
  teachers[196] = { userId: 719, name: 'Prakash Teacher' };
  const requests: string[] = [];
  const result = await loadTeacherDirectory(async (path) => {
    requests.push(path);
    const page = Number(new URL(path, 'https://example.test').searchParams.get('page'));
    return { teachers: teachers.slice((page - 1) * 100, page * 100), total: 197, page, limit: 100 };
  });
  assert.equal(result.teachers.length, 197);
  assert.equal(result.teachers.find(t => matches(t.name, 'prakash teacher'))?.userId, 719);
  assert.equal(requests.length, 2);
});

test('a failed later page cannot be presented as a complete directory', async () => {
  await assert.rejects(loadTeacherDirectory(async (path) => {
    if (path.includes('page=2')) throw new Error('Network unavailable');
    return { teachers: [{ userId: 1 }], total: 2, page: 1, limit: 1 };
  }), /Network unavailable/);
});
