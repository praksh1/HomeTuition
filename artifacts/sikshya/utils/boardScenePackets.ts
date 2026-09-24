/** Keep an imported document below the classroom's 4 MiB WebSocket frame limit.
 * Pictures travel with their element, never as orphaned file-only updates. */
export function boardScenePackets(elements: unknown[], files: unknown[], pageId: string) {
  const byId = new Map(files.map((file) => [(file as { id: string }).id, file]));
  const packets: { elements: unknown[]; files: unknown[]; pageId: string }[] = [];
  let packet = { elements: [] as unknown[], files: [] as unknown[], pageId };
  let size = 1024;
  const included = new Set<string>();
  for (const element of elements) {
    const id = (element as { fileId?: string }).fileId;
    const file = id && !included.has(id) ? byId.get(id) : undefined;
    // Element text can contain Unicode. Files are base64 ASCII; avoid making another large
    // encoded byte array just to measure them on a phone.
    const bytes = JSON.stringify(element).length * 3 + (file ? JSON.stringify(file).length : 0);
    if (packet.elements.length && size + bytes > 2_750_000) {
      packets.push(packet);
      packet = { elements: [], files: [], pageId };
      size = 1024;
    }
    packet.elements.push(element);
    if (file && id) { packet.files.push(file); included.add(id); }
    size += bytes;
  }
  if (packet.elements.length) packets.push(packet);
  return packets;
}
