import { useEffect, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  RotateCcw,
  Star,
  BookOpen,
} from "lucide-react";
import {
  gradeAnswer,
  type Answer,
  type Chapter,
  type GradeStatus,
  type Question,
} from "./domain";
import { Button, RemoteImage } from "./components";
import type { Session } from "./progress";

export function QuestionWorkspace({
  question: q,
  chapter,
  answer,
  result,
  favorite,
  onAnswer,
  onCheck,
  onRetry,
  onFavorite,
  onKnowledge,
  onPrevious,
  onNext,
  first,
  last,
}: {
  question: Question;
  chapter: Chapter;
  answer: Answer;
  result?: GradeStatus;
  favorite: boolean;
  onAnswer: (a: Answer) => void;
  onCheck: () => void;
  onRetry: () => void;
  onFavorite: () => void;
  onKnowledge: () => void;
  onPrevious: () => void;
  onNext: () => void;
  first: boolean;
  last: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const prior = useRef(q.id);
  useEffect(() => {
    if (prior.current !== q.id) {
      heading.current?.focus({ preventScroll: true });
      prior.current = q.id;
    }
  }, [q.id]);
  const selected = Array.isArray(answer) ? answer : answer ? [answer] : [];
  const choose = (key: string) =>
    onAnswer(
      q.kind === "multiple"
        ? selected.includes(key)
          ? selected.filter((x) => x !== key)
          : [...selected, key]
        : key,
    );
  const expected = gradeAnswer(q, answer).expected;
  const hasAnswer = Array.isArray(answer)
    ? answer.length > 0
    : answer.trim().length > 0;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.isComposing ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        document.querySelector("dialog[open]")
      )
        return;
      const target = e.target as HTMLElement;
      if (
        target.closest('textarea,select,[contenteditable="true"]') ||
        (target instanceof HTMLInputElement &&
          !["radio", "checkbox"].includes(target.type))
      )
        return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!last) onNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (!first) onPrevious();
      } else if (
        e.key === "Enter" &&
        !target.closest("button,a") &&
        !result &&
        (hasAnswer || q.gradingDisabled)
      ) {
        e.preventDefault();
        onCheck();
      } else if (/^[1-9]$/.test(e.key) && !result) {
        const option = q.options[Number(e.key) - 1];
        if (option) {
          e.preventDefault();
          choose(option.key);
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  return (
    <article className="question-workspace" aria-label={`原题 ${q.number}`}>
      <div className="question-meta">
        <span className="question-type">
          {q.type}
          {q.kind === "multiple" ? " · 多选" : ""}
        </span>
        <span className="original-number">
          原题 {String(q.number).padStart(3, "0")} · {chapter.title}
        </span>
        <Button
          variant="ghost"
          className="favorite-button"
          aria-pressed={favorite}
          onClick={onFavorite}
        >
          <Star size={20} fill={favorite ? "currentColor" : "none"} />
          {favorite ? "已收藏" : "收藏"}
        </Button>
      </div>
      <h2 className="question-title" ref={heading} tabIndex={-1}>
        {q.text}
      </h2>
      {q.extra.length > 0 && (
        <div className="question-extra">
          {q.extra.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      {q.images
        .filter((i) => i.role === "prompt")
        .map((i, n) => (
          <RemoteImage
            key={i.url}
            url={i.url}
            label={`原题 ${q.number} 题面图 ${n + 1}`}
          />
        ))}
      {q.options.length > 0 && (
        <fieldset className="options">
          <legend className="sr-only">
            {q.kind === "multiple" ? "选择所有正确选项" : "选择一个选项"}
          </legend>
          {q.options.map((option) => {
            const isSelected = selected.includes(option.key);
            const isExpected =
              !!result && result !== "manual" && expected.includes(option.key);
            return (
              <label
                key={option.key}
                className={`option ${isSelected ? "selected" : ""} ${isExpected ? "correct" : ""} ${result === "wrong" && isSelected && !isExpected ? "wrong" : ""} ${result ? "locked" : ""}`}
              >
                <input
                  type={q.kind === "multiple" ? "checkbox" : "radio"}
                  name={`answer-${q.id}`}
                  value={option.key}
                  checked={isSelected}
                  disabled={!!result}
                  onChange={() => choose(option.key)}
                />
                <span className="option-key">
                  {option.key === "正确"
                    ? "✓"
                    : option.key === "错误"
                      ? "×"
                      : option.key}
                </span>
                <span className="option-text">{option.label}</span>
                {isExpected && (
                  <span className="option-mark">
                    <Check size={18} />
                    <span className="sr-only">题库给定答案</span>
                  </span>
                )}
              </label>
            );
          })}
        </fieldset>
      )}
      {q.options.length === 0 && (
        <div className="written-answer">
          <label htmlFor="written-answer">
            {q.kind === "manual" ? "先写下你的思路（可选）" : "填写答案"}
          </label>
          <textarea
            className="resize-none"
            id="written-answer"
            maxLength={9999}
            rows={q.kind === "manual" ? 4 : 2}
            value={Array.isArray(answer) ? answer.join(" | ") : answer}
            onChange={(e) => onAnswer(e.target.value)}
            disabled={!!result}
            placeholder={
              q.kind === "manual"
                ? "看图、推导，再核对题库答案。"
                : "多个空按题目顺序，用 | 分隔。"
            }
          />
          <p className="field-help">
            {q.kind === "fill"
              ? "按题目要求填写；多空顺序参与判分。"
              : "此题仅作人工核对，不计入自动判分正确率。"}
          </p>
        </div>
      )}
      {q.gradingDisabled && (
        <p className="manual-notice">
          人工核对：{q.gradingReason ?? "本题无法可靠自动判分。"}
        </p>
      )}
      {!!result && (
        <section className={`feedback ${result}`} aria-live="polite">
          <div className="feedback-heading">
            <strong>
              {result === "correct"
                ? "回答正确"
                : result === "wrong"
                  ? "本题答错，已加入错题本"
                  : "请自行核对，本题不计入自动判分"}
            </strong>
            <Button variant="ghost" onClick={onRetry}>
              <RotateCcw size={16} />
              重新作答
            </Button>
          </div>
          <p className="given-answer">
            题库给定答案：<b>{q.answer.trim() || "见答案图"}</b>
          </p>
          {q.audit && (
            <div className="audit-note">
              <strong>题库核对提示</strong>
              <p>{q.audit.message}</p>
              {q.audit.reference && (
                <a
                  href={q.audit.reference}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看核对资料
                </a>
              )}
            </div>
          )}
          <h3>题库解析</h3>
          <p className="explanation">
            {q.explanation ||
              (q.images.some((i) => i.role === "answer")
                ? "题库提供了图片解析，请在下方查看。"
                : "题库未提供文字解析，可回看本章知识精讲。")}
          </p>
          {q.images
            .filter((i) => i.role === "answer")
            .map((i, n) => (
              <RemoteImage
                key={i.url}
                url={i.url}
                label={`原题 ${q.number} 答案图 ${n + 1}`}
              />
            ))}
          <Button variant="ghost" onClick={onKnowledge}>
            <BookOpen size={16} />
            回看本章精讲
          </Button>
        </section>
      )}
      <div className="question-actions">
        <div className="check-action">
          <Button
            variant="primary"
            onClick={onCheck}
            disabled={!!result || (!hasAnswer && !q.gradingDisabled)}
          >
            {result
              ? "已核对"
              : q.gradingDisabled
                ? "查看答案 / 人工核对"
                : "查看答案"}
          </Button>
          <span>选好后再核对，先独立判断。</span>
        </div>
        <div className="previous-next">
          <Button disabled={first} onClick={onPrevious}>
            <ArrowLeft size={16} />
            上一题
          </Button>
          <Button disabled={last} onClick={onNext}>
            下一题
            <ArrowRight size={16} />
          </Button>
        </div>
      </div>
      <p className="keyboard-hint">数字键选择 · Enter 核对 · ← → 切题</p>
    </article>
  );
}

export function AnswerRail({
  session,
  onJump,
  onFinish,
}: {
  session: Session;
  onJump: (index: number) => void;
  onFinish: () => void;
}) {
  const page = Math.floor(session.cursor / 30);
  const start = page * 30;
  const checked = Object.values(session.results).filter(
    (s) => s !== "unanswered",
  ).length;
  return (
    <aside className="answer-rail">
      <div className="answer-panel">
        <div className="rail-heading">
          <h2>答题卡</h2>
          <span>
            已核对 {checked} / {session.ids.length}
          </span>
        </div>
        <div className="answer-grid">
          {session.ids.slice(start, start + 30).map((id, i) => {
            const status =
              session.results[id] ||
              ((
                Array.isArray(session.answers[id])
                  ? session.answers[id].length
                  : (session.answers[id] || "").length
              )
                ? "selected"
                : "unanswered");
            return (
              <button
                key={id}
                className={`answer-cell ${status} ${session.cursor === start + i ? "current" : ""}`}
                aria-current={session.cursor === start + i ? "step" : undefined}
                aria-label={`本轮第 ${start + i + 1} 题，${{ correct: "正确", wrong: "错误", manual: "人工核对", selected: "已选", unanswered: "未答" }[status]}`}
                onClick={() => onJump(start + i)}
              >
                {start + i + 1}
              </button>
            );
          })}
        </div>
        {session.ids.length > 30 && (
          <div className="rail-pagination">
            <Button
              variant="ghost"
              aria-label="答题卡上一页"
              disabled={page === 0}
              onClick={() => onJump(Math.max(0, start - 30))}
            >
              <ArrowLeft size={16} />
            </Button>
            <span>
              {page + 1} / {Math.ceil(session.ids.length / 30)} 页
            </span>
            <Button
              variant="ghost"
              aria-label="答题卡下一页"
              disabled={start + 30 >= session.ids.length}
              onClick={() => onJump(start + 30)}
            >
              <ArrowRight size={16} />
            </Button>
          </div>
        )}
        <div className="answer-legend">
          <span>
            <i className="dot unanswered" />
            未答
          </span>
          <span>
            <i className="dot selected" />
            已选
          </span>
          <span>
            <i className="dot correct" />
            正确
          </span>
          <span>
            <i className="dot wrong" />
            错误
          </span>
        </div>
        <Button className="finish-button" onClick={onFinish}>
          结束本轮
        </Button>
      </div>
      <p className="study-tip">今天先完成一个章节，再回顾错题。</p>
    </aside>
  );
}
