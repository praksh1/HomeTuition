import test from 'node:test';
import assert from 'node:assert/strict';
import { boardScenePackets } from './boardScenePackets.ts';

test('14 detailed PDF pages travel in bounded, ordered packets with their picture bytes', () => {
  const elements = Array.from({ length: 14 }, (_, n) => ({ id: `page-${n}`, fileId: `file-${n}`, text: 'पाठ' }));
  const files = elements.map((e) => ({ id: e.fileId, dataURL: 'data:image/jpeg;base64,' + 'A'.repeat(600_000) }));
  const packets = boardScenePackets(elements, files, 'board-2');
  assert.ok(packets.length > 1);
  assert.deepEqual(packets.flatMap(p => p.elements), elements);
  assert.deepEqual(packets.flatMap(p => p.files), files);
  for (const packet of packets) {
    assert.equal(packet.pageId, 'board-2');
    assert.ok(Buffer.byteLength(JSON.stringify({ type: 'scene_update', ...packet })) < 4 * 1024 * 1024);
    for (const e of packet.elements as typeof elements) assert.ok(packet.files.some(f => (f as { id: string }).id === e.fileId));
  }
});
test('writing and deletion deltas without files are retained; repeated file is sent only once', () => {
  assert.deepEqual(boardScenePackets([], [], 'p'), []);
  const elements = [{ id: 'a', fileId: 'f' }, { id: 'b', fileId: 'f' }, { id: 'c', isDeleted: true }];
  const files = [{ id: 'f', dataURL: 'data:image/jpeg;base64,AAAA' }];
  const result = boardScenePackets(elements, files, 'p');
  assert.deepEqual(result, [{ elements, files, pageId: 'p' }]);
});
