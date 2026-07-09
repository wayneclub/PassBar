import os

file_path = "scripts/prompts/zh_explanation.txt"

with open(file_path, "r", encoding="utf-8") as f:
    lines = f.read().splitlines()

# Apply edits in reverse order of line numbers to preserve indices.
# All line numbers are 1-indexed (matching the output of view_file).

# 6. Replace lines 1160-1161 (index 1159 to 1160)
lines[1159:1161] = [
    '* Do all distractors use .distractor-box + wrong-tag (❌ 大类 | 专属错因) with tag-concept-error|tag-fact-distortion|tag-law-misapplied + compact .trap-word?',
    '* Is section 6 visibly shorter than a lecture, keeping exactly one sentence per option with strict character limits and zero filler words?'
]

# 5. Replace lines 1128-1135 (index 1127 to 1134)
lines[1127:1135] = [
    'Answer-choice quality:',
    '',
    '* Does the correct-answer explanation cite one decisive trigger fact?',
    '* Does the correct-answer explanation write exactly one sentence and stay strictly within 40–80 Chinese characters?',
    '* Does every wrong option explanation write exactly one sentence, stay strictly within 40–70 Chinese characters, and follow the "虽然……但是……"对冲句型 without any label like "【心理诱因】" or "【致命一击】"?',
    '* Did I completely avoid generic phrases like "不符合法律规定", "说法错误", "逻辑错误", or "该选项不符合题意", and instead use the specific factual tools/props of the question?',
    '* Did I avoid copying the full original answer choices?'
]

# 4. Replace lines 961-1039 (index 960 to 1038)
lines[960:1039] = [
    '6. 正确答案与干扰项排除',
    '',
    '* Use <section class="option-analysis">.',
    '* Section title must be exactly: 正确答案与干扰项排除',
    '* Correct answer: Use `.option.correct` (green card).',
    '* Each wrong option: Use `.distractor-box`.',
    '* Do not restate full answer-choice text; no A/B/C/D buttons.',
    '* Anti-hallucination: Use ONLY the real option letters from the current input. The correct card\'s `data-choice` and title must match the actual correct answer. Each distractor\'s `data-choice`, visible letter, and explanation must match the actual wrong choice.',
    '',
    'Correct Card format:',
    '- Write exactly ONE sentence explaining why it is correct (硬性字数拦截：死锁在 40–80 字).',
    '- Must cite one decisive trigger fact with `.key-clue`, and connect it to the controlling rule.',
    '',
    'Distractor Box format:',
    '- Each distractor has a `wrong-tag` and a natural explanation paragraph (`p`).',
    '- **Wrong-tag requirement**:',
    '  - Must pick ONE class per distractor:',
    '    * `tag-concept-error` -> `❌ 概念混淆 | [本题专属错因]` (e.g. 混淆IIED与NIED)',
    '    * `tag-fact-distortion` -> `❌ 事实误判 | [本题专属错因]` (e.g. 误判法官身份)',
    '    * `tag-law-misapplied` -> `❌ 法律适用 | [本题专属错因]` (e.g. 错用过失标准)',
    '  - The `[本题专属错因]` part must be a concrete 4–8 character phrase pointing to the specific fact, rule, or role in that option. Never use generic words like "说法错误" or "结论错误".',
    '- **Explanation Paragraph (`p`)**:',
    '  - **Zero Bullshit Lock (彻底拔除通用套话)**: 严禁出现“该选项不符合题意”、“逻辑错误”、“不符合法律规定”、“说法错误”、“本题不适用”等万能废话，必须带上本题的**具体事实/事实道具**（例如：警示牌、炸药、广播画面、某特定合同条款、日期等）作为推演核心。',
    '  - **Structural Sentence Lock (对冲句型死锁)**: 必须且只能用一句话解决该选项（硬性字数拦截：死锁在 40–70 字）。强行禁止输出 `【心理诱因】` 和 `【致命一击】` 标签字样。必须严格约束为以下对冲句型，无学术腔前戏：',
    '    > <strong>✕ [真实错误选项字母]:</strong> 虽然 [指出其切中的表面事实/常识迷思]，但是 [用本题事实道具+核心法理或元件缺失一句话绝杀]，因此该项错误。',
    '  - Use `.trap-word` to wrap 1-4 English words from the option that serve as the trap.',
    '- **Method Box**:',
    '  - One sentence naming the solving method. Reusable for future questions. Length: 25–70 Chinese characters.',
    '',
    'Required format:',
    '',
    '<!-- EXAMPLE ONLY — DO NOT COPY LITERAL CONTENT -->',
    '<section class="option-analysis">',
    '  <h2>正确答案与干扰项排除</h2>',
    '',
    '  <div class="option correct" data-choice="[真实正确选项字母]" data-choice-role="correct">',
    '    <h3 class="option-title">为什么选 [真实正确选项字母]？</h3>',
    '    <p>题干中的 <span class="key-clue">[关键事实道具]</span> 表明 [核心法律规则]，因此锁定 [真实正确选项字母]。</p>',
    '  </div>',
    '',
    '  <div class="distractor-box" data-choice="[真实错误选项字母]" data-choice-role="distractor">',
    '    <span class="wrong-tag tag-concept-error">❌ 概念混淆 | [4-8字简短错因]</span>',
    '    <p style="margin:0;"><strong>✕ [真实错误选项字母]:</strong> 虽然该选项抓住 <span class="trap-word">[选项关键词]</span>，看似符合 [表面事实/迷思]，但是 [核心法理或元件缺失的绝杀解释]，因此该项错误。</p>',
    '  </div>',
    '',
    '  <!-- Repeat the same structure for every remaining real wrong choice. -->',
    '',
    '  <div class="method-box">',
    '    <strong>这题建议用什么方法？</strong>',
    '    <p>[写一个当前题目可复用的解题方法，例如：运用“第一修正案抗辩优先规则”...]</p>',
    '  </div>',
    '</section>',
    '',
    'Important:',
    '* Replace letters with actual correct / wrong choices.',
    '* Replace example language with the actual legal issue.',
    '* Treat the code above as structure only. Do not copy placeholder brackets into the final answer.',
    '* Verify every visible option letter, `data-choice`, and correct/wrong role against the current input before output.',
    '* Final HTML must include at least four data-choice="..." attributes: one correct + three distractors.',
    '* Section 6 should be concise but not cryptic; it must teach answer elimination, not merely label errors.',
    '* Do NOT copy the raw template labels (such as "【心理诱因】" or "【致命一击】") into the final text. Ensure the explanation flows naturally as a single paragraph.'
]

# 3. Replace line 923 (index 922)
lines[922:923] = [
    '    * Preserve English with <span class="term">中文（English）</span> or <span class="en-term">English</span>; the primary tested key term(s) should be followed by a concise "practical exam meaning" explanation (考场意思：...) inline to demystify it for the student. Avoid repeating the exact phrase "考场意思：" recursively for minor or everyday nouns.'
]

# 2. Replace lines 82-84 (index 81 to 83)
lines[81:84] = [
    '5. What should the student remember next time?',
    '   - End with a reusable exam shortcut and mnemonic when applicable.',
    '   - The shortcut must be specific enough to help on a future MBE question.',
    '6. Logical Alignment and Consistency (逻辑链条闭狂与一致性):',
    '   - The three analytical cores of your explanation—the **Three-second Path (三秒认题路径)**, the **Core Legal Rule (核心法律规则)**, and the **Diagram (思维导图)**—must be fully aligned and form a coherent logic loop.',
    '   - For example, if the Three-second Path points to "Intent" as the critical threshold, the Core Legal Rule must focus on the definition/standards of "Intent", and the Diagram must feature "Intent" (or the lack thereof) as the decisive gateway/kill-switch that leads to the final answer.',
    '   - Do not let the different sections focus on disjointed legal issues (e.g., the path discussing jurisdiction, the rules explaining service, and the diagram showing summary judgment standard).',
    '7. Terminology Consistency (术语前后一致性):',
    '   - You must translate and refer to legal terms consistently across all sections of the document. Do not use different Chinese translations for the same English concept (e.g., translating "motion to dismiss" as "驳回起诉动议" in one section and "免除责任动议" in another; choose one clear Chinese translation and stick to it).'
]

# 1. Replace lines 47-54 (index 46 to 53)
lines[46:54] = [
    '   Classification rules:',
    '   - Always name one **primary type** — the dominant analytical skeleton for this question.',
    '   - Add a **secondary type** only when the exam path genuinely needs two layers (e.g., Type A then Type D, Type C then Type B). Cap at two types; never stack three charts.',
    '   - **Solving-Path-Based Classification (基于“解题动作”而非“法律标签”的分类底层逻辑)**:',
    '     - Do not blindly map all elements-based questions (要件题) to Type D. Elements have different internal logical relations (parallel lists, progressive checkpoints, causal chains).',
    '     - Select the diagram type based on the student\'s **Solving Path** (mental flow to solve the question) rather than the legal subject:',
    '       1. **Type A (Horizontal Timeline .timeline)** - *Time-slice style (时间切片型)*: Use when the outcome depends on "who/what came first/last" or "whether a deadline expired". (e.g., Mailbox Rule, Motion deadlines, Closing recording priorities).',
    '       2. **Type B (Entity-Relationship Flow .entity-flow)** - *Relationship/Title Transfer style (法律关系/所有权流转型)*: Use when the outcome depends on the relationship/liability chain between parties or how property/rights transferred/deteriorated. (e.g., Notice/Race conveyance chains, Vicarious liability, Assignment/Delegation triangle).',
    '       3. **Type C (Binary Decision Tree .decision-tree)** - *Progressive Gateway / Checkpoint style (层层递进/关卡过滤型)*: Use when solving is like going through customs; one failed gateway immediately halts the analysis (Kill Switch / Decision Kill). (e.g., Hearsay admissibility, Appealability exceptions, State Action standard choosing).',
    '       4. **Type D (Visual Checklist Matrix .element-grid)** - *Parallel Audit / Comprehensive Diagnosis style (平行审计/综合诊断型)*: Use when elements are parallel and independent, requiring the student to audit the facts against each element one-by-one to see which is met/unmet. (e.g., Intentional Tort/Crime elements like Battery, SOF criteria).',
    '   - **Elements-based Questions vs. Type C vs. Type D Selection (题眼集中度与图表选择)**:',
    '     - If a question contains multiple elements, but the core dispute/trap rests on **only one specific element** (the rest being undisputed/obvious in the facts), **DO NOT use Type D**. Defaulting to Type D in this case makes the chart bloated and redundant.',
    '     - Instead, use **Type C (Binary Decision Tree)** to target the disputed element directly as the sole critical gatekeeper (Kill Switch), or use a hybrid layout if both a sequence and an element check are needed.',
    '   - **Single-type default**: if one chart fully carries the solving path, use only that type — do not add a second chart for decoration.',
    '   - **Hybrid layout** (internal only): when two types are needed, place both chart components inside the same section 4 `.diagram-scroll` in exam order (e.g., timeline on top → element-grid below). No meta caption between them.',
    '   - **No-chart escape hatch**: pure case-synthesis / open-ended balancing with no clean visual skeleton → omit section 4 diagram or use the closest single type; never output "None of the above" as visible text.',
    '   - Do NOT output type labels, HYBRID tags, or 本题题型 captions in visible HTML — classification stays internal.',
    '   - The diagram must mirror actual Bar Exam mechanics — not a generic vertical pipeline of section headings.'
]

with open(file_path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")

print("Successfully applied edits in reverse order!")
