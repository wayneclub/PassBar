import json
from pathlib import Path

# Load json
json_path = Path("/Users/wayneclub/PassBar/out/Civil Procedure/Appealability and Review/Appealability and Review_castudy_enriched.json")
data = json.loads(json_path.read_text(encoding="utf-8"))

html_content = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MBE 考点解析</title>
  <style>
    :root {
      --primary-color: #2c3e50;
      --primary-ink: #243447;
      --accent-color: #3498db;
      --accent-strong: #2980d9;
      --highlight-bg: #e8f4f8;
      --correct-bg: #dff0d8;
      --correct-border: #27ae60;
      --correct-text: #1f8f4d;
      --wrong-bg: #f8d7da;
      --wrong-border: #f5c6cb;
      --wrong-text: #721c24;
      --warning-bg: #fff8e1;
      --warning-border: #ffb300;
      --text-color: #333333;
      --muted-text: #666666;
      --border-color: #dddddd;
      --card-bg: #ffffff;
      --bg-color: #ffffff;
    }

    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 0;
      background: var(--bg-color);
      color: var(--text-color);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 1rem;
      line-height: 1.75;
      letter-spacing: 0;
      display: block;
      overflow-wrap: break-word;
    }
    .container {
      width: 100%;
      max-width: 100%;
      padding: 0 1.5rem 2rem;
      background: var(--card-bg);
    }
    .header {
      background: var(--primary-color);
      color: #ffffff;
      border-radius: 0.75rem 0.75rem 0 0;
      padding: 2.125rem 1.5rem 2rem;
      text-align: center;
      margin-bottom: 1.625rem;
    }
    .header h1 {
      margin: 0 0 0.75rem;
      font-size: 2rem;
      line-height: 1.15;
      font-weight: 800;
      letter-spacing: 0;
    }
    .sub-title {
      margin: 0;
      font-size: 1.25rem;
      line-height: 1.35;
      font-weight: 700;
      color: rgba(255,255,255,0.92);
    }
    h2,
    h3 {
      color: var(--primary-ink);
      font-weight: 800;
      line-height: 1.3;
      letter-spacing: 0;
    }
    h2 {
      font-size: 1.5rem;
      border-bottom: 0.1875rem solid var(--accent-color);
      padding-bottom: 0.625rem;
      margin: 2.125rem 0 1.25rem;
    }
    h3 {
      font-size: 1.25rem;
      margin: 1.75rem 0 1rem;
    }
    p,
    li {
      font-size: 1rem;
      line-height: 1.75;
    }
    strong,
    b {
      display: inline !important;
      white-space: normal !important;
      word-break: normal !important;
      overflow-wrap: break-word !important;
      font-weight: 800;
    }
    .answer-box {
      background: var(--correct-bg);
      border-left: 0.375rem solid var(--correct-border);
      border-radius: 0.375rem;
      padding: 1.25rem 1.5rem;
      margin: 1.375rem 0 1.875rem;
      font-size: 1.125rem;
      font-weight: 700;
    }
    .concept-box {
      background: var(--highlight-bg);
      border-left: 0.375rem solid var(--accent-color);
      border-radius: 0.5rem;
      padding: 1.375rem 1.5rem;
      margin: 1.5rem 0;
    }
    .concept-box .concept-title {
      font-size: 1.35rem;
      font-weight: 800;
      color: var(--accent-strong);
      margin: 0 0 0.875rem;
    }
    .latin {
      font-style: italic;
      font-size: 1rem;
      color: #555555;
      font-weight: 500;
    }
    .table-wrap {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      margin: 1rem 0;
    }
    table {
      min-width: 480px;
      width: 100%;
      border-collapse: collapse;
    }
    .comparison-table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.5rem 0;
      font-size: 1rem;
    }
    .comparison-table th {
      background: #f8f9fa;
      color: var(--primary-color);
      font-weight: 800;
      padding: 0.875rem;
      border: 1px solid var(--border-color);
      text-align: left;
    }
    .comparison-table td {
      padding: 0.875rem;
      border: 1px solid var(--border-color);
      vertical-align: top;
    }
    .diagram {
      background: #ffffff;
      border: 1px dashed #cccccc;
      border-radius: 0.5rem;
      padding: 1.375rem;
      margin: 1.75rem 0;
      text-align: center;
    }
    .diagram-scroll {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .diagram-inner {
      min-width: 520px;
    }
    .flow-node,
    .party-box {
      display: inline-block;
      background: #e8fcff;
      border: 1px solid #22b8cf;
      border-radius: 0.375rem;
      padding: 0.625rem 0.875rem;
      font-weight: 700;
      color: #05606a;
      margin: 0.375rem;
      white-space: normal;
      word-break: break-word;
      transition: all 0.2s ease;
    }
    .flow-node.active,
    .flow-node.highlight-node {
      background: var(--accent-color);
      border-color: var(--accent-color);
      color: #ffffff;
      box-shadow: 0 0 0 3px rgba(52,152,219,0.35);
    }
    .decision-tree {
      text-align: left;
      line-height: 1.55;
    }
    .decision-q {
      display: inline-block;
      background: #eef6fc;
      border: 2px solid var(--accent-color);
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
      font-weight: 800;
      color: var(--primary-ink);
      margin: 0.5rem 0;
    }
    .decision-branch {
      margin: 0.5rem 0 0.5rem 1.25rem;
      padding-left: 0.875rem;
      border-left: 3px solid #d7e9f8;
    }
    .decision-label {
      font-weight: 800;
      color: var(--accent-strong);
      margin-right: 0.375rem;
    }
    .decision-kill {
      display: inline-block;
      background: #fff3cd;
      border: 2px solid var(--warning-border);
      border-radius: 0.375rem;
      padding: 0.5rem 0.75rem;
      font-weight: 800;
      color: #7a5b00;
      margin: 0.375rem 0;
    }
    .diagram-caption {
      font-size: 0.95rem;
      color: var(--muted-text);
      margin: -0.5rem 0 1rem;
      text-align: left;
    }
    .timeline {
      text-align: left;
      padding: 0.5rem 0;
    }
    .timeline-track {
      display: flex;
      align-items: stretch;
      gap: 0;
      min-width: 640px;
    }
    .timeline-node {
      flex: 1;
      min-width: 7.5rem;
      border-top: 4px solid var(--accent-color);
      padding: 0.75rem 0.5rem 0;
      position: relative;
    }
    .timeline-node::before {
      content: "";
      width: 0.75rem;
      height: 0.75rem;
      background: var(--accent-color);
      border-radius: 50%;
      position: absolute;
      top: -0.5rem;
      left: 0.5rem;
    }
    .timeline-day {
      font-weight: 800;
      color: var(--accent-strong);
      font-size: 0.9rem;
    }
    .timeline-event {
      font-size: 0.92rem;
      margin-top: 0.375rem;
      line-height: 1.45;
    }
    .timeline-safe {
      background: rgba(39,174,96,0.08);
      border-radius: 0.375rem;
      padding: 0.375rem;
    }
    .timeline-trap {
      background: rgba(255,179,0,0.12);
      border: 2px dashed var(--warning-border);
      border-radius: 0.375rem;
      padding: 0.375rem;
    }
    .entity-flow {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 0.5rem;
      flex-wrap: nowrap;
      min-width: 600px;
      text-align: center;
    }
    .entity-card {
      flex: 0 0 auto;
      min-width: 8rem;
      max-width: 11rem;
      background: #eef6fc;
      border: 2px solid var(--accent-color);
      border-radius: 0.5rem;
      padding: 0.75rem 0.625rem;
      font-weight: 700;
      color: var(--primary-ink);
      line-height: 1.4;
    }
    .entity-card.highlight-node {
      background: var(--accent-color);
      color: #ffffff;
      border-color: var(--accent-color);
    }
    .entity-arrow {
      flex: 0 0 auto;
      font-size: 1.25rem;
      font-weight: 800;
      color: var(--accent-strong);
      padding: 0 0.25rem;
    }
    .entity-label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--muted-text);
      margin-top: 0.25rem;
    }
    .element-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0.75rem;
      text-align: left;
      min-width: 520px;
    }
    .element-card {
      background: #f8fbff;
      border: 2px solid #d7e9f8;
      border-radius: 0.5rem;
      padding: 0.75rem;
    }
    .element-card .element-name {
      font-weight: 800;
      color: var(--accent-strong);
      margin-bottom: 0.5rem;
      font-size: 0.95rem;
    }
    .element-met {
      border-color: var(--correct-border);
      background: rgba(39,174,96,0.06);
    }
    .element-unmet {
      border-color: var(--warning-border);
      background: rgba(255,179,0,0.08);
    }
    .element-fact {
      font-size: 0.9rem;
      line-height: 1.45;
      margin-top: 0.375rem;
    }
    .rule-block,
    .trap-alert,
    .footer-tip {
      background: var(--warning-bg);
      border-left: 0.3125rem solid var(--warning-border);
      border-radius: 0.375rem;
      padding: 1.125rem 1.25rem;
      margin: 1.375rem 0;
    }
    .case-box {
      background: var(--highlight-bg);
      border-radius: 0.5rem;
      padding: 1.25rem 1.375rem;
      margin: 1.25rem 0;
    }
    .option {
      border-radius: 0.5rem;
      padding: 1.125rem 1.25rem;
      margin: 1rem 0;
    }
    .option.correct {
      background: var(--correct-bg);
      border-left: 0.3125rem solid var(--correct-border);
    }
    .option.wrong {
      background: var(--wrong-bg);
      border-left: 0.3125rem solid var(--wrong-border);
      color: var(--wrong-text);
    }
    .option .option-title {
      font-size: 1.25rem;
      font-weight: 800;
      margin: 0 0 0.75rem;
    }
    .key-clue {
      font-weight: 800;
      background: rgba(52,152,219,0.12);
      border-bottom: 2px solid rgba(52,152,219,0.45);
      padding: 0 0.125rem;
    }
    .term-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.75rem;
      margin: 1.125rem 0;
    }
    .term-card {
      background: #f8fbff;
      border: 1px solid #d7e9f8;
      border-radius: 0.5rem;
      padding: 0.75rem 0.875rem;
    }
    .term-card strong {
      color: var(--primary-ink);
    }
    .term-card.focus-card {
      border: 2px solid var(--accent-color);
      border-left: 0.375rem solid var(--accent-strong);
      background: #f0f7ff;
      box-shadow: 0 0.25rem 0.75rem rgba(52,152,219,0.15);
    }
    .distractor-box {
      background: #fffafa;
      border: 1px solid #fbcfe8;
      border-left: 0.3125rem solid #ec4899;
      border-radius: 0.5rem;
      padding: 1rem 1.25rem;
      margin: 1rem 0;
    }
    .wrong-tag {
      display: inline-block;
      font-size: 0.75rem;
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      font-weight: 800;
      margin-bottom: 0.5rem;
    }
    .tag-concept-error {
      background: #fce7f3;
      color: #9d174d;
    }
    .tag-fact-distortion {
      background: #ffedd5;
      color: #9a3412;
    }
    .tag-law-misapplied {
      background: #fee2e2;
      color: #991b1b;
    }
    .trap-word {
      background-color: #fef08a;
      color: #854d0e;
      font-weight: 800;
      padding: 0 0.25rem;
      border-radius: 0.125rem;
    }
    .en-term {
      font-style: italic;
      color: var(--accent-strong);
      font-weight: 700;
    }
    .keyword-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 0.75rem 0 1.125rem;
    }
    .keyword-chip {
      background: rgba(52,152,219,0.12);
      border: 1px solid rgba(52,152,219,0.35);
      border-radius: 999px;
      padding: 0.25rem 0.625rem;
      font-weight: 700;
    }
    .elimination-list {
      margin: 0.75rem 0 0;
      padding-left: 0;
      list-style: none;
    }
    .elimination-list li {
      margin: 0.5rem 0;
      line-height: 1.55;
    }
    .method-box {
      background: var(--highlight-bg);
      border-left: 0.3125rem solid var(--accent-color);
      border-radius: 0.5rem;
      padding: 1.125rem 1.25rem;
      margin: 1.375rem 0;
    }
    code {
      background: rgba(0,0,0,0.05);
      padding: 0.125rem 0.25rem;
      border-radius: 0.25rem;
      font-size: 0.92em;
    }
    .term {
      background: transparent;
      border-bottom: 1px solid rgba(36,52,71,0.26);
      padding: 0 1px 1px;
      border-radius: 0;
      font-size: 1em;
      font-weight: 800;
      white-space: normal;
    }

    @media (max-width: 640px) {
      body {
        font-size: 0.95rem;
        padding: 0.75rem;
      }
      .container {
        padding: 0 0.875rem 1.5rem;
      }
      .header {
        padding: 1.5em 1rem;
      }
      .header h1 {
        font-size: 1.65rem;
      }
      .sub-title {
        font-size: 1rem;
      }
      h2 {
        font-size: 1.35rem;
      }
      h3 {
        font-size: 1.15rem;
      }
      th,
      td {
        font-size: 0.875rem;
        padding: 0.5rem 0.625rem;
      }
      .answer-box,
      .concept-box,
      .rule-block,
      .trap-alert,
      .footer-tip,
      .method-box,
      .option {
        padding: 1em 1.125em;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>MBE 考点解析</h1>
      <div class="sub-title">Civil Procedure：Appealability and Review</div>
    </div>

    <h2>本题真正考的是</h2>
    <section class="concept-box">
      <div class="concept-title">一句话定位考点</div>
      <p>本题真正考的是：涉及<span class="term">律师-当事人特权（attorney-client privilege）</span>的强制披露令不能通过<span class="term">附带命令原则（collateral-order doctrine）</span>立即上诉。</p>
      <div class="method-box">
        <strong>三秒认题路径：</strong>
        <p>特权披露令 → 非终局裁定 → 联想 Mohawk 案 → 终局后可复审 → 不能立刻上诉</p>
      </div>
    </section>

    <h2>核心法律规则</h2>
    <section class="concept-box">
      <p>联邦诉讼中原则上仅允许对<span class="term">终局判决（final judgment）</span>提起上诉。例外是<span class="term">附带命令原则（collateral-order doctrine）</span>，要求中间裁定必须：(1) 终结性解决重要争议；(2) 与实体争议完全分离；(3) 终局判决后<span class="en-term">effectively unreviewable</span>（无法有效复审）。</p>
      <p>然而，一审强制披露涉特权材料的裁定（discovery orders），在终局判决后仍可通过二审排除该证据或撤销判决发回重审获得救济。因此，它不满足第三要件，不能立即提起中间上诉。</p>
      <div class="case-box">
        <strong>核心判例：</strong> <em>Mohawk Industries, Inc. v. Carpenter (2009)</em> — 最高法院确立了涉及律师-当事人特权的强制开示命令不能通过附带命令原则在终局前直接上诉。
      </div>
    </section>

    <h2>思维导图</h2>
    <div class="diagram">
      <p class="diagram-caption">本题题型：Type C（法理黑白分流）➔ 采用二叉决策树图</p>
      <div class="diagram-scroll">
        <div class="diagram-inner" style="text-align: left; padding: 10px;">
          <div class="decision-tree">
            <div class="decision-q">第一关：是否为终局判决 (Final Judgment)？</div>
            <div class="decision-branch">
              <span class="decision-label">【YES】</span> 案件实体结案 ➔ 允许上诉 (28 U.S.C. § 1291)
            </div>
            <div class="decision-branch">
              <span class="decision-label">【NO】</span> 属于中间裁定 (Interlocutory Order)
              <div style="margin-top: 8px;">
                <div class="decision-q">第二关：是否属于法定中间上诉例外？（如禁令 Injunction 等）</div>
                <div class="decision-branch">
                  <span class="decision-label">【YES】</span> ➔ 允许中间上诉
                </div>
                <div class="decision-branch">
                  <span class="decision-label">【NO】</span> ➔ 进入判例法例外：附带命令原则 (Collateral-Order Doctrine) 三要素审查
                  <div style="margin-top: 8px;">
                    <div class="decision-q">第三关：附带命令原则三要素是否均满足？</div>
                    <div class="decision-branch">
                      要素 1：终结解决重要争议？ ➔ <span class="decision-label">【满足】</span> 一审已裁定强制披露
                    </div>
                    <div class="decision-branch">
                      要素 2：与实体争议完全分离？ ➔ <span class="decision-label">【满足】</span> 特权范围与解雇是否违法互相独立
                    </div>
                    <div class="decision-branch">
                      要素 3：终局判决后无法有效复审 (Effectively unreviewable)？
                      <div class="decision-branch">
                        <div class="decision-kill">【FAIL】 ❌ 律师特权披露可通过终局上诉后“重审/排除证据”来救济（Mohawk 案）</div>
                      </div>
                    </div>
                    <div class="decision-branch">
                      <strong>结论：</strong> 无法立即上诉 ➔ 对应正确选项 B
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <h2>考点陷阱</h2>
    <div class="trap-alert">
      <p>你可能会想：特权文件一旦在取证阶段被迫交给对方，秘密物理上就彻底泄漏了，以后再怎么判也无法保密，所以应该是“不可有效复审”。</p>
      <p>但考试真正问的是：上诉法院在案件最终审结后，还能否在法律程序上给予当事人有效的司法救济。</p>
      <p><strong>司法考试看的是「法律程序上能不能救济」，而不是「物理上的秘密有没有泄露」。</strong></p>
    </div>

    <section class="option-analysis">
      <h2>正确答案与干扰项排除</h2>
      <div class="option correct" data-choice="B" data-choice-role="correct">
        <h3 class="option-title">为什么选 B？</h3>
        <p>一审法院强令披露律师特权信息的裁定在全案终局后，仍可通过上诉法院撤销判决并排除证据获得有效救济，因而不适用 <span class="term">附带命令原则（collateral-order doctrine）</span>，不可立即上诉。</p>
      </div>
      <div class="distractor-box" data-choice="A" data-choice-role="distractor">
        <span class="wrong-tag tag-concept-error">❌ 概念混淆 | 规则渊源误判</span>
        <p style="margin:0;"><strong>✕ A:</strong> 误以为无立法授权就无效，附带命令原则作为 <span class="trap-word">no statute</span> 的判例法例外在联邦依然有效。</p>
      </div>
      <div class="distractor-box" data-choice="C" data-choice-role="distractor">
        <span class="wrong-tag tag-fact-distortion">❌ 事实误判 | 诉讼争端范围误判</span>
        <p style="margin:0;"><strong>✕ C:</strong> 错在以为解决该争议能 <span class="trap-word">resolve the dispute</span>，这仅仅是取证争议而非诉讼实体。</p>
      </div>
      <div class="distractor-box" data-choice="D" data-choice-role="distractor">
        <span class="wrong-tag tag-law-misapplied">❌ 法律适用 | 宪法程序滥用</span>
        <p style="margin:0;"><strong>✕ D:</strong> 滥用宪法正当程序，误以为 <span class="trap-word">due process</span> 赋予了对特权披露令立即上诉的权利。</p>
      </div>
      <div class="method-box">
        <strong>这题建议用什么方法？</strong>
        <p>程序姿态优先：先查是否终局判决，再看是否属于法定中间上诉例外，切记律师特权披露令在终局后可有效复审。</p>
      </div>
    </section>

    <h2>考场速记</h2>
    <div class="footer-tip">
      <p><strong>中间上诉例外口诀：</strong></p>
      <p>记忆口诀：<span class="en-term">“In Certain Circumstances, An Appeal Can Be Made Prematurely”</span></p>
      <ul>
        <li><strong>I</strong>njunction（禁令裁定）</li>
        <li><strong>C</strong>ertification by District Court（地方法院及上诉法院双重认证 § 1292(b)）</li>
        <li><strong>C</strong>lass Action Certification（集体诉讼资格认定 Rule 23(f)）</li>
        <li><strong>A</strong>ppointment of Receiver（接管人任命）</li>
        <li><strong>A</strong>dmiralty Cases（海事案责任裁定）</li>
        <li><strong>C</strong>ollateral-Order Doctrine（附带命令原则 — <span class="term">Mohawk 案已排除律师特权披露令</span>）</li>
        <li><strong>B</strong>ankruptcy Cases（破产特定裁定）</li>
        <li><strong>M</strong>andamus（职务执行令状申请）</li>
        <li><strong>P</strong>atent-Infringement Order（仅剩会计审计的专利侵权裁定）</li>
      </ul>
      <p>💡 <strong>Mohawk 闪击记忆：</strong> 看到律师特权强制开示 → 联想 Mohawk 案 → 结论：终局后可救济 → <strong>不能立刻上诉！</strong></p>
    </div>
  </div>
</body>
</html>
"""

# Update the "zh-explanation" field for index 1
updated = False
questions = data if isinstance(data, list) else data.get("questions", [])
for q in questions:
    if q.get("index") == 1:
        q["zh-explanation"] = html_content
        updated = True
        break

if updated:
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Successfully updated Appealability and Review_castudy_enriched.json for Q1")
else:
    print("Warning: question index 1 not found in json")
