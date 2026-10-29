import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as derive,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { createStore } from "./store.mjs";
import { validateProgress } from "./generated/progress-model.mjs";

const scrypt = promisify(derive);
const cookieName = "hcip821_session";
const lifetime = 30 * 24 * 60 * 60 * 1000;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const failure = (status, message) =>
  Object.assign(new Error(message), { status });
const publicUser = (user) => ({ id: user.id, username: user.username });

async function readJson(request) {
  if (!(request.headers["content-type"] || "").startsWith("application/json"))
    throw failure(415, "请使用 JSON 请求。");
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4_000_000) throw failure(413, "进度文件过大。");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw failure(400, "请求不是有效 JSON。");
  }
}

export async function createApi({
  directory,
  bank,
  publicOrigin,
  trustProxy = false,
}) {
  const store = await createStore(directory);
  const attempts = new Map();
  function auth(request) {
    const token = (request.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const state = store.read();
    const session = state.sessions.find(
      (s) => s.hash === digest(token) && s.expires > Date.now(),
    );
    return session
      ? (state.users.find((u) => u.id === session.userId) ?? null)
      : null;
  }
  function setCookie(request, response, token, clear = false) {
    const secure =
      Boolean(request.socket.encrypted) ||
      publicOrigin?.startsWith("https:") ||
      (trustProxy && request.headers["x-forwarded-proto"] === "https");
    response.setHeader(
      "Set-Cookie",
      `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${clear ? 0 : lifetime / 1000}${secure ? "; Secure" : ""}`,
    );
  }
  function limit(request) {
    const address = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    for (const [key, entry] of attempts)
      if (entry.until < now) attempts.delete(key);
    const entry = attempts.get(address) ?? {
      count: 0,
      until: now + 10 * 60 * 1000,
    };
    if (++entry.count > 30)
      throw failure(429, "登录尝试过多，请 10 分钟后重试。");
    attempts.set(address, entry);
  }
  async function authenticate(request, response, pathname) {
    limit(request);
    const body = await readJson(request);
    const username =
      typeof body?.username === "string"
        ? body.username.normalize("NFKC").trim()
        : "";
    const password = body?.password;
    if (
      !/^[\p{L}\p{N}_-]{3,32}$/u.test(username) ||
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 128
    )
      throw failure(
        400,
        "用户名为 3–32 位文字、数字、下划线或短横线；密码为 8–128 位。",
      );
    const normalized = username.toLocaleLowerCase("en-US");
    const existing = store
      .read()
      .users.find((u) => u.normalized === normalized);
    let user;
    if (pathname.endsWith("register")) {
      if (existing) throw failure(409, "用户名已存在，请登录或换一个用户名。");
      const salt = randomBytes(16).toString("hex");
      const hash = (await scrypt(password, salt, 64)).toString("hex");
      user = {
        id: randomUUID(),
        username,
        normalized,
        salt,
        hash,
        revision: 0,
        progress: null,
      };
    } else {
      const candidate = await scrypt(
        password,
        existing?.salt ?? "invalid-account-salt",
        64,
      );
      if (
        !existing ||
        !timingSafeEqual(candidate, Buffer.from(existing.hash, "hex"))
      )
        throw failure(401, "用户名或密码不正确。");
      user = existing;
    }
    const token = randomBytes(32).toString("hex");
    await store.transact((state) => {
      if (pathname.endsWith("register")) {
        if (state.users.some((u) => u.normalized === normalized))
          throw failure(409, "用户名已存在。");
        state.users.push(user);
      }
      state.sessions = state.sessions.filter((s) => s.expires > Date.now());
      // Cap old sessions per account while retaining several devices.
      const own = state.sessions.filter((s) => s.userId === user.id);
      if (own.length >= 20)
        state.sessions = state.sessions.filter(
          (s) => !own.slice(0, own.length - 19).includes(s),
        );
      state.sessions.push({
        hash: digest(token),
        userId: user.id,
        expires: Date.now() + lifetime,
      });
    });
    setCookie(request, response, token);
    return { user: publicUser(user) };
  }
  async function handle(request, response, pathname) {
    const send = (status, value) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(JSON.stringify(value));
    };
    try {
      const method = request.method;
      if (!["GET", "POST", "PUT"].includes(method))
        throw failure(405, "请求方法不支持。");
      if (method !== "GET") {
        const origin = request.headers.origin;
        const expected =
          publicOrigin ||
          `${request.socket.encrypted ? "https" : trustProxy ? request.headers["x-forwarded-proto"] || "http" : "http"}://${request.headers.host}`;
        if (origin && origin !== expected)
          throw failure(403, "请求来源不匹配，请从本站页面重试。");
        if (request.headers["sec-fetch-site"] === "cross-site")
          throw failure(403, "不允许跨站请求。");
      }
      if (pathname === "/api/status" && method === "GET")
        return send(200, { backend: true, version: 2 });
      if (
        ["/api/auth/register", "/api/auth/login"].includes(pathname) &&
        method === "POST"
      )
        return send(200, await authenticate(request, response, pathname));
      if (pathname === "/api/auth/me" && method === "GET") {
        const user = auth(request);
        return send(200, { user: user ? publicUser(user) : null });
      }
      if (pathname === "/api/auth/logout" && method === "POST") {
        await readJson(request);
        const token = (request.headers.cookie || "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith(`${cookieName}=`))
          ?.slice(cookieName.length + 1);
        await store.transact((state) => {
          state.sessions = state.sessions.filter(
            (s) => s.hash !== digest(token || ""),
          );
        });
        setCookie(request, response, "", true);
        return send(200, { ok: true });
      }
      if (pathname !== "/api/progress") throw failure(404, "接口不存在。");
      const user = auth(request);
      if (!user)
        throw failure(
          401,
          "登录已过期，请重新登录。未同步的进度保留在本设备。",
        );
      if (request.headers["x-account-id"] !== user.id)
        throw failure(401, "登录账号已变化，请重新登录；本设备进度已保留。");
      if (method === "GET")
        return send(200, { revision: user.revision, progress: user.progress });
      if (method !== "PUT") throw failure(405, "请求方法不支持。");
      const body = await readJson(request);
      if (!Number.isSafeInteger(body?.revision) || body.revision < 0)
        throw failure(400, "进度版本无效。");
      let progress;
      try {
        progress = validateProgress(body.progress, bank);
      } catch (error) {
        throw failure(400, error.message);
      }
      const result = await store.transact((state) => {
        const current = state.users.find((u) => u.id === user.id);
        if (current.revision !== body.revision)
          return {
            conflict: true,
            revision: current.revision,
            progress: current.progress,
          };
        current.progress = progress;
        current.revision += 1;
        return { revision: current.revision };
      });
      return send(result.conflict ? 409 : 200, result);
    } catch (error) {
      if (!response.headersSent)
        send(error.status || 500, {
          error: error.status ? error.message : "服务器保存失败，请稍后重试。",
        });
    }
  }
  return { handle, close: store.close };
}
