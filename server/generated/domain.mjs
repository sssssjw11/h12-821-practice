function normalizedText(text) {
    return text.normalize("NFKC").trim().replace(/\s+/g, "");
}
function splitFill(answer) {
    return Array.isArray(answer)
        ? answer.map(normalizedText)
        : answer
            .normalize("NFKC")
            .trim()
            .split(/[|,，;；\s]+/u)
            .map(normalizedText);
}
function choiceKeys(answer) {
    const joined = (Array.isArray(answer) ? answer.join("") : answer)
        .normalize("NFKC")
        .toUpperCase()
        .replace(/[\s,，;；|、]/gu, "");
    return [...new Set(joined.split(""))].sort();
}
function present(answer) {
    return Array.isArray(answer)
        ? answer.some((value) => value.trim() !== "")
        : answer.trim() !== "";
}
/** Exact set grading for choices; ordered grading for multiple fill-in blanks. */
export function gradeAnswer(question, answer = "") {
    const rawAnswer = question.answer;
    const expected = question.kind === "single" || question.kind === "multiple"
        ? choiceKeys(rawAnswer)
        : rawAnswer.split("|").map(normalizedText);
    const result = (status) => ({
        status,
        expected,
        rawAnswer,
    });
    if (question.gradingDisabled ||
        question.kind === "manual" ||
        !rawAnswer.trim() ||
        rawAnswer.trim() === "如图")
        return result("manual");
    if (!present(answer))
        return result("unanswered");
    if (question.kind === "single" || question.kind === "multiple") {
        const actual = choiceKeys(answer);
        const matches = actual.length === expected.length &&
            actual.every((key, index) => key === expected[index]);
        return result(matches ? "correct" : "wrong");
    }
    if (question.kind === "judgment") {
        const actual = normalizedText(Array.isArray(answer) ? answer.join("") : answer);
        return result(actual === expected[0] ? "correct" : "wrong");
    }
    const caseSensitive = /全大写|全小写|首字母大写/u.test(question.text);
    const compare = (value) => caseSensitive ? value : value.toLocaleLowerCase("en-US");
    const actual = expected.length > 1
        ? splitFill(answer)
        : [normalizedText(Array.isArray(answer) ? answer.join("") : answer)];
    return result(actual.length === expected.length &&
        actual.every((value, index) => compare(value) === compare(expected[index]))
        ? "correct"
        : "wrong");
}
export function filterQuestions(questions, filter = {}) {
    const query = (filter.query ?? "")
        .normalize("NFKC")
        .trim()
        .toLocaleLowerCase();
    return questions.filter((question) => (!filter.chapter ||
        filter.chapter === "all" ||
        question.chapter === filter.chapter) &&
        (!filter.kind ||
            filter.kind === "all" ||
            question.kind === filter.kind) &&
        (!filter.ids || filter.ids.has(question.id)) &&
        (!filter.autoGradableOnly || !question.gradingDisabled) &&
        (!query ||
            `${question.id} ${question.number} ${question.text} ${question.options.map((option) => option.label).join(" ")}`
                .toLocaleLowerCase()
                .includes(query)));
}
export function selectSession(questions, count, random = false, rng = Math.random) {
    const selected = [...questions].sort((left, right) => left.number - right.number);
    if (random) {
        for (let i = selected.length - 1; i > 0; i--) {
            const j = Math.floor(Math.min(0.999999999, Math.max(0, rng())) * (i + 1));
            [selected[i], selected[j]] = [selected[j], selected[i]];
        }
    }
    const length = count === "all"
        ? selected.length
        : Math.max(0, Math.min(selected.length, Math.floor(count)));
    return selected.slice(0, length).map((question) => question.id);
}
