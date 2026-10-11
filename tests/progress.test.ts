import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Bank } from "../src/domain";
import {
  emptyProgress,
  newSession,
  recordGrade,
  validateProgress,
} from "../src/progress";

const bank = JSON.parse(
  readFileSync(new URL("../public/bank.json", import.meta.url), "utf8"),
) as Bank;

function answeredProgress(
  answer = "D",
  status: "correct" | "wrong" = "correct",
) {
  const progress = emptyProgress(bank);
  progress.session = newSession(["821-Q003"]);
  progress.session.answers["821-Q003"] = answer;
  return recordGrade(progress, "821-Q003", status);
}

describe("persistent practice records", () => {
  it("round-trips a fresh workspace and a genuinely answered practice session", () => {
    const fresh = emptyProgress(bank);
    expect(validateProgress(JSON.parse(JSON.stringify(fresh)), bank)).toEqual(
      fresh,
    );
    const answered = answeredProgress();
    expect(
      validateProgress(JSON.parse(JSON.stringify(answered)), bank),
    ).toEqual(answered);
  });

  it("clears an active wrong question when a later attempt is correct, preserving history", () => {
    const wrong = answeredProgress("A", "wrong");
    expect(wrong.records["821-Q003"].wrongActive).toBe(true);
    const retry = { ...wrong, session: newSession(["821-Q003"]) };
    retry.session.answers["821-Q003"] = "D";
    const corrected = recordGrade(retry, "821-Q003", "correct");
    expect(corrected.records["821-Q003"]).toMatchObject({
      attempts: 2,
      correct: 1,
      wrong: 1,
      wrongActive: false,
      lastStatus: "correct",
    });
    expect(corrected.session.results["821-Q003"]).toBe("correct");
    expect(
      validateProgress(JSON.parse(JSON.stringify(corrected)), bank),
    ).toEqual(corrected);
    expect(wrong.records["821-Q003"].wrongActive).toBe(true);
  });

  it("keeps manual review outside correct and wrong counters", () => {
    const progress = emptyProgress(bank);
    progress.session = newSession(["821-Q468"]);
    const reviewed = recordGrade(progress, "821-Q468", "manual");
    expect(reviewed.records["821-Q468"]).toMatchObject({
      attempts: 1,
      correct: 0,
      wrong: 0,
      wrongActive: false,
      lastStatus: "manual",
    });
    expect(
      validateProgress(JSON.parse(JSON.stringify(reviewed)), bank),
    ).toEqual(reviewed);
    expect(recordGrade(progress, "821-Q468", "unanswered")).toBe(progress);
  });
});

describe("import validation", () => {
  it("rejects unknown, duplicate, or out-of-range current questions without changing the source", () => {
    const progress = emptyProgress(bank);
    const unknown = structuredClone(progress);
    unknown.favoriteIds = ["821-Q999"];
    expect(() => validateProgress(unknown, bank)).toThrow();
    const duplicate = structuredClone(progress);
    duplicate.session.ids = ["821-Q003", "821-Q003"];
    expect(() => validateProgress(duplicate, bank)).toThrow();
    const outOfRange = structuredClone(progress);
    outOfRange.session.cursor = progress.session.ids.length;
    expect(() => validateProgress(outOfRange, bank)).toThrow();
    expect(progress.favoriteIds).toEqual([]);
    expect(progress.session.cursor).toBe(0);
  });

  it("rejects malformed answer values, negative counters and unsupported settings", () => {
    const malformed = structuredClone(answeredProgress()) as unknown as Record<
      string,
      any
    >;
    malformed.session.answers["821-Q003"] = { option: "D" };
    expect(() => validateProgress(malformed, bank)).toThrow();
    const negative = answeredProgress();
    negative.records["821-Q003"].attempts = -1;
    expect(() => validateProgress(negative, bank)).toThrow();
    const settings = answeredProgress();
    settings.settings.count = 100;
    expect(() => validateProgress(settings, bank)).toThrow();
  });

  it("rejects scores that contradict stored answers or have no learning record", () => {
    const contradictory = answeredProgress();
    contradictory.session.answers["821-Q003"] = "A";
    expect(() => validateProgress(contradictory, bank)).toThrow();
    const noRecord = answeredProgress();
    noRecord.records = {};
    expect(() => validateProgress(noRecord, bank)).toThrow();
    const unanswered = emptyProgress(bank);
    unanswered.session.results["821-Q003"] = "unanswered";
    expect(() => validateProgress(unanswered, bank)).toThrow();
  });

  it("rejects impossible history counters and unresolved state inconsistent with the latest grade", () => {
    const counters = answeredProgress();
    counters.records["821-Q003"].correct = 10;
    expect(() => validateProgress(counters, bank)).toThrow();
    const active = answeredProgress();
    active.records["821-Q003"].wrongActive = true;
    expect(() => validateProgress(active, bank)).toThrow();
    const sourceDispute = emptyProgress(bank);
    sourceDispute.session = newSession(["821-Q052"]);
    sourceDispute.session.answers["821-Q052"] = "A";
    const incorrectScoring = recordGrade(sourceDispute, "821-Q052", "correct");
    expect(() => validateProgress(incorrectScoring, bank)).toThrow();
  });
});
