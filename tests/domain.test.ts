import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  filterQuestions,
  gradeAnswer,
  selectSession,
  type Bank,
} from "../src/domain";

const bank = JSON.parse(
  readFileSync(new URL("../public/bank.json", import.meta.url), "utf8"),
) as Bank;
const question = (number: number) =>
  bank.questions.find((item) => item.number === number)!;

describe("source coverage and provenance", () => {
  it("contains every technical original question, without advertising records", () => {
    expect(bank.questions).toHaveLength(485);
    expect(bank.chapters).toHaveLength(21);
    expect(bank.questions.map((item) => item.number)).toEqual(
      Array.from({ length: 485 }, (_, i) => i + 3),
    );
    expect(new Set(bank.questions.map((item) => item.id)).size).toBe(485);
    expect(
      bank.chapters.reduce((total, chapter) => total + chapter.count, 0),
    ).toBe(485);
    expect(JSON.stringify(bank)).not.toMatch(
      /(?<![a-zA-Z])[A-Z]:[\\/]|老-纪-私-题-库/u,
    );
    expect(question(99).text).toContain("购买VPN服务");
    expect(question(437).text).toContain("用户购买设备");
  });
  it("retains original image roles and answer caveats", () => {
    expect(bank.questions.flatMap((item) => item.images)).toHaveLength(156);
    expect(question(4).images[0].role).toBe("answer");
    expect(question(468).images.map((image) => image.role)).toEqual([
      "prompt",
      "answer",
    ]);
    expect(bank.questions.filter((item) => item.audit)).toHaveLength(25);
    expect(bank.questions.filter((item) => !item.gradingDisabled)).toHaveLength(
      461,
    );
  });

  it("removes the reviewed Q447 answer prefix while retaining legitimate protocol names", () => {
    expect(question(447).text).toMatch(/^PIM网络/u);
    expect(question(447).text).not.toMatch(/^SPT\s/u);
    expect(question(447).answer).toBe("SPT");
    expect(question(447).text).toContain("PIM-DM和PIM-SM");
    expect(question(456).text).toContain("STP交换机");
    expect(question(449).text).toContain("Atomci-aggregate属性");
  });
});

describe("grading based on original question types", () => {
  it("grades actual single choice Q3 and rejects multiple selected values", () => {
    expect(gradeAnswer(question(3), "D").status).toBe("correct");
    expect(gradeAnswer(question(3), ["A", "D"]).status).toBe("wrong");
    expect(gradeAnswer(question(3), "").status).toBe("unanswered");
  });
  it("requires the complete choice set, regardless of selection order", () => {
    const multiple = bank.questions.find(
      (item) => item.kind === "multiple" && item.answer === "AC",
    )!;
    expect(gradeAnswer(multiple, ["C", "A"]).status).toBe("correct");
    expect(gradeAnswer(multiple, ["A"]).status).toBe("wrong");
    expect(gradeAnswer(multiple, ["A", "B", "C"]).status).toBe("wrong");
  });
  it("grades original judgment labels and never hides a dubious answer", () => {
    expect(gradeAnswer(question(313), "错误").status).toBe("correct");
    expect(gradeAnswer(question(313), "正确").status).toBe("wrong");
    for (const number of [52, 188, 237, 399]) {
      expect(
        gradeAnswer(question(number), question(number).answer).status,
      ).toBe("manual");
      expect(gradeAnswer(question(number), "").rawAnswer).toBe(
        question(number).answer,
      );
    }
  });
  it("checks explicit capitalization requirements and preserves ordered blanks", () => {
    expect(gradeAnswer(question(447), "SPT").status).toBe("correct");
    expect(gradeAnswer(question(447), "spt").status).toBe("wrong");
    expect(gradeAnswer(question(451), "Master").status).toBe("correct");
    expect(gradeAnswer(question(451), "master").status).toBe("wrong");
    expect(gradeAnswer(question(452), "255，254，0，0，0").status).toBe(
      "correct",
    );
    expect(gradeAnswer(question(453), ["26", "32"]).status).toBe("correct");
    expect(gradeAnswer(question(453), ["32", "26"]).status).toBe("wrong");
    expect(gradeAnswer(question(453), "26").status).toBe("wrong");
  });
  it("accepts equivalent width and case for the IPv6 formatting question", () => {
    expect(
      gradeAnswer(question(457), "fc00:0:130f::9c0:876a:130b").status,
    ).toBe("correct");
    expect(
      gradeAnswer(question(457), "FC00：0：130F：：9C0：876A：130B").status,
    ).toBe("correct");
  });
  it("keeps all diagram answers outside automatic scoring", () => {
    for (let number = 468; number <= 487; number++) {
      expect(gradeAnswer(question(number), "自行核对").status).toBe("manual");
    }
  });
});

describe("filtered practice sessions", () => {
  it("searches original numbers and narrows to the selected chapter", () => {
    expect(
      filterQuestions(bank.questions, { query: "821-Q003" }).map(
        (item) => item.number,
      ),
    ).toEqual([3]);
    expect(filterQuestions(bank.questions, { chapter: 3 })).toHaveLength(47);
    expect(
      filterQuestions(bank.questions, { chapter: 3, kind: "fill" }).map(
        (item) => item.number,
      ),
    ).toEqual([452]);
    expect(
      filterQuestions(bank.questions, { query: "不存在的虚构测试词" }),
    ).toEqual([]);
  });
  it("creates ordered or randomized sessions without mutating the bank", () => {
    const before = bank.questions.map((item) => item.id);
    expect(selectSession(bank.questions, 3)).toEqual([
      "821-Q003",
      "821-Q004",
      "821-Q005",
    ]);
    const randomized = selectSession(bank.questions, "all", true, () => 0.35);
    expect(randomized).not.toEqual(before);
    expect(new Set(randomized).size).toBe(485);
    expect(bank.questions.map((item) => item.id)).toEqual(before);
    expect(selectSession([], 20)).toEqual([]);
  });
});
