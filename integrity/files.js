import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { IntegrityError } from './errors.js';

function ioError(error, reading = false) {
  if (error instanceof IntegrityError) return error;
  if (error.code === 'ENOENT' && reading) return new IntegrityError('ARTIFACT_MISSING', 3);
  if (error.code === 'ELOOP') return new IntegrityError('SYMLINK_REFUSED', 2);
  if (error.code === 'EEXIST') return new IntegrityError('OUTPUT_EXISTS', 4);
  return new IntegrityError('IO_FAILURE', 4);
}

function supported() {
  if (!['linux', 'darwin'].includes(process.platform) || !constants.O_NOFOLLOW || !constants.O_NONBLOCK) {
    throw new IntegrityError('FILESYSTEM_PLATFORM_UNSUPPORTED');
  }
}

export async function readCaptured(path, maxBytes) {
  supported();
  let handle;
  try {
    // lstat is only an early refusal. O_NOFOLLOW/fstat enforce the final open.
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) throw new IntegrityError('SYMLINK_REFUSED');
    if (!entry.isFile()) throw new IntegrityError('REGULAR_FILE_REQUIRED');
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new IntegrityError('REGULAR_FILE_REQUIRED');
    if (before.size > BigInt(maxBytes)) throw new IntegrityError('RESOURCE_BYTES');
    const chunks = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(65536, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) throw new IntegrityError('RESOURCE_BYTES');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new IntegrityError('FILE_CHANGED_DURING_READ', 4);
    }
    return Buffer.concat(chunks, total);
  } catch (error) { throw ioError(error, true); }
  finally { if (handle) await handle.close(); }
}

// Markdown first, sidecar last. Explicitly NOT a multi-file transaction.
// No automatic cleanup by pathname: another process might have replaced it.
export async function writeCompanions({ recordPath, integrityPath, markdownPath, integrityBytes, markdownBytes }) {
  supported();
  const paths = [recordPath, integrityPath, markdownPath].map(p => resolve(p));
  if (new Set(paths).size !== paths.length) throw new IntegrityError('OUTPUT_PATH_COLLISION');
  const created = [];
  const handles = [];
  try {
    // Reserve both destinations exclusively before writing either content.
    for (const path of [markdownPath, integrityPath]) {
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      handles.push(handle); created.push(path);
    }
    for (const [i, bytes] of [markdownBytes, integrityBytes].entries()) {
      await handles[i].writeFile(bytes);
      await handles[i].sync();
    }
    for (const handle of handles) await handle.close();
    handles.length = 0;
    return created;
  } catch (error) {
    const failure = ioError(error);
    failure.details.possibly_incomplete_outputs = created;
    throw failure;
  } finally {
    for (const handle of handles) { try { await handle.close(); } catch { /* Original failure is retained. */ } }
  }
}
