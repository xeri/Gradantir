# Life-signals — a state desk priced on its own record

*2026-07-29 · status: approved, in progress*

## Problem

Everything the engine has seen so far is outcome — a mark, a call, a duel result. But a student
carries state the tape never sees: how many hours actually went in this fortnight, whether last
night was a six-hour night before the paper, which topics the last marked script proved shaky,
whether the syllabus is the kind where a shaky prerequisite caps everything built on it. That state
is high-value-density and currently priced at zero. Refusing to touch it is not neutrality — §26–29
already established that declining to price private information is a choice.

## Shape

Five new input slices (`topics`, `topicMarks`, `sessions`, `rest`, `disruptions`) plus subject
traits/mix/belief and a psych profile, filed by hand or transcribed by the Wire from marked papers,
sleep exports and syllabi. A pure engine package, `src/lib/quant/signals/`, reads them **as-of** and
turns them into a level adjustment and a variance widening on the desk's own `nextExam` call — a
fifth priced channel beside bias, self, aggregate and wire, but seated differently: it moves the
house side of the pool, not a member of it. A walk-forward scorer earns its weight the same way
§26 earns everything else, and a VOI layer tells the student which log is worth the next ten minutes.

## Decisions

1. **Every signal term is deviation-shaped, not level-shaped.** `stock.ts`'s `k14` term is
   `STOCK_W · tanh((k14 − baseline)/baseline)`, `mastery.ts`'s term compares `100P` against the
   model's own `modelMean`, `rest.ts`'s chronic term fires only on `mean56 − mean14` widening — a
   student who studies, sleeps and performs exactly the way they always have gets `adj ≈ 0` on
   every desk. This is what stops the channel double-counting against `biascal.ts`: bias correction
   already absorbs a subject's *steady-state* miscalibration, so a signal term is only entitled to
   claim the *change*.
2. **The channel sits house-side, not pool-side.** Signals adjust the desk's own `nextExam` read
   *before* the self/wire pool runs — the same seat `biascal.ts` occupies — so it is not a member
   under `POOL_CEIL = 0.6` and does not compete with `you`/`wire` for that 60%. `applySignals` runs
   ahead of `poolBoardJoint` in `App.tsx`; `rawStats` and the register stay untouched, so every fit
   (including the channel's own `signalSkill`) still reads strictly-earlier, unadjusted history.
3. **The weight is earned, at a state-channel discount.** `quant/params.ts` gains
   `SIGNAL_KAPPA = 2` (the readiness-channel precedent — exam rounds are scarce, shrinkage gentler
   than the 4-round pools), `SIGNAL_CAP = 0.35` (a self-logged state channel, held below
   `SELF_POOL_CAP = 0.45`), and `SIGNAL_PRIOR = 0.3` — lower than `READINESS_PRIOR = 0.4` because a
   signal read makes a *level* claim on the forecast where readiness only nudges premia. At zero
   scored rounds `signalSkill` returns `w = SIGNAL_PRIOR`, multiplying an `adj` of 0 on an empty
   book — the prior is real but inert until there is a book to read.
4. **The variance claim is ungated.** `traits.ts`'s `sdMult` — marker noise from low determinism,
   sampling noise from low breadth compounded by uneven topic mastery — applies at full strength
   whenever `signalWeighting` is on, with no `earnedWeight` shrinkage in front of it. A widening is
   a humility claim, not a directional bet; §27 sets the precedent — the pool's disagreement term
   $w(1-w)(\mu_y-\mu_m)^2$ is never earned-gated either.
5. **Belief and absolute chronic sleep are demoted out of the level term.** `Subject.belief`
   (self-efficacy) and raw sleep hours are static scalars, not deviations, so pricing them as a
   level claim would be exactly the double-count Decision 1 rules out. `belief` feeds `traits.ts`'s
   variance nudge and `voi.ts` only; chronic sleep only ever enters as `mean56 − mean14`, never as
   an absolute number against some assumed-ideal.
6. **TopicMark carries a dual foreign key, and the sanitizer enforces agreement.** A `TopicMark`
   points at both a `topicId` and an `entryId`; if the topic's `subjectId` and the entry's
   `subjectId` disagree, the row is dropped by `sanitizeTopicMark` — a mark cannot silently attach a
   paper to the wrong desk's syllabus. The audit-trail doctrine runs the other way too: a marked
   paper not already on the tape is filed as a `GradeEntry` first, so a `TopicMark` is never
   evidence for a mark the book cannot show.
7. **Identity on the committed fixture holds everywhere, by construction.** `book.json` carries no
   signal slices, so `signalBoard` returns `adj=0, sdMult=1, terms:[]` on every desk, `applySignals`
   returns the **same array reference**, and `signalSkill` returns the identity object at
   `enabled: false` — `npm run gate`, README §21 and `mark.book.test.ts` are unmoved.
   `Settings.signalWeighting` follows the other student-input switches' polarity (absent ⇒ ON),
   stored only when `false`.
8. **Three source-ranking items are cut, and the ranking itself is the authority for cutting them.**
   Tier 3 of the source spec ranking is out of scope entirely; #26 (grade-boundary proximity) and
   #27 (question-exposure/leak scraping) need scraping infrastructure a localStorage app will never
   have; #19 (a distraction index) needs an OS-level attention API nothing here has access to.
9. **Storage grows by five slices, three field additions, and one version bump.** `AppData` gains
   `topics`, `topicMarks`, `sessions`, `rest`, `disruptions`; `Subject` gains
   `traits/mix/belief/attendancePct`; `Settings` gains `profile`; `Upcoming` gains `hour`.
   `EXPORT_VERSION` moves 9 → 10. Five matching Wire sections let an external AI transcribe marked
   papers into `TopicMark` rows, a sleep export into `RestLog` rows, and a syllabus into
   `Topic`/`SubjectTraits` — the same transcribe-only discipline §29 already holds forecasts to.
10. **The scorer replays the register walk-forward, on the register's own terms.** `signalskill.ts`
    reads each resolved `ForecastLog` round as-of `log.resolvedAt`, rebuilds the as-of signal book
    (sessions/rest/disruptions filtered by date, topic marks by their entry's date, chronotype
    excluded because a past sitting's `hour` was never knowable then), and scores the adjusted and
    raw call with the same `scoreT` CRPS rule side-by-side — the matched-scoring discipline §27
    already uses. Rounds where `adj === 0 && sdMult === 1` are skipped before scoring — a term that
    read no data made no claim, and crediting the channel for silence would manufacture evidence
    that was never there.

## Files

New: `src/lib/quant/signals/{params,stock,mastery,rest,disrupt,traits,signalread,apply,signalskill,voi}.ts`
(+ one test per module, `signals.book.test.ts` for the fixture-identity proof) ·
`src/views/signals/{index,LogPanels,MasteryPanel,TraitsEditor,VoiPanel}.tsx` (+ tests) ·
`src/lib/derive/signals.ts`. Touched: `types.ts` (new stored types + field additions), `io.ts`
(v10, five sanitizers, envelope), `storage.ts` (`coerceStored`), `wire/{schema,prompt,parse,review}.ts`
(five sections, prompt guidance blocks), `ledger.ts` (five sections), `App.tsx` (`signalBook`,
`signalReads`, `signalFit`, `signalled`, `pooled` now reads `signalled`, `voi`, view + switch +
command), `derive/{index,types,facts}.ts` (`signal.adjust/stock/mastery/voi` builders), `quant/params.ts`
(`SIGNAL_KAPPA/SIGNAL_CAP/SIGNAL_PRIOR`), README §30.

## Verification

`npm test` green at every task boundary · `npm run gate` clean against `baseline.json` (fixture
carries no signal data, so walk-forward CRPS cannot move) · `npm run gen:table` byte-identical to
the pre-feature §21 · `npm run build` (tsc) clean, which also proves the Wire's `satisfies` locks
are satisfied against the grown `Subject`/`Upcoming` types. Status: approved, in progress — this
document's Verification section gets real pass counts and the gate's before/after skill number in
Task 20, once the full plan lands.
