import { Question, Subject } from './types';

export const MBE_SUBJECTS: Subject[] = [
  {
    id: 'civ-pro',
    name: 'Civil Procedure',
    count: 321,
    chapters: [
      { id: 'cp-1', name: 'Jurisdiction and Venue', count: 85 },
      { id: 'cp-2', name: 'Law Applied by Federal Courts', count: 13 },
      { id: 'cp-3', name: 'Pretrial Procedures', count: 100 },
      { id: 'cp-4', name: 'Jury Trials', count: 20 },
      { id: 'cp-5', name: 'Motions', count: 48 },
      { id: 'cp-6', name: 'Verdicts and Judgments', count: 27 },
      { id: 'cp-7', name: 'Appealability and Review', count: 23 },
    ]
  },
  {
    id: 'con-law',
    name: 'Constitutional Law',
    count: 265,
    chapters: [
      { id: 'cl-1', name: 'Judicial Review', count: 42 },
      { id: 'cl-2', name: 'Separation of Powers', count: 57 },
      { id: 'cl-3', name: 'Federal-State Relations', count: 46 },
      { id: 'cl-4', name: 'Individual Rights', count: 120 },
    ]
  },
  {
    id: 'contracts',
    name: 'Contracts',
    count: 291,
    chapters: [
      { id: 'ct-1', name: 'Formation of Contracts', count: 81 },
      { id: 'ct-2', name: 'Defenses to enforceability', count: 52 },
      { id: 'ct-3', name: 'Contract Content and Meaning', count: 24 },
      { id: 'ct-4', name: 'Performance, Breach, and Discharge', count: 61 },
      { id: 'ct-5', name: 'Remedies', count: 47 },
      { id: 'ct-6', name: 'Third-Party Rights', count: 26 },
    ]
  },
  {
    id: 'crim-law',
    name: 'Criminal Law & Procedure',
    count: 258,
    chapters: [
      { id: 'cr-1', name: 'Homicide', count: 45 },
      { id: 'cr-2', name: 'Other Crimes', count: 62 },
      { id: 'cr-3', name: 'Inchoate Crimes', count: 31 },
      { id: 'cr-4', name: 'Constitutional Protections', count: 85 },
      { id: 'cr-5', name: 'Criminal Trial', count: 35 },
    ]
  },
  {
    id: 'evidence',
    name: 'Evidence',
    count: 242,
    chapters: [
      { id: 'ev-1', name: 'Relevancy', count: 72 },
      { id: 'ev-2', name: 'Privileges and Policy', count: 45 },
      { id: 'ev-3', name: 'Witnesses', count: 60 },
      { id: 'ev-4', name: 'Hearsay', count: 65 },
    ]
  },
  {
    id: 'real-property',
    name: 'Real Property',
    count: 265,
    chapters: [
      { id: 'rp-1', name: 'Ownership of Real Property', count: 62 },
      { id: 'rp-2', name: 'Rights in Real Property', count: 58 },
      { id: 'rp-3', name: 'Real Estate Contracts', count: 45 },
      { id: 'rp-4', name: 'Mortgages and Finance', count: 50 },
      { id: 'rp-5', name: 'Titles', count: 50 },
    ]
  },
  {
    id: 'torts',
    name: 'Torts',
    count: 289,
    chapters: [
      { id: 'tr-1', name: 'Intentional Torts', count: 65 },
      { id: 'tr-2', name: 'Negligence', count: 110 },
      { id: 'tr-3', name: 'Strict Liability', count: 32 },
      { id: 'tr-4', name: 'Products Liability', count: 42 },
      { id: 'tr-5', name: 'Other Torts', count: 40 },
    ]
  }
];

export const MOCK_QUESTIONS: Question[] = [
  {
    id: 'cp-2-1',
    subject: 'Civil Procedure',
    topic: 'Law Applied by Federal Courts',
    questionText: "A man brought a diversity action against a pharmaceutical company in a federal district court in State A. In his complaint, the man alleged that the company violated State A's false advertising law. The company moved to dismiss the man's action for failure to state a claim on the ground that the false advertising law does not apply to advertising by pharmaceutical companies.\nSeveral lower state courts in State A have recognized the company's defense. The highest state court in State A has never ruled or noted in dicta whether this defense is valid. Based on the lower state courts' decisions, the federal district court ruled that the company's defense applies and granted its motion to dismiss. The man appealed.\nState A law permits a federal district court to certify an unsettled question of state substantive law to the state's highest court for clarification.\nIs the federal appellate court likely to overturn the dismissal?",
    options: [
      "No, because the federal district court properly relied on the rulings issued by the state's lower courts.",
      "No, because the federal district court's decision was not clearly erroneous.",
      "Yes, because the federal district court abused its discretion when it dismissed the action.",
      "Yes, because the federal district court failed to certify the issue to the highest state court in State A."
    ],
    correctAnswer: "No, because the federal district court properly relied on the rulings issued by the state's lower courts.",
    apiMatchOk: true,
    explainImgs: ["https://getbar.link/admin-api/infra/file/2/get/q881171.jpg",],
    explanationHtml: ""
  },
  {
    id: 'cp-2-2',
    subject: 'Civil Procedure',
    topic: 'Law Applied by Federal Courts',
    questionText: "A plaintiff residing in State A sues her former employer for $3 million, alleging employment discrimination in violation of federal law, breach of her employment contract, and infringement of her patent. The suit is filed in a federal court located in State B, which is the employer's state of incorporation and principal place of business.\nUnder State B's choice-of-law rules, State B law applies to all state substantive law claims.\nWhat substantive law should the federal court apply to the plaintiff's various claims?",
    options: [
      "The court should apply federal law to all three claims.",
      "The court should apply State B law to all three claims.",
      "The court should apply State B law to the breach of contract claim and federal law to the employment discrimination and patent claims.",
      "The court should apply State B law to the employment discrimination and patent claims and federal law to the breach of contract claim."
    ],
    correctAnswer: "The court should apply State B law to the breach of contract claim and federal law to the employment discrimination and patent claims.",
    apiMatchOk: true,
    explainImgs: [],
    explanationHtml: ""
  },
  {
    id: 'cp-2-3',
    subject: 'Civil Procedure',
    topic: 'Law Applied by Federal Courts',
    questionText: "While a consumer was using a product at home in State A, the product malfunctioned. The consumer sued the manufacturer of the product for $100,000 in damages in a federal district court in State A on a products liability claim. The manufacturer wants to transfer venue to a federal district court in State B, the state in which it is incorporated and has its principal place of business. The manufacturer believes that State B's products liability laws afford greater protections to defendants.\nState A's choice-of-law rules require the application of State A's products liability laws. State B's choice-of-law rules require the application of State B's products liability laws.\nIs the manufacturer likely to succeed in having State B's products liability laws apply upon transfer?",
    options: [
      "No, because State A's products liability laws will apply upon transfer.",
      "No, because State B is an improper venue.",
      "Yes, because State A is an improper venue.",
      "Yes, because State B's choice-of-law rules require the application of State B's products liability laws."
    ],
    correctAnswer: "No, because State A's products liability laws will apply upon transfer.",
    apiMatchOk: true,
    explainImgs: ["https://getbar.link/admin-api/infra/file/2/get/q881181.jpg",],
    explanationHtml: ""
  },
  {
    id: 'cp-2-4',
    subject: 'Civil Procedure',
    topic: 'Law Applied by Federal Courts',
    questionText: "A member of Congress fired a female employee because he believed that male employees are better workers. The female employee sued the member of Congress in federal court to recover monetary damages. She claimed that the termination of her employment constituted sex-based discrimination in violation of the Fifth Amendment. No federal statute authorizes an employment discrimination claim for damages against a member of Congress.\nThe member of Congress has moved to dismiss the female employee's suit for failure to state a claim upon which relief can be granted.\nIs the court likely to grant the motion?",
    options: [
      "No, because the federal court may fill a gap in a federal statutory scheme.",
      "No, because the female employee's claim presents an implied cause of action.",
      "Yes, because the female employee's claim is not explicitly authorized by a federal statute.",
      "Yes, because the member of Congress filed the motion before filing his answer."
    ],
    correctAnswer: "No, because the female employee's claim presents an implied cause of action.",
    apiMatchOk: true,
    explainImgs: [],
    explanationHtml: ""
  },
  {
    id: 'cp-2-5',
    subject: 'Civil Procedure',
    topic: 'Law Applied by Federal Courts',
    questionText: "A bakery incorporated and headquartered in State A had a dispute with a mill incorporated and headquartered in State B over the quality of the flour the mill had delivered to the bakery. The bakery sued the mill in a federal court in State A for breach of contract, seeking $100,000 in damages.\nThe contract between the bakery and the mill contained a clause designating State B courts as the sole venue for litigating disputes arising under the contract. Under precedent of the highest court in State A, forum-selection clauses are unenforceable as against public policy; under U.S. Supreme Court precedent, such clauses are enforceable.\nThe mill has moved to transfer the case to a federal court in State B, citing the forum-selection clause in the parties' contract and asserting the facts that the flour was produced in State B and that the majority of likely witnesses are in State B.\nIs the court likely to grant the mill's motion?",
    options: [
      "No, because State A law treats forum-selection clauses as unenforceable.",
      "No, because the mill should have instead filed a motion to dismiss for improper venue.",
      "Yes, because federal common law makes the forum-selection clause controlling.",
      "Yes, because federal law governs transfers of venue, and it would be more convenient for the witnesses and parties to litigate the claim in State B."
    ],
    correctAnswer: "Yes, because federal law governs transfers of venue, and it would be more convenient for the witnesses and parties to litigate the claim in State B.",
    apiMatchOk: true,
    explainImgs: [],
    explanationHtml: ""
  },
  {
    id: 'cp-2-6',
    subject: 'Civil Procedure',
    topic: 'Law Applied by Federal Courts',
    questionText: "Ten months after surgery in a hospital, a patient who had suffered complications from the surgery sued the surgeon and the hospital in federal court for medical malpractice, seeking $750,000 in damages. Timely personal service was made on the surgeon and the hospital. Three months later, during discovery, the patient learned that the hospital was owned by a national health-care company and moved to amend the complaint to substitute the company for the hospital.\nThe company moved to dismiss, arguing that the forum state had enacted a one-year statute of limitations for medical malpractice actions and that the company had been served after the limitations period had expired. The company also noted that the state's highest court has interpreted the limitations statute as forbidding any relation back of amendments adding parties in medical malpractice actions. The patient argued that the Federal Rules of Civil Procedure control, and that they allow relation back under the circumstances of this case.\nWhich law governs whether relation back will be permitted under these circumstances?",
    options: [
      "Federal law, because the Federal Rules of Civil Procedure govern over conflicting state rules that deny relation back.",
      "Federal law, because the state law on relation back is common law and federal courts are bound only by state statutory law.",
      "State law, because statutes of limitation are substantive and state law controls substantive matters.",
      "State law, because the Federal Rules of Civil Procedure authorize the use of state law for relation back."
    ],
    correctAnswer: "Federal law, because the Federal Rules of Civil Procedure govern over conflicting state rules that deny relation back.",
    apiMatchOk: true,
    explainImgs: ["https://getbar.link/admin-api/infra/file/2/get/q881081.jpg",],
    explanationHtml: ""
  },
  {
    id: 'cp-2-7',
    subject: 'Civil Procedure',
    topic: 'Law Applied by Federal Courts',
    questionText: "A woman domiciled in State A was using a rideshare program while traveling in State B when her driver from State B lost control of his vehicle and collided with a building. The woman suffered serious injuries. A police report determined that the driver was heavily intoxicated at the time of the crash.\nThe woman brought a diversity action against the driver in a federal district court in State A, alleging that the driver's negligence caused her $100,000 in damages. The driver filed a motion to transfer the case to a federal court in State B, which was granted.\nWhat law of negligence should the federal court in State B apply in this action?",
    options: [
      "The court should apply the federal common law of negligence.",
      "The court should consider the negligence law of both State A and State B and apply the law that the court finds most appropriate.",
      "The court should determine which state's negligence law a state court in State A would apply and apply that law.",
      "The court should determine which state's negligence law a state court in State B would apply and apply that law."
    ],
    correctAnswer: "The court should determine which state's negligence law a state court in State B would apply and apply that law.",
    apiMatchOk: true,
    explainImgs: ["https://getbar.link/admin-api/infra/file/2/get/q881151.jpg",],
    explanationHtml: ""
  },
  {
    id: 'cp-2-8',
    subject: 'Civil Procedure',
    topic: 'Law Applied by Federal Courts',
    questionText: "A woman brought a diversity action against a man in a federal district court in State A to recover damages for an accident that occurred in State B. The woman hired a process server, who delivered a copy of the summons and complaint to the man's wife at their home. The man filed an answer in which he moved to dismiss the woman's action for improper service of process.\nLaws in State A and State B require that service of process be personally delivered to the defendant, and their choice-of-law rules provide that a court must apply the law of the state where the injury occurred.\nShould the court grant the man's motion to dismiss?",
    options: [
      "No, because the man waived this defense by failing to assert it in a pre-answer motion.",
      "No, because the man was served in accordance with federal law.",
      "Yes, because the man was not served in accordance with State A law.",
      "Yes, because the man was not served in accordance with State B law."
    ],
    correctAnswer: "No, because the man was served in accordance with federal law.",
    apiMatchOk: true,
    explainImgs: [],
    explanationHtml: ""
  },
  {
    id: 'cp-2-9',
    subject: 'Civil Procedure',
    topic: 'Law Applied by Federal Courts',
    questionText: "A distributor brought a diversity action against a manufacturer in a federal court in State A for breach of contract. The contract was signed in State B and allegedly breached in State C. The distributor filed this action two years after the alleged breach occurred and nine months after discovering the alleged breach. The manufacturer immediately moved to dismiss the action on the ground that the statute of limitations has expired.\nThe statute of limitations in State A is one year from the date on which the alleged breach occurred. The statute of limitations in State C is one year from the date on which the alleged breach was discovered.\nIs the court likely to grant the manufacturer's motion to dismiss the action?",
    options: [
      "No, because the manufacturer failed to file an answer.",
      "No, because the statute of limitations under State C law has not expired.",
      "Yes, because the statute of limitations under State A law has expired.",
      "Yes, because the statute of limitations under State B law has expired."
    ],
    correctAnswer: "No, because the statute of limitations under State C law has not expired.",
    apiMatchOk: true,
    explainImgs: [],
    explanationHtml: ""
  },
  {
    id: 'cp-2-10',
    subject: 'Civil Procedure',
    topic: 'Law Applied by Federal Courts',
    questionText: "A plaintiff brought a diversity action in State A federal court for breach of contract and negligence. The jury returned a verdict in favor of the plaintiff and awarded her damages. The court entered judgment accordingly. The defendant moved for a new trial on the ground that the jury awarded excessive damages.\nFederal common law applies a \"shock the conscience\" test in a review of an allegedly excessive jury verdict. However, State A law applies a much more rigorous \"materially deviates\" test to prevent excessive awards.\nWhat body of law should the federal court apply to rule on the defendant's motion for a new trial?",
    options: [
      "Federal law, because the case was brought in federal court.",
      "Federal law, because the issue is procedural.",
      "State law, because a federal court sitting in diversity must apply state law.",
      "State law, because the issue is substantive."
    ],
    correctAnswer: "State law, because the issue is substantive.",
    apiMatchOk: true,
    explainImgs: ["https://getbar.link/admin-api/infra/file/2/get/q881161.jpg",],
    explanationHtml: ""
  },
  {
    id: 'cp-2-11',
    subject: 'Civil Procedure',
    topic: 'Law Applied by Federal Courts',
    questionText: "In a federal court diversity action by a beneficiary against an insurance company on an insurance claim, a question arose regarding whether the court should apply a presumption that, where both husband and wife were killed in a common accident, the husband died last.\nWhat body of law determines whether this presumption should be applied?",
    options: [
      "Federal statutory law.",
      "The federal common law.",
      "The law of the state whose substantive law is applied.",
      "Traditional common law."
    ],
    correctAnswer: "The law of the state whose substantive law is applied.",
    apiMatchOk: true,
    explainImgs: ["https://getbar.link/admin-api/infra/file/2/get/q881211.jpg",],
    explanationHtml: ""
  },
  {
    id: 'cp-2-12',
    subject: 'Civil Procedure',
    topic: 'Law Applied by Federal Courts',
    questionText: "A buyer brought a diversity suit in State A federal court against a seller for breach of contract. During the case, the seller engaged in fraudulent conduct, attempted to delay the proceedings, and ignored court orders. The judge held the seller in contempt and ordered him to pay a fine. The seller argued that State A law does not authorize a fine under these circumstances and that no federal statute or rule authorizes this fine for contempt.\nIf the seller is correct in his arguments, will he likely succeed in his objection?",
    options: [
      "No, because federal common law allows the court to impose the fine for contempt.",
      "No, because the case was brought in federal court.",
      "Yes, because a federal court sitting in diversity must follow state law.",
      "Yes, because no federal statute or rule authorized the imposition of this fine."
    ],
    correctAnswer: "No, because federal common law allows the court to impose the fine for contempt.",
    apiMatchOk: true,
    explainImgs: ["https://getbar.link/admin-api/infra/file/2/get/q881221.jpg",],
    explanationHtml: ""
  },
  {
    id: 'cp-2-13',
    subject: 'Civil Procedure',
    topic: 'Law Applied by Federal Courts',
    questionText: "A woman filed a class action on behalf of thousands of individuals against an insurance company in a federal court in State A. The individuals sought to recover $20 million in statutory penalties. The company moved to dismiss the case based on a State A statute that prohibits class actions seeking statutory penalties against insurance companies. However, FRCP 23 allows class actions in federal court.\nWill the federal court likely grant the company's motion to dismiss?",
    options: [
      "No, because a state cannot prohibit class actions.",
      "No, because maintenance of a class action in federal court is a procedural issue governed by federal law.",
      "Yes, because the federal court must apply State A substantive law, and State A prohibits this type of class action.",
      "Yes, because there is no federal common law pertaining to class action requirements."
    ],
    correctAnswer: "No, because maintenance of a class action in federal court is a procedural issue governed by federal law.",
    apiMatchOk: true,
    explainImgs: ["https://getbar.link/admin-api/infra/file/2/get/q881231.jpg",],
    explanationHtml: ""
  }
];
