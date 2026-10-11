"""Build the web bank from the reviewed 821 catalog, without modifying source files."""

from __future__ import annotations

import argparse
import ast
import json
import re
from pathlib import Path
from urllib.parse import urlsplit


def load_audits(path: Path) -> dict[int, dict]:
    tree = ast.parse(path.read_text(encoding="utf-8-sig"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "audits"
            for target in node.targets
        ):
            return {
                number: {"kind": kind, "message": message, **({"reference": url} if url else {})}
                for number, kind, message, _chapter, url in ast.literal_eval(node.value)
            }
    raise ValueError("Reviewed audit records were not found")


def clean_advertisement(text: str) -> str:
    # Remove only the identifiable seller promotion found in Q344, not legitimate
    # technical uses of words such as '购买' in license or MPLS VPN questions.
    return re.sub(r"需要题库[，,:：\s]*老[-－—]?纪[-－—]?私[-－—]?题[-－—]?库.*$", "", text).strip()


def clean_question(original: dict) -> str:
    text = clean_advertisement(original["question"])
    # DOCX body paragraph 2605 literally starts "447.SPT PIM网络...";
    # the next paragraph separately gives "答案：SPT". This one reviewed
    # source typo leaks the blank's answer. Do not remove answer-like words
    # generically: other questions legitimately mention protocol terms.
    if original["number"] == 447 and original["answer"] == "SPT" and text.startswith("SPT PIM网络"):
        return text.removeprefix("SPT ")
    return text


def safe_image(url: str) -> bool:
    parsed = urlsplit(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc) and not parsed.username


def build(source_dir: Path, output: Path) -> dict:
    catalog = json.loads((source_dir / "catalog.json").read_text(encoding="utf-8"))
    outline = json.loads((source_dir / "learning_outline.json").read_text(encoding="utf-8"))
    audits = load_audits(source_dir / "build_learning_pack.py")
    kind_map = {"单选题": "single", "多选题": "multiple", "判断题": "judgment", "填空题": "fill"}
    # These source answers contradict the protocol or the question's configuration
    # view. Preserve the raw answer for review but never treat it as a scoring key.
    disputed = {52, 188, 237, 399}
    questions = []
    for original in catalog["questions"]:
        options = []
        for option in original["options"]:
            match = re.fullmatch(r"([A-Z])[.．、:：)）]\s*(.*)", option, flags=re.S)
            if not match:
                raise ValueError(f"Unrecognized option in {original['id']}")
            options.append({"key": match[1], "label": clean_advertisement(match[2])})
        kind = kind_map.get(original["type"], "manual")
        if kind == "judgment":
            options = [{"key": "正确", "label": "正确"}, {"key": "错误", "label": "错误"}]
        answer = original["answer"]
        disabled = original["number"] in disputed or kind == "manual" or not answer.strip() or answer.strip() == "如图"
        item = {
            "id": original["id"],
            "number": original["number"],
            "chapter": original["chapter"],
            "type": original["type"],
            "kind": kind,
            "text": clean_question(original),
            "options": options,
            "answer": answer,
            "explanation": clean_advertisement(original["explanation"]),
            "extra": [clean_advertisement(value) for value in original["extra"]],
            "images": [
                {"url": image["target"], "role": image["role"]}
                for image in original["images"]
                if safe_image(image["target"]) and image["role"] in {"prompt", "answer"}
            ],
            "gradingDisabled": disabled,
        }
        if original["number"] in audits:
            item["audit"] = audits[original["number"]]
        if disabled:
            item["gradingReason"] = "原题答案存在矛盾，暂不自动判分" if original["number"] in disputed else "原题为图形或主观答案，请对照解析自行复核"
        questions.append(item)

    chapters = []
    for original in outline["chapters"]:
        lesson = Path(original["lesson_file"]).read_text(encoding="utf-8")
        # The local source-reference appendix belongs to the desktop learning pack.
        # The web app already maps every chapter to its original numbered questions.
        lesson = lesson.split("<!-- question-references -->", 1)[0].rstrip()
        if re.search(r"(?<![A-Za-z])[A-Za-z]:[/\\]", lesson):
            raise ValueError(f"Local path remains in chapter {original['chapter']}")
        chapters.append({
            "id": original["chapter"],
            "title": original["title"],
            "count": original["primary_question_count"],
            "priority": original["priority"],
            "day": original["recommended_day"],
            "minutes": original["first_read_minutes"],
            "sections": original["knowledge_sections"],
            "lesson": lesson,
        })

    assert len(questions) == 485
    assert {q["number"] for q in questions} == set(range(3, 488))
    assert len({q["id"] for q in questions}) == 485
    assert len(chapters) == 21
    assert sum(c["count"] for c in chapters) == 485
    for chapter in chapters:
        assert len([q for q in questions if q["chapter"] == chapter["id"]]) == chapter["count"]
    assert sum(len(q["images"]) for q in questions) == 156
    assert all(q["chapter"] in range(1, 22) for q in questions)
    for question in questions:
        if question["kind"] in {"single", "multiple"}:
            assert set(question["answer"]) <= {o["key"] for o in question["options"]}
    result = {
        "version": 1,
        "title": "H12-821 数通刷题",
        "source": {"name": catalog["sources"][0]["file"], "sha256": catalog["sources"][0]["sha256"]},
        "chapters": chapters,
        "questions": questions,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[3] / "821全知识学习")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "bank.json")
    args = parser.parse_args()
    bank = build(args.source, args.output)
    print(json.dumps({"questions": len(bank["questions"]), "chapters": len(bank["chapters"]), "autoGradable": sum(not q["gradingDisabled"] for q in bank["questions"]), "images": sum(len(q["images"]) for q in bank["questions"]), "audits": sum("audit" in q for q in bank["questions"])}, ensure_ascii=False))
