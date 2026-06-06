import json
from pathlib import Path

json_path = Path("/Users/wayneclub/PassBar/out/Constitutional Law/Individual Rights/Individual Rights_castudy_enriched.json")

with open(json_path, "r", encoding="utf-8") as f:
    data = json.load(f)

html_content = """<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Constitutional Law / Individual Rights / Q82</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 1rem;
      line-height: 1.7;
      color: #333333;
      background-color: #ffffff;
      margin: 0;
      padding: 0;
    }
    
    .pbx-explanation {
      padding: 1.25rem 1.5rem;
      box-sizing: border-box;
      width: 100%;
    }
    
    .pbx-explanation p {
      margin-top: 0;
      margin-bottom: 1.25rem;
      overflow-wrap: break-word;
      word-break: break-word;
    }
    
    .pbx-explanation p:last-child {
      margin-bottom: 0;
    }
    
    .pbx-explanation strong {
      font-weight: 700;
    }
    
    .pbx-explanation em {
      font-style: italic;
    }
    
    .pbx-explain-img {
      margin: 1.25em 0;
      text-align: center;
    }
    
    .pbx-explain-img img {
      max-width: 100%;
      height: auto;
      border-radius: 6px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
    }
    
    @media (max-width: 640px) {
      .pbx-explain-img img {
        border-radius: 3px;
      }
    }
    
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
      font-size: 1rem;
      line-height: 1.7;
    }
    
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
    
    .pbx-ref-list li {
      margin-bottom: 6px;
    }
    
    .pbx-ref-list li:last-child {
      margin-bottom: 0;
    }
    
    .pbx-scroll-x {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      margin: 16px 0;
    }
    
    .pbx-explanation table {
      min-width: 480px;
      width: 100%;
      border: 1px solid #cccccc;
      border-collapse: collapse;
    }
    
    .pbx-explanation th, .pbx-explanation td {
      border: 1px solid #cccccc;
      padding: 8px 12px;
      line-height: 1.5;
    }
    
    .pbx-explanation th {
      background: #f5f5f5;
      font-weight: bold;
      text-align: left;
    }
    
    @media (max-width: 640px) {
      body {
        font-size: 0.95rem;
      }
      
      .pbx-explanation {
        padding: 0.875rem 1rem;
      }
      
      .pbx-explanation th, .pbx-explanation td {
        font-size: 0.825rem;
        padding: 0.5em 0.625em;
      }
    }
  </style>
</head>
<body>
  <!-- pbx-topic: General Considerations -->
  <div class="pbx-explanation">
    <p>Laws that unevenly distribute benefits can be challenged on <strong>equal protection</strong> grounds. These challenges are generally subject to <strong>rational basis</strong> review, where the challenger must show that the law is not rationally related to any legitimate state interest. But <strong>intermediate scrutiny</strong> is used for laws that substantially impact a <strong>quasi-suspect class</strong>. And <strong>strict scrutiny</strong> is used for laws that substantially impact a <strong>suspect class</strong> or <strong>fundamental right</strong>.</p>

    <figure class="pbx-explain-img">
      <img src="imgs/q821531.jpg" alt="Explanation diagram" style="max-width:100%;height:auto;display:block;margin:0 auto;">
    </figure>

    <p style="border-left: 3px solid #27ae60; padding-left: 10px;" data-choice="B" data-choice-role="correct">Here, a state statute calculates the distribution of funds from the state treasury based on the number of students in each public school district and the real estate tax revenue raised by that district. This formula has a disparate impact on school districts because it fails to account for other sources of revenue. But since this law does not affect a fundamental right, suspect class, or quasi-suspect class, rational basis review will apply.</p>

    <p style="border-left: 3px solid #c0392b; padding-left: 10px;" data-choice="A D" data-choice-role="distractor"><strong style="color: #9b1c1c;">(Choices A & D)</strong> The state must show that its law is necessary to vindicate a compelling state interest (ie, strict scrutiny) when the law substantially impacts a suspect class or fundamental right. In <em>San Antonio Indep. Sch. Dist. v. Rodriguez</em>, the Supreme Court held that (1) wealth-based classifications do not impact suspect or quasi-suspect classes and (2) education is not a fundamental right. Therefore, rational basis scrutiny will apply here.</p>

    <p style="border-left: 3px solid #c0392b; padding-left: 10px;" data-choice="C" data-choice-role="distractor"><strong style="color: #9b1c1c;">(Choice C)</strong> The <em>state</em> would have had to demonstrate that its statutory funding formula <em>is</em> substantially related to an important state interest (ie, intermediate scrutiny) had the formula impacted a quasi-suspect class (ie, gender, legitimacy). But the statute does not do so.</p>

    <div class="pbx-edu-objective">
      <div class="pbx-edu-objective-title">📌 Educational Objective</div>
      <p>Under the equal protection clause, a discriminatory law that does not substantially impact a fundamental right, suspect class, or quasi-suspect class will be reviewed under the rational basis test—ie, the challenging party must show that the law is not rationally related to any legitimate state interest.</p>
    </div>

    <div class="pbx-references">
      <div class="pbx-references-title">📚 References</div>
      <ul class="pbx-ref-list">
        <li>U.S. Const. amend. XIV, § 1 (equal protection clause).</li>
        <li>San Antonio Indep. Sch. Dist. v. Rodriguez, 411 U.S. 1, 28, 37 (1973) (explaining that education is not a fundamental right and wealth is not a quasi-suspect or suspect class).</li>
      </ul>
    </div>
  </div>
</body>
</html>"""

# Find the question with index 82
updated = False
questions = data.get("questions", [])
for question in questions:
    if question.get("index") == 82:
        question["explanation"] = html_content
        updated = True
        break

if updated:
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("Successfully updated Individual Rights_castudy_enriched.json for Q82.")
else:
    print("Error: Could not find question with index 82.")
