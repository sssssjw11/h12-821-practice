import { useEffect, useRef, useState } from "react";
import type { Bank } from "./domain";
import {
  STORAGE_KEY,
  emptyProgress,
  validateProgress,
  repairLegacySession,
  type Progress,
} from "./progress-model";
export * from "./progress-model";

export function useProgress(bank: Bank, storageKey = STORAGE_KEY) {
  const [warning, setWarning] = useState("");
  const [conflict, setConflict] = useState<Progress | null>(null);
  const enabled = useRef(true);
  const [progress, setProgress] = useState<Progress>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw
        ? repairLegacySession(bank, validateProgress(JSON.parse(raw), bank))
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
      localStorage.setItem(storageKey, JSON.stringify(progress));
    } catch {
      setWarning("浏览器存储不可用，进度尚未保存。请用“导出进度”备份。");
    }
  }, [progress, conflict, storageKey]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return;
      try {
        const incoming = validateProgress(JSON.parse(event.newValue), bank);
        // Device clocks can differ; distinct snapshots need an explicit choice.
        if (JSON.stringify(incoming) !== JSON.stringify(progress))
          setConflict(incoming);
      } catch {
        setWarning("其他页面写入了无效进度，当前练习已保留。");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [bank, progress, storageKey]);
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
