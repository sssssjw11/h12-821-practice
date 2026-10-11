import { useEffect, useRef, useState } from "react";
import {
  gradeAnswer,
  type Answer,
  type Bank,
  type GradeStatus,
} from "./domain";

export type View =
  "practice" | "random" | "wrong" | "favorites" | "knowledge" | "stats";
export interface RecordEntry {
  attempts: number;
  correct: number;
  wrong: number;
  wrongActive: boolean;
  lastStatus: GradeStatus;
  lastAt: number;
}
export interface Session {
  mode?: "practice" | "random" | "wrong" | "favorites";
  ids: string[];
  cursor: number;
  answers: Record<string, Answer>;
  results: Record<string, GradeStatus>;
  startedAt: number;
  completed: boolean;
}
export interface Progress {
  version: 1;
  updatedAt: number;
  records: Record<string, RecordEntry>;
  favoriteIds: string[];
  session: Session;
  settings: {
    chapter: number;
    type: string;
    count: number;
    query: string;
    view: View;
  };
}
export const STORAGE_KEY = "h12-821-practice-v1";
export function newSession(ids: string[], mode: View = "practice"): Session {
  return {
    mode: mode === "knowledge" || mode === "stats" ? "practice" : mode,
    ids,
    cursor: 0,
    answers: {},
    results: {},
    startedAt: Date.now(),
    completed: false,
  };
}
export function emptyProgress(bank: Bank): Progress {
  return {
    version: 1,
    updatedAt: Date.now(),
    records: {},
    favoriteIds: [],
    session: newSession(bank.questions.map((q) => q.id)),
    settings: {
      chapter: 0,
      type: "all",
      count: 0,
      query: "",
      view: "practice",
    },
  };
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function validateProgress(raw: unknown, bank: Bank): Progress {
  if (
    !object(raw) ||
    raw.version !== 1 ||
    !object(raw.records) ||
    !Array.isArray(raw.favoriteIds) ||
    !object(raw.session) ||
    !object(raw.settings)
  )
    throw new Error("文件格式不正确，请选择本网页导出的进度 JSON。");
  const ids = new Set(bank.questions.map((q) => q.id));
  const isIds = (v: unknown): v is string[] =>
    Array.isArray(v) &&
    v.every((id) => typeof id === "string" && ids.has(id)) &&
    new Set(v).size === v.length;
  const validStatuses = ["correct", "wrong", "manual"];
  if (
    !isIds(raw.favoriteIds) ||
    !isIds(raw.session.ids) ||
    !object(raw.session.answers) ||
    !object(raw.session.results) ||
    typeof raw.session.cursor !== "number" ||
    !Number.isInteger(raw.session.cursor) ||
    raw.session.cursor < 0 ||
    raw.session.cursor >= Math.max(1, raw.session.ids.length) ||
    typeof raw.session.completed !== "boolean" ||
    typeof raw.session.startedAt !== "number" ||
    !Number.isFinite(raw.session.startedAt) ||
    (raw.session.mode !== undefined &&
      !["practice", "random", "wrong", "favorites"].includes(
        raw.session.mode as string,
      ))
  )
    throw new Error("进度中的题目或答题位置无效，未导入。");
  for (const [id, value] of Object.entries(raw.session.answers)) {
    if (
      !raw.session.ids.includes(id) ||
      !(
        (typeof value === "string" && value.length < 10000) ||
        (Array.isArray(value) &&
          value.length < 50 &&
          value.every((s) => typeof s === "string" && s.length < 10000))
      )
    )
      throw new Error("进度中的作答内容无效，未导入。");
  }
  for (const [id, value] of Object.entries(raw.session.results))
    if (
      !raw.session.ids.includes(id) ||
      typeof value !== "string" ||
      !validStatuses.includes(value)
    )
      throw new Error("进度中的判分结果无效，未导入。");
  for (const [id, value] of Object.entries(raw.records)) {
    if (
      !ids.has(id) ||
      !object(value) ||
      ![value.attempts, value.correct, value.wrong].every(
        (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0,
      ) ||
      typeof value.wrongActive !== "boolean" ||
      typeof value.lastStatus !== "string" ||
      !validStatuses.includes(value.lastStatus) ||
      typeof value.lastAt !== "number" ||
      !Number.isFinite(value.lastAt)
    )
      throw new Error("进度中的学习记录无效，未导入。");
  }
  const parsed = raw as unknown as Progress;
  const byId = new Map(bank.questions.map((q) => [q.id, q]));
  for (const [id, r] of Object.entries(parsed.records)) {
    const q = byId.get(id)!;
    const manual = q.gradingDisabled || q.kind === "manual";
    if (
      r.attempts < 1 ||
      r.correct + r.wrong > r.attempts ||
      (manual &&
        (r.lastStatus !== "manual" ||
          r.correct !== 0 ||
          r.wrong !== 0 ||
          r.wrongActive)) ||
      (!manual &&
        (r.lastStatus === "manual" ||
          r.correct + r.wrong !== r.attempts ||
          r.wrongActive !== (r.lastStatus === "wrong"))) ||
      (r.lastStatus === "correct" && r.correct < 1) ||
      (r.lastStatus === "wrong" && r.wrong < 1)
    )
      throw new Error("进度中的学习记录与判分规则不一致，未导入。");
  }
  for (const [id, status] of Object.entries(parsed.session.results)) {
    if (
      gradeAnswer(byId.get(id)!, parsed.session.answers[id] || "").status !==
        status ||
      parsed.records[id]?.lastStatus !== status
    )
      throw new Error("进度中的判分结果与作答内容不一致，未导入。");
  }
  const s = raw.settings;
  if (
    typeof s.chapter !== "number" ||
    !Number.isInteger(s.chapter) ||
    (s.chapter !== 0 && !bank.chapters.some((c) => c.id === s.chapter)) ||
    typeof s.type !== "string" ||
    !["all", "single", "multiple", "judgment", "fill", "manual"].includes(
      s.type,
    ) ||
    typeof s.count !== "number" ||
    ![0, 10, 20, 50].includes(s.count) ||
    typeof s.query !== "string" ||
    s.query.length > 500 ||
    ![
      "practice",
      "random",
      "wrong",
      "favorites",
      "knowledge",
      "stats",
    ].includes(s.view as string)
  )
    throw new Error("进度中的练习设置无效，未导入。");
  if (typeof raw.updatedAt !== "number" || !Number.isFinite(raw.updatedAt))
    throw new Error("进度时间无效，未导入。");
  return raw as unknown as Progress;
}
export function recordGrade(
  progress: Progress,
  id: string,
  status: GradeStatus,
): Progress {
  if (status === "unanswered") return progress;
  const prev = progress.records[id] ?? {
    attempts: 0,
    correct: 0,
    wrong: 0,
    wrongActive: false,
    lastStatus: "unanswered",
    lastAt: 0,
  };
  return {
    ...progress,
    updatedAt: Date.now(),
    records: {
      ...progress.records,
      [id]: {
        attempts: prev.attempts + 1,
        correct: prev.correct + Number(status === "correct"),
        wrong: prev.wrong + Number(status === "wrong"),
        wrongActive:
          status === "manual" ? prev.wrongActive : status === "wrong",
        lastStatus: status,
        lastAt: Date.now(),
      },
    },
    session: {
      ...progress.session,
      results: { ...progress.session.results, [id]: status },
    },
  };
}
export function useProgress(bank: Bank) {
  const [warning, setWarning] = useState("");
  const [conflict, setConflict] = useState<Progress | null>(null);
  const enabled = useRef(true);
  const [progress, setProgress] = useState<Progress>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw
        ? validateProgress(JSON.parse(raw), bank)
        : emptyProgress(bank);
    } catch {
      enabled.current = false;
      return emptyProgress(bank);
    }
  });
  useEffect(() => {
    if (!enabled.current) {
      setWarning(
        "无法读取或保存浏览器进度。当前练习可以继续，请用“导出进度”备份。",
      );
      return;
    }
    if (conflict) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      setWarning("浏览器存储不可用，进度尚未保存。请用“导出进度”备份。");
    }
  }, [progress, conflict]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const incoming = validateProgress(JSON.parse(event.newValue), bank);
        if (incoming.updatedAt > progress.updatedAt) setConflict(incoming);
      } catch {
        setWarning("其他页面写入了无效进度，当前练习已保留。");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [bank, progress.updatedAt]);
  return {
    progress,
    setProgress,
    warning,
    conflict,
    resolveConflict: (incoming: boolean) => {
      if (incoming && conflict) setProgress(conflict);
      else setProgress((p) => ({ ...p, updatedAt: Date.now() }));
      setConflict(null);
    },
    enableSaving: () => {
      enabled.current = true;
      setWarning("");
      setProgress((p) => ({ ...p, updatedAt: Date.now() }));
    },
  };
}
export function exportProgress(progress: Progress) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(progress, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  const date = new Date();
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  link.download = `821学习进度-${localDate}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
