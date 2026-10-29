import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";

/** One Node process owns this store; writes are serialized and atomically replaced. */
export async function createStore(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, "server.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Recover a lock left by a crashed process, but never run two writers.
    const pid = Number(await readFile(lockPath, "utf8"));
    try {
      process.kill(pid, 0);
      throw new Error("Data directory is already in use by another server.");
    } catch (check) {
      if (check.code !== "ESRCH") throw check;
      const { unlink } = await import("node:fs/promises");
      await unlink(lockPath);
      lock = await open(lockPath, "wx", 0o600);
    }
  }
  await lock.writeFile(String(process.pid));
  const file = path.join(directory, "store.json");
  let state;
  let queue = Promise.resolve();
  try {
    state = JSON.parse(await readFile(file, "utf8"));
    if (
      state.version !== 1 ||
      !Array.isArray(state.users) ||
      !Array.isArray(state.sessions)
    )
      throw new Error("Invalid database structure.");
  } catch (error) {
    if (error.code !== "ENOENT") {
      await close();
      throw new Error(
        "Cannot read database; existing data was not overwritten.",
      );
    }
    state = { version: 1, users: [], sessions: [] };
  }
  async function transact(fn) {
    const task = queue.then(async () => {
      const next = structuredClone(state);
      const result = await fn(next);
      const temporary = `${file}.tmp`;
      const handle = await open(temporary, "w", 0o600);
      try {
        await handle.writeFile(JSON.stringify(next));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, file);
      state = next;
      return result;
    });
    queue = task.catch(() => {});
    return task;
  }
  async function close() {
    if (queue) await queue;
    await lock.close();
    const { unlink } = await import("node:fs/promises");
    await unlink(lockPath);
  }
  return { read: () => structuredClone(state), transact, close };
}
