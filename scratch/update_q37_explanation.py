import json
from pathlib import Path

# Load json
json_path = Path("/Users/wayneclub/PassBar/out/Evidence/Hearsay/Hearsay_castudy_enriched.json")
data = json.loads(json_path.read_text(encoding="utf-8"))

html_content = """<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Evidence / Hearsay / Q37</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 1rem;
      line-height: 1.7;
      color: #333333;
      background-color: #ffffff;
    }

    .pbx-explanation {
      padding: 1.25rem 1.5rem;
      max-width: 800px;
      margin: 0 auto;
      box-sizing: border-box;
    }

    .pbx-explanation p {
      margin: 1em 0;
      word-break: break-word;
      overflow-wrap: break-word;
    }

    /* Table styling */
    .pbx-scroll-x {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      margin: 1.25em 0;
    }

    .pbx-table {
      min-width: 480px;
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #cccccc;
      background-color: #ffffff;
    }

    .pbx-table th {
      border: 1px solid #cccccc;
      padding: 12px;
      background: #f5f5f5;
      font-weight: bold;
      text-align: center;
    }

    .pbx-table td {
      border: 1px solid #cccccc;
      padding: 16px;
      text-align: left;
      vertical-align: top;
    }

    /* Bullet list styling */
    .pbx-bullet-list {
      margin: 1em 0;
      padding-left: 20px;
    }

    .pbx-bullet-list li {
      margin-bottom: 0.5rem;
    }

    /* Link/term styling */
    .pbx-link {
      color: #1b88e5;
      font-weight: 600;
      text-decoration: none;
    }

    .pbx-link:hover {
      text-decoration: underline;
    }

    /* Educational Objective */
    .pbx-edu-objective {
      background: #f0f7ff;
      border-left: 4px solid #3498db;
      border-radius: 6px;
      padding: 14px 18px;
      margin: 24px 0;
    }
    .pbx-edu-objective-title {
      font-size: 13px;
      font-weight: 700;
      color: #2980b9;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }
    .pbx-edu-objective p {
      margin: 0;
      font-size: 0.95rem;
    }

    /* References */
    .pbx-references {
      background: #fafafa;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 14px 18px;
      margin: 20px 0;
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

    /* Mobile adjustments */
    @media (max-width: 640px) {
      body {
        font-size: 0.95rem;
        padding: 0.75rem;
      }
      .pbx-explanation {
        padding: 0.875rem 1rem;
      }
      .pbx-table th, .pbx-table td {
        font-size: 0.825rem;
        padding: 0.5em 0.625em;
      }
      .pbx-edu-objective-title, .pbx-references-title {
        font-size: 12px;
      }
      .pbx-ref-list {
        font-size: 13px;
      }
    }
  </style>
</head>
<body>
<!-- pbx-topic: Declarant's Availability Immaterial -->
<div class="pbx-explanation">

  <!-- Header Card Table -->
  <div class="pbx-scroll-x">
    <table class="pbx-table">
      <thead>
        <tr>
          <th>
            <div style="font-size: 1.1rem; margin-bottom: 4px;">Business records hearsay exception</div>
            <div style="font-weight: normal; font-size: 0.95rem;">(FRE 803(6))</div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <div style="margin-bottom: 10px;">Business record admissible if it was:</div>
            <ul style="margin: 0; padding-left: 20px; list-style-type: disc;">
              <li style="margin-bottom: 6px;">made at or near time of recorded event (or act, opinion, condition, diagnosis)</li>
              <li style="margin-bottom: 6px;">made by or based on information from someone with personal knowledge <em>and</em></li>
              <li style="margin-bottom: 0;">made &amp; kept as a regular practice in the course of regularly conducted business activities</li>
            </ul>
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 16px; font-size: 0.9rem;">
            <strong>FRE</strong> = Federal Rule of Evidence.
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <p>Under the hearsay rule, out-of-court statements (eg, entries in a hospital record) are generally inadmissible when offered to prove the truth of the matter asserted therein (eg, patient has two fractured vertebrae). However, one <span class="pbx-link">hearsay exception</span> applies to <strong>business records</strong> that were:</p>

  <ul class="pbx-bullet-list">
    <li>made <strong>at or near the time</strong> of the recorded event (or act, condition, opinion, diagnosis)</li>
    <li>made by or based on information from someone with <strong>personal knowledge</strong> of that event <em>and</em></li>
    <li>made and kept as a <strong>regular practice</strong> in the course of <strong>regularly conducted business activities</strong>.</li>
  </ul>

  <p data-choice="C" data-choice-role="correct">Hospitals create and maintain patient records as a regular practice in the regular course of hospital business. They are created near the time of the recorded event (eg, patient exam) and are made by or based on information from someone with personal knowledge of the event (eg, physician, nurse, intern). As a result, the entry in the plaintiff's hospital record reporting the physician's diagnosis is admissible under the business records hearsay exception.</p>

  <p style="border-left: 3px solid #c0392b; padding-left: 10px;" data-choice="A B" data-choice-role="distractor">
    <strong style="color: #9b1c1c;">(Choices A &amp; B)</strong> A witness is only qualified to provide expert testimony if the witness has specialized knowledge, skill, experience, training, or education in the relevant field. But here, there is no need to lay such a foundation for the physician's expertise since she is not giving expert testimony. And even if she were, the facts/data underlying her opinion need not be in evidence (or even admissible) if other experts would reasonably rely thereon.
  </p>

  <p style="border-left: 3px solid #c0392b; padding-left: 10px;" data-choice="D" data-choice-role="distractor">
    <strong style="color: #9b1c1c;">(Choice D)</strong> Statements made by a <em>patient</em> (or other declarant) regarding his/her <span class="pbx-link">then-existing physical condition</span> (eg, pain, bodily health) are excepted from hearsay. But here, the <em>physician's</em> diagnosis of the patient's condition does not fall within this exception.
  </p>

  <div class="pbx-edu-objective">
    <div class="pbx-edu-objective-title">📌 Educational Objective</div>
    <p>Business records are excepted from hearsay if they were (1) made near the time of the recorded event, (2) made by or based on information from one with personal knowledge, and (3) made and kept as a regular practice in the course of regular business activities.</p>
  </div>

  <div class="pbx-references">
    <div class="pbx-references-title">📚 References</div>
    <ul class="pbx-ref-list">
      <li>Fed. R. Evid. 803(6) (business record).</li>
    </ul>
  </div>

</div>
</body>
</html>"""

# Update JSON
updated = False
questions = data if isinstance(data, list) else data.get("questions", [])
for q in questions:
    if q.get("index") == 37:
        q["explanation"] = html_content
        updated = True
        break

if updated:
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Successfully updated Hearsay_castudy_enriched.json")
else:
    print("Warning: question index 37 not found in json")

# Write direct html output
html_out_path = Path("/Users/wayneclub/PassBar/out_explanations_html/en/Evidence/Hearsay/037.html")
html_out_path.parent.mkdir(parents=True, exist_ok=True)
html_out_path.write_text(html_content, encoding="utf-8")
print(f"Successfully wrote {html_out_path}")
