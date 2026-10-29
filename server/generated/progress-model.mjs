import { filterQuestions, gradeAnswer, selectSession, } from "./domain.mjs";
export const STORAGE_KEY = "h12-821-practice-v1";
export function newSession(ids, mode = "practice") {
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
export function emptyProgress(bank) {
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
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
export function validateProgress(raw, bank) {
    if (!object(raw) ||
        raw.version !== 1 ||
        !object(raw.records) ||
        !Array.isArray(raw.favoriteIds) ||
        !object(raw.session) ||
        !object(raw.settings))
        throw new Error("文件格式不正确，请选择本网页导出的进度 JSON。");
    const ids = new Set(bank.questions.map((q) => q.id));
    const isIds = (v) => Array.isArray(v) &&
        v.every((id) => typeof id === "string" && ids.has(id)) &&
        new Set(v).size === v.length;
    const validStatuses = ["correct", "wrong", "manual"];
    if (!isIds(raw.favoriteIds) ||
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
            !["practice", "random", "wrong", "favorites"].includes(raw.session.mode)))
        throw new Error("进度中的题目或答题位置无效，未导入。");
    for (const [id, value] of Object.entries(raw.session.answers)) {
        if (!raw.session.ids.includes(id) ||
            !((typeof value === "string" && value.length < 10000) ||
                (Array.isArray(value) &&
                    value.length < 50 &&
                    value.every((s) => typeof s === "string" && s.length < 10000))))
            throw new Error("进度中的作答内容无效，未导入。");
    }
    for (const [id, value] of Object.entries(raw.session.results))
        if (!raw.session.ids.includes(id) ||
            typeof value !== "string" ||
            !validStatuses.includes(value))
            throw new Error("进度中的判分结果无效，未导入。");
    for (const [id, value] of Object.entries(raw.records)) {
        if (!ids.has(id) ||
            !object(value) ||
            ![value.attempts, value.correct, value.wrong].every((v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0) ||
            typeof value.wrongActive !== "boolean" ||
            typeof value.lastStatus !== "string" ||
            !validStatuses.includes(value.lastStatus) ||
            typeof value.lastAt !== "number" ||
            !Number.isFinite(value.lastAt))
            throw new Error("进度中的学习记录无效，未导入。");
    }
    const parsed = raw;
    const byId = new Map(bank.questions.map((q) => [q.id, q]));
    for (const [id, r] of Object.entries(parsed.records)) {
        const q = byId.get(id);
        const manual = q.gradingDisabled || q.kind === "manual";
        if (r.attempts < 1 ||
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
            (r.lastStatus === "wrong" && r.wrong < 1))
            throw new Error("进度中的学习记录与判分规则不一致，未导入。");
    }
    for (const [id, status] of Object.entries(parsed.session.results)) {
        if (gradeAnswer(byId.get(id), parsed.session.answers[id] || "").status !==
            status ||
            parsed.records[id]?.lastStatus !== status)
            throw new Error("进度中的判分结果与作答内容不一致，未导入。");
    }
    const s = raw.settings;
    if (typeof s.chapter !== "number" ||
        !Number.isInteger(s.chapter) ||
        (s.chapter !== 0 && !bank.chapters.some((c) => c.id === s.chapter)) ||
        typeof s.type !== "string" ||
        !["all", "single", "multiple", "judgment", "fill", "manual"].includes(s.type) ||
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
        ].includes(s.view))
        throw new Error("进度中的练习设置无效，未导入。");
    if (typeof raw.updatedAt !== "number" || !Number.isFinite(raw.updatedAt))
        throw new Error("进度时间无效，未导入。");
    if (raw.workspaces !== undefined) {
        if (!object(raw.workspaces) || Object.keys(raw.workspaces).length > 4)
            throw new Error("保存的练习模式无效。");
        for (const [mode, workspace] of Object.entries(raw.workspaces)) {
            if (!isPracticeView(mode) ||
                !object(workspace) ||
                !object(workspace.settings) ||
                workspace.settings.view !== mode ||
                !object(workspace.session) ||
                workspace.session.mode !== mode)
                throw new Error("保存的练习模式无效。");
            // Cached rounds are historical snapshots; later attempts may have changed
            // the latest record. Validate their answers against a matching record view.
            const records = { ...parsed.records };
            if (!object(workspace.session.results))
                throw new Error("保存的答题卡无效。");
            for (const [id, status] of Object.entries(workspace.session.results)) {
                const r = records[id];
                if (!r)
                    throw new Error("保存的题目缺少学习记录。");
                records[id] = {
                    ...r,
                    lastStatus: status,
                    wrongActive: status === "wrong",
                };
            }
            validateProgress({
                ...parsed,
                records,
                workspaces: undefined,
                settings: workspace.settings,
                session: workspace.session,
            }, bank);
        }
    }
    return raw;
}
export function isPracticeView(view) {
    return ["practice", "random", "wrong", "favorites"].includes(view);
}
export function matchingQuestions(bank, p, settings = p.settings) {
    const mode = isPracticeView(settings.view)
        ? settings.view
        : (p.session.mode ?? "practice");
    return filterQuestions(bank.questions, {
        chapter: settings.chapter || "all",
        kind: settings.type,
        query: settings.query,
        ids: mode === "wrong"
            ? new Set(Object.keys(p.records).filter((id) => p.records[id].wrongActive))
            : mode === "favorites"
                ? new Set(p.favoriteIds)
                : undefined,
    });
}
/** Apply filters and the round together, never leave an old chapter under a new selector. */
export function applyPracticeSettings(bank, p, patch, restart = false) {
    const settings = { ...p.settings, ...patch };
    const mode = isPracticeView(settings.view)
        ? settings.view
        : (p.session.mode ?? "practice");
    const ids = selectSession(matchingQuestions(bank, p, settings), settings.count || "all", mode === "random");
    const session = newSession(ids, mode);
    if (!restart) {
        const currentId = p.session.ids[p.session.cursor];
        session.cursor = Math.max(0, ids.indexOf(currentId));
        for (const id of ids) {
            if (p.session.answers[id] !== undefined)
                session.answers[id] = p.session.answers[id];
            if (p.session.results[id])
                session.results[id] = p.session.results[id];
        }
    }
    return { ...p, updatedAt: Date.now(), settings, session };
}
export function repairLegacySession(bank, p) {
    const eligible = new Set(filterQuestions(bank.questions, {
        chapter: p.settings.chapter || "all",
        kind: p.settings.type,
        query: p.settings.query,
    }).map((q) => q.id));
    if (p.session.ids.some((id) => !eligible.has(id)) ||
        (p.settings.count > 0 && p.session.ids.length > p.settings.count))
        return applyPracticeSettings(bank, p, {});
    return p;
}
export function navigateProgress(bank, p, next) {
    if (next === p.settings.view)
        return p;
    if (!isPracticeView(next))
        return { ...p, settings: { ...p.settings, view: next } };
    if (p.session.mode === next)
        return { ...p, settings: { ...p.settings, view: next } };
    const currentMode = p.session.mode ?? "practice";
    const workspaces = {
        ...p.workspaces,
        [currentMode]: {
            settings: { ...p.settings, view: currentMode },
            session: { ...p.session, mode: currentMode },
        },
    };
    const saved = workspaces[next];
    if (saved) {
        // Keep the original round stable even when a wrong answer was corrected.
        const results = Object.fromEntries(Object.entries(saved.session.results).filter(([id, status]) => p.records[id]?.lastStatus === status));
        return {
            ...p,
            workspaces,
            settings: saved.settings,
            session: { ...saved.session, results },
        };
    }
    return {
        ...applyPracticeSettings(bank, p, { chapter: 0, type: "all", count: 0, query: "", view: next }, true),
        workspaces,
    };
}
export function recordGrade(progress, id, status) {
    if (status === "unanswered")
        return progress;
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
                wrongActive: status === "manual" ? prev.wrongActive : status === "wrong",
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
