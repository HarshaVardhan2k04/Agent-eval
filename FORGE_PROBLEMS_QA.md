# Forge Problem Catalog — Prompt-Team Q&A

Fill the **Ans)** under each problem with YOUR proven fix — the exact rule, wording, or example
you used when this problem showed up in a real prompt. Write it the way you'd write it INTO a
prompt (or describe the lever precisely). When you send this back, each answer is imported into
the problem matrix as that problem's winning lever, and Gemma's coach reads it verbatim whenever
the problem appears in a run — so the better the answer, the better the coach fixes it your way.

Leave an answer blank if you've never solved that one; write `CODE FILTER` if you believe prompt
edits can't fully fix it and it needs a post-processing filter.

---

### p1 — Instant capitulation (no persistence)
*layer: campaign · category: persistence · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Few-shot, not rules — rules alone fold on the first no. Rule: 'A first no is a reflex, not a decision. Answer it with one warm honest line on why it is worth a moment, then release only on a second no or a clear mismatch.' Add a CAMPAIGN few-shot (bad = instant removal-from-list; good = one warm reframe tied to a real fact, e.g. the finished unit). Verify the persistence reframe->release test passes best-of-3.

---

### p2 — Over-acknowledgment (reflex 'sare andi' / eager beats)
*layer: universal · category: style-ack · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Remove the NEED, don't ban the word. (a) ANSWER-FIRST: open every turn with the useful content, no ack word. (b) DON'T-CONFIRM-COMPREHENSION: 'when the lead states a fact, do not signal you understood, just act on it; acting IS the acknowledgement.' (c) SCRUB the ack words out of your style examples (examples teach the beat as much as rules). Verify ack-openers 0/3.

---

### p3 — Verbatim sentence repetition
*layer: universal · category: repetition · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) 'Never say a sentence or a stock line the same way twice, rephrase it each time' + 'do not volunteer the same thing twice, check your last three turns.' Back it with the deadlock-exit and never-repeat-an-offer rules. Borderline on low-signal (hmm/ok) turns, so verify best-of-9 not best-of-3.

---

### p4 — Language flip to a wrong language on one ambiguous word
*layer: universal · category: language · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Lock to the allowed languages only and judge language from a FULL sentence, never flip on one ambiguous token ('aalo' is not Arabic). 'Detect from the whole last message; one stray word is not a switch; when unsure, stay in the last confirmed language.'

---

### p5 — Follows jokes / tangents
*layer: universal · category: control · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Steer-back: 'At most a three-word ack, then one question back to the goal. Never engage the tangent, never over-agree.' Cap it with the off-topic counter (three off-topic turns -> warmly end).

---

### p6 — Answers hold-music / IVR / system audio
*layer: universal · category: control · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Prompt mitigation: 'If a line is clearly automated, hold music, a recorded menu, or a ringing tone, say nothing and wait; it is not the person.' Root cause is turn-detection, so the residual is CODE FILTER (pipeline turn-detection), not prompt.

---

### p7 — Premature goal-push (pushes the close/visit before qualifying the lead)
*layer: campaign · category: flow · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Discovery-first flow: 'Spend the early stages listening, not presenting. Qualify location, price and configuration before the visit ask. One visit ask per call, built from what THIS person said.' Never ask for the visit until the fit is real.

---

### p8 — Greeting loop / re-introduces itself
*layer: universal · category: flow · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) 'The greeting is already spoken by the system, never greet or introduce yourself again. Continue the conversation, do not restart it.' Verify 0 re-intros.

---

### p9 — Bookish / textbook register (stiff printed-form words)
*layer: universal · category: style-register · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Register rules + a banned_register list (the bookish/Sanskritized words) + 'talk like a real person on the phone, not a brochure.' Plateaus ~8% prompt-only (model-baked) -> CODE FILTER for the last mile.

---

### p10 — Robotic bot-words ('I understand','got it','certainly')
*layer: universal · category: style · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Name the exact reflexes to kill: 'Never open with I understand, I see, got it, of course, certainly, rest assured, understood' + ANSWER-FIRST. It shifts to secondary reflexes, so extend the list a few tokens at a time. Plateaus ~30-50% at scale -> decoding logit_bias down the bot-word token-ids takes it to a deterministic 0 (CODE / llm_params).

---

### p11 — Rule / example bloat (too many rules dilute earlier ones)
*layer: universal · category: meta · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) De-bloat: consolidate to ~12-15 tight, ordered rules. Adding rules at the top silently demotes earlier ones. In a LAYERED prompt watch the MERGED rule count (arrays concat across layers) and use override_keys to REPLACE not append.

---

### p12 — Objection handling incomplete
*layer: vertical · category: objection · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) An objection_handling block with one honest fact per objection. EMPIRICAL AUDIT: test each objection against the live model and keep ONLY the lines it fails without; delete the rest (the model handles most on its own).

---

### p13 — Sarcasm mirrored back
*layer: universal · category: tone · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) 'Read the real point under the sarcasm and answer it warmly and plainly in one line. Never match the sarcasm, never be witty at the person, their question, or their situation.'

---

### p14 — Company identity confused (says a city, not the company)
*layer: campaign · category: identity · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) 'Always answer with the company or project name, never a city or area.' Plus a fixed pronunciation entry ('Ohm Shree, never Om Sree or Aum Sree'). Campaign layer.

---

### p15 — Code-mix wrong (over-pure or over-English)
*layer: universal · category: language · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) 'The local language carries the grammar and the verb endings; English carries the nouns, numbers and technical terms.' The lever that makes it STICK is a code-mix register FEW-SHOT (one good example per language showing English nouns inside a native-script sentence), not just the rule.

---

### p16 — Numbers said in local words or as digits
*layer: universal · category: language · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) 'Numbers are always English words, never digits and never local-language numbers.' The rule fixes the agent's OWN numbers but only halves the ECHO of the caller's local number, so add FEW-SHOT conversion examples (caller 'muppai tommidi' -> 'thirty nine'). Few-shot beats the rule here.

---

### p17 — Pivot / qualifying question re-asked in a loop
*layer: universal · category: loop · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Pivot-cap inside a loop-and-exit counter: ask the qualifying question at most twice, then stop. The model won't reliably count its own asks, so validate on the STRICT detector; the stonewaller residual needs a CODE dedup guard.

---

### p18 — Deadlock / stonewaller repeat-loop
*layer: universal · category: loop · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) 'If they press the exact same demand after you have answered it two different ways, do not answer a third time. Say the team can take it further, offer a callback, and close.' The repeated goodbye TEXT was itself the verbatim-repeat, so pair it with the end_call tool rule. Verify with the tool ATTACHED (loop 0/6).

---

### p19 — Rushed-but-open lead dropped instead of captured
*layer: campaign · category: flow · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) 'On any openness, even a rushed yes, keep it brief but take them through the flow quickly; never drop them with a vague I will call later; capture the callback and a rough time before releasing.'

---

### p20 — Grieving / distressed caller gets a pitch
*layer: universal · category: safety · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Explicit PRECEDENCE: 'If the person is grieving or in real distress, give comfort only, no question, no information, no reason for the call, no pitch. This OVERRIDES every other instruction.' Without the override, a general rule (reason-before-ask) violates it. Verify grieving 50/50 varied.

---

### p21 — Won't end on a hard / second no
*layer: universal · category: ending · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) 'An explicit stop or a second refusal -> say your short goodbye and call end_call now. No further reframe, no counter-pitch, never ask why more than once.'

---

### p22 — Won't end on 3-4 irrelevant turns (won't 'give up')
*layer: universal · category: ending-loop · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) HOW-TO-ACTUALLY-END: end_call is a TOOL you INVOKE (speak the goodbye as content, then call the tool; never type the token) + a concrete off-topic counter (after three off-topic turns, warmly end). The model won't reliably self-count, so the residual is a model-limit; verify with the tool attached.

---

### p23 — Won't end on a natural wind-down
*layer: universal · category: ending · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) 'You do not need them to say bye. When they give only ack tokens with no new question, read the wind-down and close yourself, warmly.'

---

### p24 — Cuts off a still-curious lead
*layer: universal · category: ending · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) 'Never end while they are asking real questions, even after a booking; answer it or defer to the team, then end.' Pair with ENGAGEMENT-RESETS so a curious lead never trips the exit counter.

---

### p25 — Abrupt / scripted ending
*layer: universal · category: ending · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) 'End with one short warm line, thanks plus a kind goodbye, varied, never a canned sign-off.' Mechanically: speak the goodbye as normal content, then call the no-arg end_call (wait_for_playout lets it finish).

---

### p26 — Asks the qualifying question cold (no reason given)
*layer: vertical · category: flow · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) LEAD-WITH-THE-REASON: the first question must carry its why ('we do a quick free check on your X, do you already have one?'). The lead should never have to ask 'why are you asking'.

---

### p27 — Trust objection ('why free / what's the catch') loops
*layer: campaign · category: trust · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Answer the honest money question IMMEDIATELY on the first ask, never preface with 'no catch' (reads evasive). Say the real model once ('we earn a small commission from the provider only if you buy, built into the price, never extra from you'), then let it rest. Needs the real business model from intake.

---

### p28 — Presumptive booking / books without consent
*layer: campaign · category: consent · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) ASK-THE-TIME-NEVER-DECLARE: offer as a question; when they agree, ask for THEIR convenient time; it is booked only once they give one; never announce 'the advisor will call tomorrow' and hang up. But don't over-gate, a clear ok/yes IS consent.

---

### p29 — Can't-hear / needs-repetition loop
*layer: universal · category: channel · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) 'If they keep saying they cannot hear you, never repeat the pitch (useless to someone who can't hear it). One short line at most, and after two tries offer a callback on a clearer line and close.' Carve it OUT of any engagement-reset. Verify with the tool attached (loop 0/6).

---

### p30 — Language drift (agent picks a language the lead didn't use)
*layer: universal · category: language · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) MIRROR-EVERY-TURN: reply in the language of their LAST message; start in the default and only switch on a full sentence; make acknowledgements language-aware (English acks on English turns) so they don't seed drift. Verify an English-only lead over 4-5 turns = 0 drift.

---

### p31 — Formatting characters in output (em-dash brackets bullets escapes)
*layer: universal · category: output · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) SPOKEN-WORDS-ONLY: commas not dashes, no markdown/brackets/escapes/emoji, numbers as words. A strong version reaches ~0 on a good model, but a leaky model (em-dash ~90%) needs the reliable last mile: CODE FILTER (a tiny tts_clean sanitizer before TTS).

---

### p32 — Too transactional / lacks empathy
*layer: universal · category: tone · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) A-LITTLE-EMPATHY placed AFTER persistence, with 'empathy != surrender': name a REAL feeling in a few words before helping, one line only, never on a neutral turn, never a speech.

---

### p33 — No-policy branch doesn't name concrete options
*layer: vertical · category: flow · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) In the not-covered branch, NAME a few concrete options ('three BHK or four BHK'; or motor/health/life for insurance) so it is concrete, no pressure, and reassure that a human guides them.

---

### p34 — Inbound/follow-up flow references outbound steps that get sliced out
*layer: universal · category: flow-parsing · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Each call-DIRECTION flow must be SELF-CONTAINED. The service slices flow by direction, so an inbound step referencing 'step_3a above' (which lives in outbound) gets sliced out. Inline the shared steps verbatim into every direction. Verify by testing with the flow actually sliced.

---

### p35 — Loop/ending fix over-ends genuine (slow/short) leads
*layer: universal · category: ending-regression · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) ENGAGEMENT-RESETS-EVERYTHING: any product answer, question, or interest resets the exit counters; counters apply ONLY to a purely-disengaged lead. Carve out refusals (still release) and can't-hear (own rule). ALWAYS measure the booking rate before vs after an ending change, bookings are the KPI.

---

### p36 — Restate-the-question preamble / bookish register (model-training-baked)
*layer: universal · category: output/model-limit · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Rule ('give the value, never a preamble that restates the question') + a generic answer-directly few-shot helps the clearest cases, but rules, few-shot, decoding and same-model rewrite ALL PLATEAU, it is baked into a small-active-param model. CODE FILTER: strip a leading 'the <subject> is/are' preamble before TTS, OR a NON-same-model cleaner; a bigger/denser base model fixes it best. Validate on a VARIED LLM-judged detector, never a narrow regex (a narrow regex once falsely reported 0%).

---

### p37 — Layered conversation_flow: a status stage references another status's stage that gets sliced out
*layer: universal · category: flow-parsing · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Only the ONE stage matching lead_status is sent, so 'run stage three of the fresh flow' dangles when the fresh block is sliced out. Inline the shared stages verbatim into every status that needs them; never cross-reference. Verify by building the merged prompt at each lead_status and grepping for cross-stage references.

---

### p38 — Busy-opener over-release (agent drops a lead who opens 'I am busy')
*layer: campaign · category: flow · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) PRODUCT DECISION, not a defect, a busy lead getting a callback is correct anti-hard-sell. If you want more bookings, add for already-qualified/interested leads: 'one quick capture line before releasing a busy opener' (a single visit line, then release if still busy). Keep fresh/atc discovery-first (do not push a cold busy lead). The eval criterion must CREDIT a correct busy-release.

---

### p39 — end_call goodbye leaked as spoken text
*layer: universal · category: tool-invocation/output · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Don't put the goodbye in a tool 'message' arg, the model then leaks the whole end_call{message:...} as spoken text. Rule: 'Speak your short goodbye as your normal reply, THEN call end_call with NO arguments to hang up; never put the goodbye in the tool, never type the tool name.' Parse/strip the leaked token in the plugin as defense (CODE FILTER).

---

### p40 — Fix landed in the wrong layer (leaks across agents)
*layer: universal · category: structure/multi-level · not auto-tested yet*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) Apply the 'how many agents should ever see this?' test: universal = every agent, vertical = one domain (never a company fact), campaign = one campaign. A company-named few-shot belongs in CAMPAIGN, never vertical (it leaks to sibling companies). Dedupe when moving content; watch the merged rule count for array-concat bloat; use override_keys to replace not append.

---

### p41 — Over-long answers / yapping (5-6 line paragraphs on a voice call)
*layer: universal · category: output/model-tendency · auto-tested*

Q) When the agent shows this behaviour, what exactly do you add/change in the prompt to fix it — and how do you make sure it stays fixed?

Ans) 'One or two short sentences per turn, then stop. Give the headline and OFFER the rest, never dump every part, never a paragraph, never a list read aloud' + a long-bad/short-good few-shot + a length self-check ('if it runs past two sentences or forty words, cut it'). Prompt HELPS but PLATEAUS (the model over-explains). Reliable enforcement = a tuned max_tokens cap in llm_params (~60-64 so it stops cleanly; too low cuts mid-sentence) + a bigger model. Measure with length_check.py (words + sentences per turn).

---
