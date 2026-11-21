/**
 * The four fences of the 2026-11-20 round-1 stress test (91 real MiniMax-M3.1-Flash answers, mermaid@12.2.0
 * in Chrome) that did not render, verbatim. Evidence: PaperTree-evidence/v0.3-build/mermaid-test/ROUNDS.md and
 * fences-r1.jsonl. The repair tests are built from these, not from invented text.
 */

/** There can be only one root (a node indented less than the root, with <br> labels). */
export const MINDMAP_SECOND_ROOT =
  'mindmap\n  root(("SuperGLUE"))\n Design["Design process<br/>substance, difficulty, evaluability,<br/>public data, format, license"]\n      Filter["~30 proposals filtered<br/>by BERT + human baselines"]\n    Tasks["9 tasks<br/>tokens to paragraphs"]\n    Scoring["Equal-weight average<br/>of task scores"]\n    Diagnostics["Diagnostics"]\n      Linguistic["GLUE diagnostic set<br/>two-way entailment"]\n      Bias["Winogender<br/>gender parity"]\n    Baselines["Calibration ladder"]\n      Majority["Majority class"]\n      BoW["Bag-of-words GloVe"]\n      BERT["BERT fine-tuned"]\n      BERTPlus["BERT++ STILTs<br/>MultiNLI, SWAG"]\n      Outside["Best known result"]\n      Human["Human performance"]\n    Tools["jiant toolkit<br/>eligibility and data rules"]';

/** two statements on one line: `--> quiz  pool2 --> quiz`. */
export const FLOWCHART_TWO_STATEMENTS_A =
  'flowchart TD\n  pool["Pool of 25 titles and subtitles from newser.com"] --> prompt["Prompt = title + subtitle"]\n  shots["Three previous news articles in the context"] --> prompt\n  prompt --> gen["Model generates ~200-word article"]\n  gen --> pool2["Output formatted and selected programmatically"]\n  real["Real human article, mean 215 words"] --> quiz  pool2 --> quiz["Quiz shown to ~80 US participants"]\n  quiz --> verdict["Five-way answer: very likely human to very likely machine"]\n  verdict --> acc["Accuracy = correct / non-neutral answers"]\n  ctrl["Control model: 160M params, no context, high randomness"] --> quiz\n  acc --> acc2["86% on control vs 52% on GPT-3 175B"]';

/** two statements on one line: `cat --> wo  wo --> out`. */
export const FLOWCHART_TWO_STATEMENTS_B =
  'flowchart LR\n  subgraph phase1["Phase 1: project"]\n    q["Queries Q"] --> wq["Per-head projections WQ i, WK i, WV i"]\n    k["Keys K"] --> wq\n    v["Values V"] --> wq\n  end\n  subgraph phase2["Phase 2: parallel attention"]\n    h1["Head 1 attention on 64 dims"]\n    h2["Head 2 attention on 64 dims"]\n    h8["Head 8 attention on 64 dims"]\n  end\n  wq --> h1\n  wq --> h2\n  wq --> h8\n  subgraph phase3["Phase 3: concatenate"]\n    cat["Concat of 8 head outputs"]\n  end\n  h1 --> cat\n  h2 --> cat\n  h8 --> cat\n  subgraph phase4["Phase 4: output projection"]\n    wo["Final projection by WO"]\n    out["dmodel-dimensional result"]\n  end\n  cat --> wo  wo --> out';

/** parentheses in node text: `Learn F(x) = H(x) - x`. */
export const MINDMAP_PARENTHESES =
  'mindmap\n  root(("Residual Learning"))\n    Problem["Degradation problem"]\n      Deeper plain net worse than shallower\n      Not vanishing gradients, BN keeps signals healthy\n    Idea["Residual block y = F(x) + x"]\n      Learn F(x) = H(x) - x\n      Identity shortcut, no extra parameters\n      Projection W_s x or zero padding\n    Architectures["Network design"]\n      Plain baseline in VGG style\n      2-layer and 3-layer F\n      Bottleneck block for ResNet-50/101/152\n    Evidence["Experiments"]\n      ImageNet: 34-layer ResNet beats 18-layer\n      CIFAR-10: up to 1202 layers train\n      Layer responses get smaller, near identity\n      Detection: Faster R-CNN with ResNet-101';
