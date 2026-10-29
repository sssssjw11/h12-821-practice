import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Bank } from "../src/domain";
import {
  applyPracticeSettings,
  emptyProgress,
  navigateProgress,
  recordGrade,
  repairLegacySession,
  validateProgress,
} from "../src/progress-model";
const bank = JSON.parse(
  readFileSync(new URL("../public/bank.json", import.meta.url), "utf8"),
) as Bank;
describe("chapter and mode navigation", () => {
  it("applies chapter, type and count to the active round atomically", () => {
    let p = emptyProgress(bank);
    p = applyPracticeSettings(bank, p, { chapter: 3 });
    expect(p.session.ids).toHaveLength(47);
    expect(
      p.session.ids.every(
        (id) => bank.questions.find((q) => q.id === id)?.chapter === 3,
      ),
    ).toBe(true);
    p = applyPracticeSettings(bank, p, { type: "fill" });
    expect(p.session.ids).toEqual(["821-Q452"]);
    p = applyPracticeSettings(bank, p, { type: "all", count: 10 });
    expect(p.session.ids).toHaveLength(10);
  });
  it("restores the selected chapter, answer and cursor when returning from other modes or lessons", () => {
    let p = applyPracticeSettings(bank, emptyProgress(bank), { chapter: 3 });
    p.session.cursor = 2;
    const id = p.session.ids[2];
    p.session.answers[id] = bank.questions.find((q) => q.id === id)!.answer;
    p.favoriteIds = [id];
    const previous = structuredClone(p);
    p = navigateProgress(bank, p, "favorites");
    p = navigateProgress(bank, p, "knowledge");
    p = navigateProgress(bank, p, "practice");
    expect(p.settings).toEqual(previous.settings);
    expect(p.session).toEqual(previous.session);
    expect(validateProgress(p, bank)).toEqual(p);
    const inLesson = navigateProgress(bank, p, "knowledge");
    expect(navigateProgress(bank, inLesson, "practice").session).toEqual(
      p.session,
    );
  });
  it("does not move or remove the current wrong question immediately after correction", () => {
    let p = emptyProgress(bank);
    p.session.answers["821-Q003"] = "A";
    p = recordGrade(p, "821-Q003", "wrong");
    p = navigateProgress(bank, p, "wrong");
    p.session.answers["821-Q003"] = "D";
    p = recordGrade(p, "821-Q003", "correct");
    expect(p.session.ids).toEqual(["821-Q003"]);
    p = navigateProgress(bank, p, "practice");
    expect(p.session.results["821-Q003"]).toBeUndefined();
    expect(validateProgress(p, bank)).toEqual(p);
  });
  it("repairs old chapter-selector / active-round mismatches without clearing history", () => {
    const p = emptyProgress(bank);
    p.settings.chapter = 3;
    p.favoriteIds = ["821-Q003"];
    const repaired = repairLegacySession(bank, p);
    expect(repaired.session.ids).toHaveLength(47);
    expect(repaired.favoriteIds).toEqual(p.favoriteIds);
  });
  it("keeps searches and empty filters within the selected chapter", () => {
    let p = applyPracticeSettings(bank, emptyProgress(bank), {
      chapter: 3,
      query: "不存在的测试词",
    });
    expect(p.session.ids).toEqual([]);
    p = applyPracticeSettings(bank, p, { query: "" });
    expect(p.session.ids).toHaveLength(47);
    expect(p.settings.chapter).toBe(3);
  });
});
