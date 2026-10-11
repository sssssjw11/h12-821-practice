import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Network,
  Shuffle,
  FileText,
  Star,
  ChartNoAxesColumn,
  Upload,
  Download,
  Search,
  X,
  Check,
  ArrowRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  filterQuestions,
  gradeAnswer,
  selectSession,
  type Bank,
  type QuestionKind,
} from "./domain";
import { Button, EmptyState, Modal } from "./components";
import { AnswerRail, QuestionWorkspace } from "./Quiz";
import {
  emptyProgress,
  exportProgress,
  newSession,
  recordGrade,
  useProgress,
  validateProgress,
  type Progress,
  type View,
} from "./progress";

const navigation = [
  { view: "practice" as View, label: "章节练习", Icon: BookOpen },
  { view: "random" as View, label: "随机练习", Icon: Shuffle },
  { view: "wrong" as View, label: "错题本", Icon: FileText },
  { view: "favorites" as View, label: "收藏题", Icon: Star },
  { view: "knowledge" as View, label: "知识精讲", Icon: BookOpen },
  { view: "stats" as View, label: "学习数据", Icon: ChartNoAxesColumn },
];
const kindLabels: Record<QuestionKind, string> = {
  single: "单选题",
  multiple: "多选题",
  judgment: "判断题",
  fill: "填空题",
  manual: "图形 / 主观题",
};

export default function App() {
  const [bank, setBank] = useState<Bank | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    setError("");
    fetch("/bank.json", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data: Bank) => {
        if (
          data.version !== 1 ||
          !Array.isArray(data.questions) ||
          data.questions.length !== 485 ||
          !Array.isArray(data.chapters) ||
          data.chapters.length !== 21
        )
          throw new Error();
        setBank(data);
      })
      .catch(() => {
        if (
          !controller.signal.aborted ||
          !controller.signal.reason?.toString().includes("unmounted")
        )
          setError("题库加载失败。请确认本地服务已启动，再重试。");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      controller.abort("unmounted");
      clearTimeout(timer);
    };
  }, [retry]);
  if (!bank)
    return (
      <div className="boot-screen">
        <Network size={42} />
        <h1>821 刷题</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button variant="primary" onClick={() => setRetry((n) => n + 1)}>
              重新加载题库
            </Button>
          </>
        ) : (
          <p role="status">正在准备 485 道题…</p>
        )}
      </div>
    );
  return <PracticeApp bank={bank} />;
}

function PracticeApp({ bank }: { bank: Bank }) {
  const {
    progress: p,
    setProgress,
    warning,
    conflict,
    resolveConflict,
    enableSaving,
  } = useProgress(bank);
  const [notice, setNotice] = useState("");
  const [importError, setImportError] = useState("");
  const [modal, setModal] = useState<"result" | "reset" | "import" | null>(
    null,
  );
  const [pendingImport, setPendingImport] = useState<Progress | null>(null);
  const [lessonId, setLessonId] = useState(bank.chapters[0].id);
  const priorView = useRef<View>(p.session.mode ?? "practice");
  const file = useRef<HTMLInputElement>(null);
  const s = p.settings;
  const view = s.view;
  const current = p.session;
  const byId = useMemo(
    () => new Map(bank.questions.map((q) => [q.id, q])),
    [bank],
  );
  const wrongIds = useMemo(
    () =>
      new Set(
        Object.entries(p.records)
          .filter(([, r]) => r.wrongActive)
          .map(([id]) => id),
      ),
    [p.records],
  );
  const favorites = useMemo(() => new Set(p.favoriteIds), [p.favoriteIds]);
  const filtered = useMemo(
    () =>
      filterQuestions(bank.questions, {
        chapter: s.chapter || "all",
        kind: s.type as QuestionKind | "all",
        query: s.query,
        ids:
          view === "wrong"
            ? wrongIds
            : view === "favorites"
              ? favorites
              : undefined,
      }),
    [bank, s.chapter, s.type, s.query, view, wrongIds, favorites],
  );
  const q = byId.get(current.ids[current.cursor]);
  const chapter = bank.chapters.find((c) => c.id === q?.chapter);
  const heading = navigation.find((n) => n.view === view)!.label;
  useEffect(() => {
    document.title = `${heading} · 821 刷题`;
  }, [heading]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const update = (fn: (prev: Progress) => Progress) =>
    setProgress((prev) => ({ ...fn(prev), updatedAt: Date.now() }));
  const navigate = (next: View) => {
    if (next === "knowledge" || next === "stats") {
      if (view !== "knowledge" && view !== "stats") priorView.current = view;
      update((prev) => ({
        ...prev,
        settings: { ...prev.settings, view: next },
      }));
      return;
    }
    if (view === "knowledge" || view === "stats") {
      if (next === priorView.current) {
        update((prev) => ({
          ...prev,
          settings: { ...prev.settings, view: next },
        }));
        return;
      }
    }
    if (next === view) return;
    const ids = bank.questions.filter((q) =>
      next === "wrong"
        ? wrongIds.has(q.id)
        : next === "favorites"
          ? favorites.has(q.id)
          : true,
    );
    update((prev) => ({
      ...prev,
      settings: { chapter: 0, type: "all", count: 0, query: "", view: next },
      session: newSession(selectSession(ids, "all", next === "random"), next),
    }));
  };
  const start = () => {
    update((prev) => ({
      ...prev,
      session: newSession(
        selectSession(filtered, s.count || "all", view === "random"),
        view,
      ),
    }));
    setNotice(
      `已开始本轮，共 ${s.count ? Math.min(s.count, filtered.length) : filtered.length} 道题。`,
    );
  };
  const jump = (cursor: number) =>
    update((prev) => ({ ...prev, session: { ...prev.session, cursor } }));
  const check = () => {
    if (!q || current.results[q.id]) return;
    const result = gradeAnswer(q, current.answers[q.id] || "");
    if (result.status === "unanswered") return;
    update((prev) => recordGrade(prev, q.id, result.status));
  };
  const finish = () => {
    update((prev) => ({
      ...prev,
      session: { ...prev.session, completed: true },
    }));
    setModal("result");
  };
  const openKnowledge = () => {
    if (q) setLessonId(q.chapter);
    priorView.current = view;
    update((prev) => ({
      ...prev,
      settings: { ...prev.settings, view: "knowledge" },
    }));
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5_000_000) {
      setNotice("进度文件过大，请选择本网页导出的 JSON。");
      return;
    }
    try {
      setPendingImport(validateProgress(JSON.parse(await f.text()), bank));
      setImportError("");
      setModal("import");
    } catch (e) {
      setImportError(
        e instanceof SyntaxError
          ? "文件不是有效的 JSON。请选择本网页导出的学习进度文件，现有进度已保留。"
          : e instanceof Error && /[\u4e00-\u9fff]/.test(e.message)
            ? e.message
            : "进度文件读取失败，现有进度已保留。请重新选择文件。",
      );
    } finally {
      if (file.current) file.current.value = "";
    }
  };
  const sessionResults = Object.values(current.results);
  const correct = sessionResults.filter((r) => r === "correct").length;
  const wrong = sessionResults.filter((r) => r === "wrong").length;
  const manual = sessionResults.filter((r) => r === "manual").length;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <svg
            width="38"
            height="44"
            viewBox="0 0 50 58"
            fill="none"
            aria-hidden="true"
          >
            <path d="M9 46 25 17 41 46" stroke="currentColor" strokeWidth="3" />
            <g fill="var(--color-ink)" stroke="currentColor" strokeWidth="3">
              <circle cx="9" cy="46" r="6" />
              <circle cx="25" cy="17" r="6" />
              <circle cx="41" cy="46" r="6" />
            </g>
          </svg>
          <span>821 刷题</span>
        </div>
        <nav aria-label="主导航">
          {navigation.map(({ view: v, label, Icon }) => (
            <button
              key={v}
              className={`nav-item ${view === v ? "active" : ""}`}
              aria-current={view === v ? "page" : undefined}
              onClick={() => navigate(v)}
            >
              <Icon size={23} />
              <span>{label}</span>
              {v === "wrong" && wrongIds.size > 0 && (
                <span className="nav-count">{wrongIds.size}</span>
              )}
            </button>
          ))}
        </nav>
        <p className="local-progress">进度保存在此浏览器</p>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <span>H12-821 数通知识练习</span>
          <Button
            onClick={() => {
              exportProgress(p);
              setNotice("进度已导出，请保留下载的 JSON 文件。");
            }}
            aria-label="导出进度"
          >
            <Upload size={19} />
            <span>导出进度</span>
          </Button>
        </header>
        {importError && (
          <div className="global-banner" role="alert">
            {importError}
            <Button onClick={() => file.current?.click()}>重新选择文件</Button>
            <Button
              variant="ghost"
              aria-label="关闭导入错误提示"
              onClick={() => setImportError("")}
            >
              <X size={17} />
            </Button>
          </div>
        )}
        {warning && (
          <div className="global-banner" role="alert">
            {warning}
            <Button onClick={enableSaving}>重试本地保存</Button>
          </div>
        )}
        {conflict && (
          <div className="global-banner" role="alert">
            另一个页面更新了学习进度。请选择要保留的版本。
            <Button onClick={() => resolveConflict(true)}>读取其他页面</Button>
            <Button onClick={() => resolveConflict(false)}>保留本页进度</Button>
          </div>
        )}
        <main
          className={`page ${view === "knowledge" ? "knowledge-page" : ""}`}
        >
          {view === "knowledge" ? (
            <Knowledge
              bank={bank}
              lessonId={lessonId}
              setLessonId={setLessonId}
              onPractice={(id) => {
                priorView.current = "practice";
                update((prev) => ({
                  ...prev,
                  settings: {
                    chapter: id,
                    type: "all",
                    count: 0,
                    query: "",
                    view: "practice",
                  },
                  session: newSession(
                    bank.questions
                      .filter((q) => q.chapter === id)
                      .map((q) => q.id),
                  ),
                }));
              }}
              onReturn={() => navigate(priorView.current)}
            />
          ) : view === "stats" ? (
            <Stats
              bank={bank}
              progress={p}
              onImport={() => file.current?.click()}
              onReset={() => setModal("reset")}
            />
          ) : (
            <>
              <div className="practice-layout">
                <div className="practice-content">
                  <div className="page-heading">
                    <h1>{heading}</h1>
                    <p>
                      {view === "wrong"
                        ? `待订正 ${wrongIds.size} 道 · 答对后自动移出待订正`
                        : view === "favorites"
                          ? `已收藏 ${favorites.size} 道 · 集中回顾你标记的重点`
                          : "485 道题 · 21 个章节"}
                    </p>
                  </div>
                  <form
                    className="practice-toolbar"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      start();
                    }}
                  >
                    <label className="sr-only" htmlFor="chapter-filter">
                      练习章节
                    </label>
                    <select
                      id="chapter-filter"
                      value={s.chapter}
                      onChange={(e) =>
                        update((prev) => ({
                          ...prev,
                          settings: {
                            ...prev.settings,
                            chapter: Number(e.target.value),
                          },
                        }))
                      }
                    >
                      <option value={0}>全部章节</option>
                      {bank.chapters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {String(c.id).padStart(2, "0")} {c.title}（{c.count}）
                        </option>
                      ))}
                    </select>
                    <label className="sr-only" htmlFor="type-filter">
                      题型筛选
                    </label>
                    <select
                      id="type-filter"
                      value={s.type}
                      onChange={(e) =>
                        update((prev) => ({
                          ...prev,
                          settings: { ...prev.settings, type: e.target.value },
                        }))
                      }
                    >
                      <option value="all">全部题型</option>
                      {Object.entries(kindLabels).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <label className="sr-only" htmlFor="count-filter">
                      本轮题量
                    </label>
                    <select
                      id="count-filter"
                      value={s.count}
                      onChange={(e) =>
                        update((prev) => ({
                          ...prev,
                          settings: {
                            ...prev.settings,
                            count: Number(e.target.value),
                          },
                        }))
                      }
                    >
                      <option value={0}>全部题目</option>
                      {[10, 20, 50].map((n) => (
                        <option value={n} key={n}>
                          {n} 道题
                        </option>
                      ))}
                    </select>
                    <div className="search-field">
                      <Search size={18} />
                      <label className="sr-only" htmlFor="question-search">
                        搜索题干或原题号
                      </label>
                      <input
                        id="question-search"
                        type="search"
                        value={s.query}
                        placeholder="搜索题干 / 原题号"
                        maxLength={500}
                        onChange={(e) =>
                          update((prev) => ({
                            ...prev,
                            settings: {
                              ...prev.settings,
                              query: e.target.value,
                            },
                          }))
                        }
                      />
                      {s.query && (
                        <button
                          type="button"
                          aria-label="清除搜索"
                          onClick={() =>
                            update((prev) => ({
                              ...prev,
                              settings: { ...prev.settings, query: "" },
                            }))
                          }
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={filtered.length === 0}
                    >
                      开始练习
                    </Button>
                  </form>
                  {(s.chapter ||
                    s.type !== "all" ||
                    s.query ||
                    s.count > 0) && (
                    <div className="filter-summary" role="status">
                      {filtered.length ? (
                        `符合条件 ${filtered.length} 道，点击“开始练习”更新本轮。`
                      ) : (
                        <>
                          没有符合条件的题目，当前练习已保留。
                          <Button
                            variant="ghost"
                            onClick={() =>
                              update((prev) => ({
                                ...prev,
                                settings: {
                                  ...prev.settings,
                                  chapter: 0,
                                  type: "all",
                                  query: "",
                                },
                              }))
                            }
                          >
                            清空筛选
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                  {q && chapter ? (
                    <>
                      <div className="session-progress">
                        <progress
                          value={current.cursor + 1}
                          max={current.ids.length}
                          aria-label="本轮题目位置"
                        />
                        <span>
                          第 {current.cursor + 1} / {current.ids.length} 题
                          {current.completed && (
                            <button
                              className="result-link"
                              onClick={() => setModal("result")}
                            >
                              查看本轮结果
                            </button>
                          )}
                        </span>
                      </div>
                      <QuestionWorkspace
                        question={q}
                        chapter={chapter}
                        answer={current.answers[q.id] || ""}
                        result={current.results[q.id]}
                        favorite={favorites.has(q.id)}
                        onAnswer={(answer) =>
                          update((prev) => ({
                            ...prev,
                            session: {
                              ...prev.session,
                              answers: {
                                ...prev.session.answers,
                                [q.id]: answer,
                              },
                            },
                          }))
                        }
                        onCheck={check}
                        onRetry={() =>
                          update((prev) => {
                            const results = { ...prev.session.results };
                            delete results[q.id];
                            return {
                              ...prev,
                              session: {
                                ...prev.session,
                                results,
                                completed: false,
                              },
                            };
                          })
                        }
                        onFavorite={() => {
                          update((prev) => ({
                            ...prev,
                            favoriteIds: favorites.has(q.id)
                              ? prev.favoriteIds.filter((id) => id !== q.id)
                              : [...prev.favoriteIds, q.id],
                          }));
                          setNotice(
                            favorites.has(q.id)
                              ? "已取消收藏。"
                              : "已收藏，可在“收藏题”集中回顾。",
                          );
                        }}
                        onKnowledge={openKnowledge}
                        onPrevious={() => jump(Math.max(0, current.cursor - 1))}
                        onNext={() =>
                          jump(
                            Math.min(
                              current.ids.length - 1,
                              current.cursor + 1,
                            ),
                          )
                        }
                        first={current.cursor === 0}
                        last={current.cursor === current.ids.length - 1}
                      />
                    </>
                  ) : (
                    <EmptyState
                      title={
                        view === "wrong"
                          ? "目前没有待订正的错题"
                          : view === "favorites"
                            ? "还没有收藏题目"
                            : "本轮没有题目"
                      }
                      description={
                        view === "wrong"
                          ? "开始练习后，答错的题会自动收录在这里。"
                          : view === "favorites"
                            ? "做题时点击“收藏”，下次在这里集中回顾。"
                            : "调整章节、题型或搜索词，再开始练习。"
                      }
                      action={
                        <Button
                          variant="primary"
                          onClick={() => navigate("practice")}
                        >
                          去章节练习
                          <ArrowRight size={16} />
                        </Button>
                      }
                    />
                  )}
                </div>
                {q && (
                  <AnswerRail
                    session={current}
                    onJump={jump}
                    onFinish={finish}
                  />
                )}
              </div>
            </>
          )}
        </main>
        <div
          className={`toast ${notice ? "visible" : ""}`}
          role="status"
          aria-live="polite"
        >
          {notice}
        </div>
      </div>
      <input
        className="sr-only"
        ref={file}
        type="file"
        accept=".json,application/json"
        aria-label="选择学习进度文件"
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {modal === "result" && (
        <Modal title="本轮练习结果" onClose={() => setModal(null)}>
          <div className="result-stats">
            <div>
              <b>{correct}</b>
              <span>正确</span>
            </div>
            <div>
              <b>{wrong}</b>
              <span>错误</span>
            </div>
            <div>
              <b>{current.ids.length - sessionResults.length}</b>
              <span>未核对</span>
            </div>
            <div>
              <b>{manual}</b>
              <span>人工核对</span>
            </div>
          </div>
          <p>
            自动判分正确率：
            <strong>
              {correct + wrong
                ? `${Math.round((correct / (correct + wrong)) * 100)}%`
                : "暂无"}
            </strong>
            （仅计算已核对且可判分的题）。
          </p>
          <p className="muted">
            错题已保存；未核对题仍可继续作答。结果依据题库给定答案，争议题不计分。
          </p>
          <div className="modal-actions">
            <Button onClick={() => setModal(null)}>继续本轮</Button>
            <Button
              variant="primary"
              disabled={wrongIds.size === 0}
              onClick={() => {
                setModal(null);
                navigate("wrong");
              }}
            >
              去订正错题
            </Button>
          </div>
        </Modal>
      )}
      {modal === "reset" && (
        <Modal title="清空此浏览器的学习进度？" onClose={() => setModal(null)}>
          <p>将清空作答记录、错题、收藏和当前练习。建议先导出备份。</p>
          <div className="modal-actions">
            <Button onClick={() => setModal(null)}>保留进度</Button>
            <Button onClick={() => exportProgress(p)}>先导出备份</Button>
            <Button
              variant="danger"
              onClick={() => {
                setProgress(emptyProgress(bank));
                setModal(null);
                setNotice("学习进度已清空。");
              }}
            >
              清空进度
            </Button>
          </div>
        </Modal>
      )}
      {modal === "import" && pendingImport && (
        <Modal
          title="替换为导入的学习进度？"
          onClose={() => {
            setModal(null);
            setPendingImport(null);
          }}
        >
          <p>
            导入文件包含 {Object.keys(pendingImport.records).length}{" "}
            道题的学习记录、{pendingImport.favoriteIds.length}{" "}
            道收藏。导入后会替换此浏览器现有进度。
          </p>
          <div className="modal-actions">
            <Button
              onClick={() => {
                setModal(null);
                setPendingImport(null);
              }}
            >
              取消导入
            </Button>
            <Button onClick={() => exportProgress(p)}>备份现有进度</Button>
            <Button
              variant="primary"
              onClick={() => {
                setProgress({ ...pendingImport, updatedAt: Date.now() });
                setPendingImport(null);
                setModal(null);
                setNotice("进度已导入，可继续上次练习。");
              }}
            >
              替换并导入
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Knowledge({
  bank,
  lessonId,
  setLessonId,
  onPractice,
  onReturn,
}: {
  bank: Bank;
  lessonId: number;
  setLessonId: (id: number) => void;
  onPractice: (id: number) => void;
  onReturn: () => void;
}) {
  const chapter = bank.chapters.find((c) => c.id === lessonId)!;
  return (
    <>
      <div className="page-heading knowledge-heading">
        <div>
          <h1>知识精讲</h1>
          <p>21 章完整精讲 · 按知识点理解，再用题目检验</p>
        </div>
        <Button onClick={onReturn}>返回练习</Button>
      </div>
      <div className="knowledge-layout">
        <nav className="chapter-list" aria-label="精讲章节">
          {bank.chapters.map((c) => (
            <button
              key={c.id}
              className={c.id === lessonId ? "active" : ""}
              aria-current={c.id === lessonId ? "page" : undefined}
              onClick={() => {
                setLessonId(c.id);
                window.scrollTo({ top: 0, behavior: "instant" });
              }}
            >
              <span>{String(c.id).padStart(2, "0")}</span>
              <span>
                {c.title}
                <small>
                  {c.count} 道题 · {c.priority}
                </small>
              </span>
            </button>
          ))}
        </nav>
        <article className="lesson">
          <div className="lesson-actions">
            <span>
              建议第 {chapter.day} 天学习 · 首读约 {chapter.minutes} 分钟
            </span>
            <Button variant="primary" onClick={() => onPractice(chapter.id)}>
              练习本章 {chapter.count} 道题
            </Button>
          </div>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) =>
                href?.startsWith("http") ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ) : (
                  <span>{children}</span>
                ),
            }}
          >
            {chapter.lesson}
          </ReactMarkdown>
          <Button variant="primary" onClick={() => onPractice(chapter.id)}>
            开始本章练习
            <ArrowRight size={16} />
          </Button>
        </article>
      </div>
    </>
  );
}
function Stats({
  bank,
  progress: p,
  onImport,
  onReset,
}: {
  bank: Bank;
  progress: Progress;
  onImport: () => void;
  onReset: () => void;
}) {
  const records = Object.values(p.records);
  const attempts = records.reduce((sum, r) => sum + r.correct + r.wrong, 0);
  const correct = records.reduce((sum, r) => sum + r.correct, 0);
  return (
    <>
      <div className="page-heading">
        <h1>学习数据</h1>
        <p>记录练习与订正；做过的题数不等于已掌握。</p>
      </div>
      <div className="stats-summary">
        <div>
          <strong>
            {records.length}
            <small> / 485</small>
          </strong>
          <span>已核对题目</span>
        </div>
        <div>
          <strong>{records.filter((r) => r.wrongActive).length}</strong>
          <span>待订正错题</span>
        </div>
        <div>
          <strong>
            {attempts ? `${Math.round((correct / attempts) * 100)}%` : "—"}
          </strong>
          <span>累计自动判分正确率</span>
        </div>
      </div>
      <div className="data-actions">
        <Button onClick={onImport}>
          <Download size={17} />
          导入进度
        </Button>
        <span>换浏览器或清理数据前，先导出备份。</span>
      </div>
      <div className="chapter-table-wrap">
        <table className="chapter-table">
          <caption className="sr-only">21 章练习进度</caption>
          <thead>
            <tr>
              <th scope="col">知识章节</th>
              <th scope="col">已核对 / 全章</th>
              <th scope="col">待订正</th>
              <th scope="col">覆盖进度</th>
            </tr>
          </thead>
          <tbody>
            {bank.chapters.map((c) => {
              const qs = bank.questions.filter((q) => q.chapter === c.id);
              const done = qs.filter((q) => p.records[q.id]).length;
              const wrong = qs.filter(
                (q) => p.records[q.id]?.wrongActive,
              ).length;
              return (
                <tr key={c.id}>
                  <th scope="row">
                    <span className="mono">
                      {String(c.id).padStart(2, "0")}
                    </span>
                    {c.title}
                  </th>
                  <td>
                    {done} / {c.count}
                  </td>
                  <td>{wrong || "—"}</td>
                  <td>
                    <progress
                      value={done}
                      max={c.count}
                      aria-label={`${c.title}已核对 ${done} 道，共 ${c.count} 道`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="data-footnote">
        <p>
          461 道题可自动判分，20 道图形题和 4
          道争议题仅人工核对。知识精讲不自动标记为掌握。
        </p>
        <Button variant="danger" onClick={onReset}>
          清空学习进度
        </Button>
      </div>
    </>
  );
}
