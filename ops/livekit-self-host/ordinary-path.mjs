import { constants, fstatSync, lstatSync, openSync, closeSync, readFileSync } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';

export function ordinaryPath(input, kind) {
  const absolute = resolve(input);
  const root = parse(absolute).root;
  let current = root;
  for (const part of ['', ...absolute.slice(root.length).split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    const entry = lstatSync(current);
    if (entry.isSymbolicLink()) throw new Error('Use an ordinary path without symbolic links or junctions.');
  }
  const entry = lstatSync(absolute);
  if ((kind === 'file' && !entry.isFile()) || (kind === 'directory' && !entry.isDirectory())) {
    throw new Error('Path has the wrong file type.');
  }
  return absolute;
}

export function readOrdinaryFile(input, maximumBytes = 65536) {
  const path = ordinaryPath(input, 'file');
  const before = lstatSync(path);
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
        || opened.size > maximumBytes) {
      throw new Error('Input file changed or exceeds the size limit.');
    }
    const content = readFileSync(descriptor, 'utf8');
    if (Buffer.byteLength(content) > maximumBytes) throw new Error('Input file exceeds the size limit.');
    return content;
  } finally {
    closeSync(descriptor);
  }
}

export function newDirectoryPath(input) {
  const path = resolve(input);
  ordinaryPath(dirname(path), 'directory');
  return path;
}
