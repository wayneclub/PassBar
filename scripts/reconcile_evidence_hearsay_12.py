#!/usr/bin/env python3
"""Reconcile the one verified official-exam conflict in Evidence/Hearsay #12."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "out/Evidence/Hearsay/Evidence_Hearsay_enriched.json"
QUESTION_PREFIX = "A defendant was indicted for engaging in a fraudulent investment scheme."
SOURCE_FILE = "formal test/210-Questions.pdf"
SOURCE_SHA256 = "3a721505df3b5b211d7119994ef0e0e3b57bff0a003c2f77dc0a6a787a01f309"

EN_EXPLANATION = """<!doctype html>
<html lang=\"en\"><head><meta charset=\"UTF-8\"><title>Explanation</title></head>
<body><div class=\"pbx-explanation\">
<h2>Former testimony of an unavailable declarant</h2>
<p><strong>Choice C is correct.</strong> Former testimony is admissible under FRE 804(b)(1) when the declarant is unavailable and the testimony is offered against a party that previously had an opportunity and similar motive to examine the declarant.</p>
<p>Here, the testimony was given in the defendant's criminal trial and is now offered against the same defendant. His attorney cross-examined the witness at the criminal trial, satisfying the opportunity-and-similar-motive requirement. The question treats the witness who moved abroad as unavailable.</p>
<p><strong>Choice D is incorrect.</strong> It is not necessary to show that the investor was unable to obtain the witness's testimony by deposition. For former testimony, Rule 804(a)(5)(A) addresses inability to procure the declarant's attendance by process or other reasonable means; it does not impose a separate deposition prerequisite.</p>
<p><strong>Choice A</strong> is wrong because the different burden of proof does not itself bar former testimony. <strong>Choice B</strong> is wrong because the relevant question is whether the party against whom the testimony is offered had the requisite opportunity and similar motive, not whether all parties are identical.</p>
<p><strong>Educational Objective:</strong> Apply FRE 804(b)(1) by checking former testimony, unavailability, and the opposing party's prior opportunity and similar motive to examine the witness.</p>
</div></body></html>"""

ZH_EXPLANATION = """<!doctype html>
<html lang=\"zh-Hans\"><head><meta charset=\"UTF-8\"><title>MBE 考点解析</title></head>
<body><div class=\"pbx-explanation\">
<h2>无法出庭陈述人的先前证言</h2>
<p><strong>正确答案是 C。</strong>FRE 804(b)(1) 允许使用无法出庭陈述人的先前证言，前提是该证言现被用于对抗先前有机会、且有类似动机询问该证人的一方。</p>
<p>本题中，证言来自被告先前的刑事审判，现又被用于对抗同一被告；被告律师在刑事案中已经交叉询问过证人，满足机会与类似动机要件。题目将移居国外的证人视为无法出庭。</p>
<p><strong>D 错在多加了 deposition 条件。</strong>先前证言规则并不要求投资人先证明无法通过 deposition 取得证词。对先前证言，Rule 804(a)(5)(A) 讨论的是无法以程序或其他合理方式取得证人出庭，而不是必须先无法取得 deposition。</p>
<p>A 错，因为刑事与民事的证明标准不同本身不排除先前证言；B 错，因为关键不是所有当事人是否完全相同，而是被用于对抗的一方是否曾有机会与类似动机询问证人。</p>
</div></body></html>"""


def main() -> None:
    document = json.loads(PATH.read_text(encoding="utf-8"))
    item = next(question for question in document["questions"] if question["index"] == 12)
    if not item["question"].startswith(QUESTION_PREFIX):
        raise RuntimeError("Evidence/Hearsay #12 no longer contains the verified conflict question.")

    item["choices"]["D"] = (
        "Yes, but only if the investor demonstrates that she was unable to obtain "
        "the testimony of the witness by deposition."
    )
    item["answer"] = "C"
    item["explanation"] = EN_EXPLANATION
    item["zh-choices"]["D"] = "是，但前提是投资人证明无法通过证言笔录取得该证人的证词。"
    item["zh-explanation"] = ZH_EXPLANATION

    item["tags"] = sorted(set(item.get("tags", [])) | {"official_exam"})
    item["formal_test_provenance"] = [{
        "source_file": SOURCE_FILE,
        "source_question_number": 16,
        "source_sha256": SOURCE_SHA256,
        "source_type": "ncbe-210-study-aid",
    }]

    analysis = item.setdefault("meta", {}).setdefault("question_analysis", {})
    analysis["micro_concept"] = "former testimony of an unavailable declarant"
    analysis["trap_type"] = "added deposition prerequisite"
    analysis["skill_tested"] = "applying FRE 804(b)(1) former-testimony requirements"
    analysis["official_exam_reconciled_at"] = datetime.now(timezone.utc).isoformat()

    document["meta"]["updatedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    backup = PATH.with_suffix(PATH.suffix + ".before-official-exam-reconciliation.bak")
    if not backup.exists():
        backup.write_text(PATH.read_text(encoding="utf-8"), encoding="utf-8")
    temporary = PATH.with_suffix(PATH.suffix + ".tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    reloaded = json.loads(temporary.read_text(encoding="utf-8"))
    fixed = next(question for question in reloaded["questions"] if question["index"] == 12)
    assert fixed["answer"] == "C"
    assert fixed["choices"]["D"].endswith("by deposition.")
    assert "official_exam" in fixed["tags"]
    os.replace(temporary, PATH)
    print(f"Reconciled {PATH.relative_to(ROOT)}#12: answer {fixed['answer']}")


if __name__ == "__main__":
    main()
