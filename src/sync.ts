import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Bank } from "./domain";
import { validateProgress, type Progress } from "./progress-model";

export interface User {
  id: string;
  username: string;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: any,
  ) {
    super(message);
  }
}
export async function api(
  path: string,
  body?: unknown,
  method = "POST",
  signal?: AbortSignal,
  accountId?: string,
) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : method,
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(accountId ? { "X-Account-Id": accountId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(10000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "当前部署没有可用的同步后端，请使用新版 Node 服务启动。",
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiError(data.error || "同步请求失败。", response.status, data);
  return data;
}

export function useAccount() {
  const [user, setUser] = useState<User | null>(null);
  const [backend, setBackend] = useState<
    "checking" | "available" | "unavailable"
  >("checking");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setError("");
    try {
      const data = await api("/api/auth/me");
      if (!("user" in data)) throw new Error("后端不可用");
      setUser(data.user);
      setBackend("available");
    } catch {
      setBackend("unavailable");
      setError(
        "同步后端暂不可用。仍可在本设备刷题；请检查新版 Node 服务和 /api/ 转发。",
      );
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { user, setUser, backend, error, refresh };
}

interface Snapshot {
  revision: number;
  progress: Progress | null;
}
export const progressKey = (user: User) => `h12-821-account-${user.id}`;
export function hasLearning(p: Progress) {
  return (
    Object.keys(p.records).length > 0 ||
    p.favoriteIds.length > 0 ||
    Object.keys(p.session.answers).length > 0 ||
    p.session.cursor > 0 ||
    p.settings.chapter > 0
  );
}

/** Revision-based synchronization: never write a snapshot read before a concurrent save. */
export function useCloudProgress(
  bank: Bank,
  user: User | null,
  progress: Progress,
  setProgress: Dispatch<SetStateAction<Progress>>,
  paused: boolean,
) {
  const [status, setStatus] = useState("未登录，仅在本设备保存");
  const [conflict, setConflict] = useState<Snapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [expired, setExpired] = useState(false);
  const latest = useRef(progress);
  const pause = useRef(paused);
  latest.current = progress;
  pause.current = paused;
  const state = useRef({
    revision: -1,
    ack: "",
    busy: false,
    conflict: false,
    dirty: false,
  });
  const run = useRef<() => Promise<void>>(async () => {});
  const retry = () => void run.current();
  const saveMeta = (revision: number, ack: string) => {
    state.current.revision = revision;
    state.current.ack = ack;
    if (user)
      try {
        localStorage.setItem(
          `${progressKey(user)}:sync`,
          JSON.stringify({ revision, ack }),
        );
      } catch {
        /* the progress cache reports local storage errors separately */
      }
  };
  useEffect(() => {
    if (!user) return;
    let disposed = false;
    const controller = new AbortController();
    const current = state.current;
    try {
      const meta = JSON.parse(
        localStorage.getItem(`${progressKey(user)}:sync`) || "null",
      );
      if (
        Number.isSafeInteger(meta?.revision) &&
        meta.revision >= 0 &&
        typeof meta.ack === "string"
      ) {
        current.revision = meta.revision;
        current.ack = meta.ack;
      }
    } catch {
      /* treat cache metadata as unknown and compare safely */
    }
    const call = (path: string, body?: unknown, method?: string) =>
      api(
        path,
        body,
        method,
        AbortSignal.any
          ? AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
          : controller.signal,
        user.id,
      );
    const readRemote = (raw: any): Snapshot => {
      if (!Number.isSafeInteger(raw?.revision) || raw.revision < 0)
        throw new Error("服务器进度版本无效。");
      return {
        revision: raw.revision,
        progress:
          raw.progress === null ? null : validateProgress(raw.progress, bank),
      };
    };
    const offer = (snapshot: Snapshot) => {
      current.conflict = true;
      setConflict(snapshot);
      setStatus("其他设备有不同进度，请选择保留版本");
    };
    const synchronize = async () => {
      if (disposed || current.busy || current.conflict || pause.current) return;
      current.busy = true;
      setPending(true);
      try {
        // A session may have changed in another tab. Do not send this user's cache
        // using a cookie that now belongs to a different account.
        const identity = await call("/api/auth/me");
        if (disposed) return;
        if (identity.user?.id !== user.id)
          throw new ApiError("登录已变化，请重新登录；本设备进度已保留。", 401);
        const remote = readRemote(await call("/api/progress"));
        if (disposed || pause.current) return;
        let local = JSON.stringify(latest.current);
        const other = remote.progress ? JSON.stringify(remote.progress) : "";
        if (other === local) saveMeta(remote.revision, local);
        else if (current.revision < 0) {
          if (remote.progress && hasLearning(latest.current)) {
            offer(remote);
            return;
          }
          if (remote.progress) {
            latest.current = remote.progress;
            setProgress(remote.progress);
            local = other;
          }
          saveMeta(remote.revision, remote.progress ? other : "");
        } else if (remote.revision !== current.revision) {
          if (local !== current.ack) {
            offer(remote);
            return;
          }
          if (remote.progress) {
            latest.current = remote.progress;
            setProgress(remote.progress);
            local = other;
          }
          saveMeta(remote.revision, local);
        }
        // Do not auto-upload a newly opened empty workspace to an empty account.
        if (
          local !== current.ack &&
          (remote.progress || hasLearning(latest.current))
        ) {
          const snapshot = latest.current;
          setStatus("正在保存到服务器…");
          try {
            const saved = await call(
              "/api/progress",
              { revision: current.revision, progress: snapshot },
              "PUT",
            );
            if (disposed) return;
            saveMeta(saved.revision, JSON.stringify(snapshot));
          } catch (error) {
            if (error instanceof ApiError && error.status === 409) {
              offer(readRemote(error.payload));
              return;
            }
            throw error;
          }
        }
        if (disposed) return;
        setExpired(false);
        const dirty =
          JSON.stringify(latest.current) !== current.ack &&
          hasLearning(latest.current);
        current.dirty = dirty;
        setStatus(
          dirty
            ? "本设备有修改，等待同步"
            : remote.progress || current.ack
              ? "已同步到服务器"
              : "账号已连接，作答后自动同步",
        );
      } catch (error) {
        if (disposed) return;
        const auth = error instanceof ApiError && error.status === 401;
        setExpired(auth);
        setStatus(
          auth ? error.message : "暂未同步，本设备已保留修改，联网后重试",
        );
      } finally {
        current.busy = false;
        if (!disposed) setPending(false);
      }
    };
    run.current = synchronize;
    void synchronize();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void synchronize();
    }, 5000);
    const resume = () => void synchronize();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      run.current = async () => {};
    };
  }, [bank, user?.id]);
  useEffect(() => {
    if (!user || paused) return;
    setStatus(
      state.current.conflict
        ? "其他设备有不同进度，请选择保留版本"
        : "本设备有修改，等待同步",
    );
    const timer = setTimeout(() => void run.current(), 600);
    return () => clearTimeout(timer);
  }, [progress, user?.id, paused]);
  const resolve = (useServer: boolean) => {
    if (!conflict) return;
    if (useServer && conflict.progress) {
      latest.current = conflict.progress;
      setProgress(conflict.progress);
    }
    saveMeta(
      conflict.revision,
      conflict.progress ? JSON.stringify(conflict.progress) : "",
    );
    state.current.conflict = false;
    setConflict(null);
    void run.current();
  };
  return { status, pending, conflict, expired, retry, resolve };
}
