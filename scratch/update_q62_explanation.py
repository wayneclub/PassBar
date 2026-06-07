import json
from pathlib import Path

json_path = Path("/Users/wayneclub/PassBar/out/Evidence/Presentation of Evidence/Presentation of Evidence_castudy_enriched.json")
data = json.loads(json_path.read_text(encoding="utf-8"))

html_content = """<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Explanation</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 1rem;
      line-height: 1.7;
      color: #333333;
    }

    .pbx-explanation {
      padding: 1.25rem 1.5rem;
      box-sizing: border-box;
    }

    .pbx-explanation p {
      margin-top: 0;
      margin-bottom: 1.25rem;
    }

    .pbx-explanation strong {
      font-weight: 700;
    }

    /* Term/Tooltip styling */
    .pbx-term {
      color: #3498db;
      cursor: help;
      position: relative;
      font-weight: 500;
      text-decoration: underline dotted #3498db;
    }

    .pbx-term .pbx-tooltip {
      visibility: hidden;
      width: 280px;
      background-color: #2c3e50;
      color: #fff;
      text-align: left;
      border-radius: 6px;
      padding: 10px 12px;
      position: absolute;
      z-index: 10;
      bottom: 125%;
      left: 50%;
      transform: translateX(-50%);
      opacity: 0;
      transition: opacity 0.2s;
      box-shadow: 0 4px 15px rgba(0,0,0,0.15);
      font-size: 0.85rem;
      font-weight: normal;
      line-height: 1.45;
      pointer-events: none;
    }

    .pbx-term:hover .pbx-tooltip,
    .pbx-term:focus-within .pbx-tooltip {
      visibility: visible;
      opacity: 1;
    }

    .pbx-term .pbx-tooltip::after {
      content: "";
      position: absolute;
      top: 100%;
      left: 50%;
      margin-left: -5px;
      border-width: 5px;
      border-style: solid;
      border-color: #2c3e50 transparent transparent transparent;
    }

    /* Educational Objective style */
    .pbx-edu-objective {
      background: #f0f7ff;
      border-left: 4px solid #3498db;
      border-radius: 6px;
      padding: 14px 18px;
      margin: 24px 0;
      box-sizing: border-box;
      width: 100%;
    }

    .pbx-edu-objective-title {
      font-size: 13px;
      font-weight: 700;
      color: #2980b9;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }

    /* References style */
    .pbx-references {
      background: #fafafa;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 14px 18px;
      margin: 20px 0;
      box-sizing: border-box;
      width: 100%;
    }

    .pbx-references-title {
      font-size: 13px;
      font-weight: 700;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }

    .pbx-ref-list {
      margin: 0;
      padding-left: 18px;
      font-size: 14px;
      color: #555;
      line-height: 1.7;
    }

    .pbx-ref-list li {
      margin-bottom: 6px;
    }

    .pbx-ref-list li:last-child {
      margin-bottom: 0;
    }

    /* Tables styling */
    .pbx-scroll-x {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      margin: 16px 0;
    }

    .pbx-explanation table {
      min-width: 480px;
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #cccccc;
      margin-bottom: 1.5rem;
    }

    .pbx-explanation th {
      border: 1px solid #cccccc;
      padding: 8px 12px;
      background: #f5f5f5;
      font-weight: bold;
      text-align: center;
    }

    .pbx-explanation td {
      border: 1px solid #cccccc;
      padding: 8px 12px;
    }

    /* Mobile responsive styles */
    @media (max-width: 640px) {
      body {
        font-size: 0.95rem;
        padding: 0.75rem;
      }

      .pbx-explanation {
        padding: 0.875rem 1rem;
      }
      
      .pbx-explanation th, 
      .pbx-explanation td {
        font-size: 0.825rem;
        padding: 0.5em 0.625em;
      }

      .pbx-term .pbx-tooltip {
        width: 240px;
        left: auto;
        right: 0;
        transform: none;
      }

      .pbx-term .pbx-tooltip::after {
        left: auto;
        right: 20px;
      }
    }
  </style>
</head>
<body>
<!-- pbx-topic: Opinion testimony -->
<div class="pbx-explanation">
  <div class="pbx-scroll-x">
    <table>
      <thead>
        <tr>
          <th colspan="3" style="text-align: center; font-size: 1.05rem;">Witness testimony</th>
        </tr>
        <tr>
          <th></th>
          <th>Fact testimony</th>
          <th>Opinion testimony</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="font-weight: bold; text-align: center; vertical-align: middle; background-color: #fafafa;">Lay witness</td>
          <td rowspan="2" style="text-align: center; vertical-align: middle; padding: 12px;">Personal knowledge of factual matter</td>
          <td style="vertical-align: top; padding: 12px;">
            Prohibited unless common-sense impression that:
            <ul style="margin: 6px 0 0 0; padding-left: 20px; list-style-type: disc;">
              <li style="margin-bottom: 4px;">is rationally based on witness's perception</li>
              <li style="margin-bottom: 4px;">helps clarify witness's testimony or fact issue <em>and</em></li>
              <li>is not based on scientific/technical/specialized knowledge</li>
            </ul>
          </td>
        </tr>
        <tr>
          <td style="font-weight: bold; text-align: center; vertical-align: middle; background-color: #fafafa;">Expert witness</td>
          <td style="vertical-align: top; padding: 12px;">
            Admissible from qualified* expert who:
            <ul style="margin: 6px 0 0 0; padding-left: 20px; list-style-type: disc;">
              <li style="margin-bottom: 4px;">testifies based on sufficient facts or data acquired by reliable principles &amp; methods</li>
              <li style="margin-bottom: 4px;">has reasonable degree of certainty in opinion <em>and</em></li>
              <li>helps trier of fact understand evidence or fact issue</li>
            </ul>
          </td>
        </tr>
        <tr>
          <td colspan="3" style="font-size: 0.85rem; color: #555; background-color: #fafafa; padding: 8px 12px;">
            *Has knowledge, skill, experience, training, or education in substantive area.
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <p>A <strong>lay witness</strong> can generally <strong>testify</strong> to any relevant matter based on his/her <strong>personal knowledge</strong>. This includes both:</p>
  <ul style="margin: 0 0 1.25rem 0; padding-left: 1.25rem; list-style-type: disc;">
    <li style="margin-bottom: 0.5rem;">factual matters that the witness <strong>perceived firsthand</strong>—eg, "I saw a man holding a beer bottle and slurring his words" <em>and</em></li>
    <li><strong>common-sense impressions</strong> that are rationally based on those perceptions—eg, "The man was drunk."</li>
  </ul>

  <p style="border-left: 3px solid #27ae60; padding-left: 10px;" data-choice="A" data-choice-role="correct">Here, the defendant seeks to testify that the plaintiff received much larger amounts of cash than those recorded in a ledger. And since this testimony is based on the defendant's firsthand knowledge—her memory of the cash amounts she gave—it is admissible.</p>

  <p style="border-left: 3px solid #c0392b; padding-left: 10px;" data-choice="B" data-choice-role="distractor"><strong style="color: #9b1c1c;">(Choice B)</strong> The defendant's testimony is admissible—regardless of whether the ledger had been offered by the plaintiff (the party-opponent)—because that testimony is relevant and based on her personal knowledge.</p>

  <p style="border-left: 3px solid #c0392b; padding-left: 10px;" data-choice="C" data-choice-role="distractor"><strong style="color: #9b1c1c;">(Choice C)</strong> An <span class="pbx-term">adoptive admission<span class="pbx-tooltip">采纳性承认 (Adoptive Admission): 对方当事人对他人陈述的默认或承认，使其可以作为非传闻证据被采纳。</span></span> is a hearsay exception that allows the admission of another's statement that a party-opponent has adopted as his/her own. Therefore, the defendant's failure to challenge the accuracy of the ledger may constitute an adoptive admission if a reasonable person would have done so. But this rule does not preclude the defendant's testimony rebutting the ledger's contents.</p>

  <p style="border-left: 3px solid #c0392b; padding-left: 10px;" data-choice="D" data-choice-role="distractor"><strong style="color: #9b1c1c;">(Choice D)</strong> The <span class="pbx-term">best evidence rule<span class="pbx-tooltip">最佳证据规则 (Best Evidence Rule): 要求提供原始书面文件、录音或照片以证明其内容。但如果不用于证明内容，则不适用。</span></span> generally requires that an original writing, recording, or photograph (eg, the ledger) be admitted to <em>prove</em> its contents. But this rule does not affect the admissibility of the defendant's testimony to <em>rebut</em> the ledger's contents.</p>

  <div class="pbx-edu-objective">
    <div class="pbx-edu-objective-title">📌 Educational Objective</div>
    <p>A lay witness can generally testify to any relevant matter based on the witness's personal knowledge or a common-sense impression that is rationally based on such knowledge.</p>
  </div>

  <div class="pbx-references">
    <div class="pbx-references-title">📚 References</div>
    <ul class="pbx-ref-list">
      <li>Fed. R. Evid. 602 (personal knowledge requirement).</li>
      <li>Fed. R. Evid. 701 (opinion testimony by lay witnesses).</li>
    </ul>
  </div>
</div>
</body>
</html>"""

# Check if data is list or dict
questions = []
if isinstance(data, list):
    questions = data
elif isinstance(data, dict) and "questions" in data:
    questions = data["questions"]

found = False
for question in questions:
    if question.get("index") == 62:
        question["explanation"] = html_content
        found = True
        break

if found:
    json_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print("Successfully updated question 62 explanation in JSON.")
else:
    print("Could not find question with index 62.")
