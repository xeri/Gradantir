import { useEffect, useRef, useState } from "react";
import { C, FONT, microLabel } from "../../theme";
import { Field, inputCls, inputStyle } from "../../components/ui/Field";
import { clamp } from "../../lib/utils";
import type { Chronotype, Profile, Subject, SubjectMix, SubjectTraits } from "../../types";

/**
 * D5 · TRAITS/PROFILE EDITOR — the one control in the SIGNALS view that has
 * to defend DRAFT-THEN-COMMIT against a real, high-frequency input.
 *
 * App.tsx's `update()` serialises the WHOLE book (`saveData` stringifies
 * every slice, not just the one that changed) on every call — so a slider
 * that fired its handler per drag frame would file that whole-book write
 * once per pixel of pointer motion. Every slider here instead writes to a
 * LOCAL draft on drag (native `input`, which React's `onChange` fires
 * continuously) and commits — one call, to one handler — only once the drag
 * ends (`pointerup`/`pointercancel`) or a keyboard nudge lands (`keyup`).
 * This is the same split `EffortCard`/`SpiderAllocator` (D1) already hold for
 * the effort spider: `apply()` touches only React state, `commit()` is the
 * only thing that ever calls a prop. A `draftRef` sits beside the draft
 * state for the same reason it does there — several drag frames land inside
 * one React batch, so `commit()` (fired from a native event, not a state
 * setter) must read the LATEST value, not whatever `draft` closed over when
 * the handler was bound.
 *
 * TWO independent draft groups, each with its own single-call commit:
 *   1. SUBJECT fields (traits C/D/B, the mix, belief, attendance) — scoped
 *      to whichever desk the picker has selected; switching desks resets the
 *      draft to that desk's own stored values (or a neutral default), the
 *      same "a new key is a new draft" rule EffortCard holds for `roundKey`.
 *   2. The PERSON PROFILE (chronotype, test anxiety) — not subject-scoped,
 *      shown once regardless of which desk is picked.
 * A drag on one group never calls the other group's handler: dragging a
 * trait cannot fire `onSaveProfile`, and vice versa.
 *
 * MIX STAYS NORMALISED BY CONSTRUCTION. `io.ts`'s `sanitizeMix` renormalises
 * knowledge+procedure+skill to sum to 1 on every load — so a mix that did
 * NOT already sum to 1 would visibly change under the student the next time
 * they opened the app. Rather than let that happen and rely on the loader to
 * quietly fix it, dragging one share here rebalances the OTHER TWO pro-rata
 * (exactly `allocate.ts`'s `rebalance` for the effort spider, just over a
 * fixed sum of 1 instead of a fixed token total): the committed mix always
 * already sums to 1, so `sanitizeMix`'s renormalisation on the next load is
 * a numerical no-op.
 *
 * COMMIT ONLY WHAT WAS ACTUALLY TOUCHED (T17 review finding). `SubjectTraitsPatch`
 * carries each of traits/mix/belief/attendancePct as OPTIONAL: a `dirtyRef` set
 * accumulates which groups were dragged since the last commit, and `commit()`
 * includes only those keys in the patch it hands to `onSaveTraits`. This matters
 * because the mastery engine (mastery.ts/params.ts) treats "never set" and "set to
 * a neutral default" as DIFFERENT states — a null `traits` turns prereq gating off
 * entirely, and a null `mix` decays at `DEFAULT_HALF_LIFE` rather than the blended
 * half-life an even mix produces — so writing all four groups unconditionally on
 * every commit (the pre-review behaviour) would silently change a desk's priced
 * mastery term the moment the student dragged ANY one slider, including three
 * priors they never touched. A patch that omits an untouched group leaves that
 * field exactly as it was on the subject; App.tsx's `saveSubjectTraits` merges
 * only the keys present, never stamping the other three.
 */

const TRAIT_KEYS: { key: keyof SubjectTraits; label: string; hint: string }[] = [
  { key: "cumulativeness", label: "CUMULATIVENESS", hint: "how much a result depends on everything before it" },
  { key: "determinism", label: "DETERMINISM", hint: "how mechanically gradable the material is" },
  { key: "breadth", label: "BREADTH", hint: "how much syllabus one paper can cover" },
];

const MIX_KEYS: { key: keyof SubjectMix; label: string }[] = [
  { key: "knowledge", label: "KNOWLEDGE SHARE" },
  { key: "procedure", label: "PROCEDURE SHARE" },
  { key: "skill", label: "SKILL SHARE" },
];

const DEFAULT_TRAITS: SubjectTraits = { cumulativeness: 0.5, determinism: 0.5, breadth: 0.5 };
const DEFAULT_MIX: SubjectMix = { knowledge: 1 / 3, procedure: 1 / 3, skill: 1 / 3 };
const DEFAULT_BELIEF = 3;
const DEFAULT_ATTENDANCE = 100;
const DEFAULT_ANXIETY = 3;

/** Drag one mix share to `next`, rebalancing the other two pro-rata so the
 *  three always sum to exactly 1 — the fixed-sum-1 twin of `allocate.ts`'s
 *  token rebalance. An all-zero remainder (both others already at 0) splits
 *  the freed share evenly rather than dividing by zero. */
function rebalanceMix(mix: SubjectMix, key: keyof SubjectMix, next: number): SubjectMix {
  const value = clamp(next, 0, 1);
  const others = MIX_KEYS.map((m) => m.key).filter((k) => k !== key);
  const restSum = others.reduce((a, k) => a + mix[k], 0);
  const poolTarget = 1 - value;
  const out = { ...mix, [key]: value } as SubjectMix;
  if (restSum > 0) {
    for (const k of others) out[k] = (mix[k] / restSum) * poolTarget;
  } else {
    for (const k of others) out[k] = poolTarget / others.length;
  }
  return out;
}

/** What a commit actually hands to `onSaveTraits` — only the group(s) touched
 *  since the last commit, so an untouched group is never stamped (see the file
 *  doc comment, "COMMIT ONLY WHAT WAS ACTUALLY TOUCHED"). */
export interface SubjectTraitsPatch {
  traits?: SubjectTraits;
  mix?: SubjectMix;
  belief?: number;
  attendancePct?: number;
}

/** The full local draft — always fully populated (from the subject's own values
 *  or a neutral default) so every slider always has a number to render. Distinct
 *  from `SubjectTraitsPatch`: only a SUBSET of this ever reaches `onSaveTraits`. */
interface TraitsDraft {
  traits: SubjectTraits;
  mix: SubjectMix;
  belief: number;
  attendancePct: number;
}

type TraitGroup = keyof TraitsDraft;

export interface TraitsEditorProps {
  /** Live desks only — a delisted desk has no line to set a shape prior on. */
  subjects: Subject[];
  /** Person-level, not tied to any one subject. */
  profile: Profile | null;
  onSaveTraits: (subjectId: string, patch: SubjectTraitsPatch) => void;
  onSaveProfile: (profile: Profile) => void;
}

const hintStyle = { color: C.faint, fontFamily: FONT.mono } as const;

/** One range control: draft-only on drag (`input`), commits on release. */
function Slider({
  label, hint, value, min, max, step, format, onDraft, onCommit,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onDraft: (v: number) => void;
  onCommit: () => void;
}) {
  const NUDGE = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
  return (
    <label className="block">
      <span className="flex items-center justify-between mb-1" style={{ ...microLabel, color: C.faint }}>
        <span>{label}</span>
        <span style={{ color: C.text }}>{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onDraft(Number(e.target.value))}
        onPointerUp={onCommit}
        onPointerCancel={onCommit}
        onKeyUp={(e) => { if (NUDGE.has(e.key)) onCommit(); }}
        className="gx-focus w-full accent-current"
        style={{ accentColor: C.accent }}
        aria-label={label}
      />
      {hint && <span className="block mt-0.5 text-[10px] normal-case tracking-normal" style={hintStyle}>{hint}</span>}
    </label>
  );
}

export function TraitsEditor({ subjects, profile, onSaveTraits, onSaveProfile }: TraitsEditorProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  /* SIGNALS mounts this editor with `liveSubs`, which can go from [] to
     non-empty (or swap desks entirely) WITHOUT a remount — a book whose desks
     are all delisted, relisted without leaving the floor. `subjectId` state has
     no re-sync effect, so a stale/empty value must be derived fresh every
     render rather than trusted once `subjects` moves under it (T17 review
     finding): before this, `subject` below resolved to null forever, and
     `commit()`'s `if (subject)` guard silently swallowed every drag. */
  const sid = subjects.some((s) => s.id === subjectId) ? subjectId : (subjects[0]?.id ?? "");
  const subject = subjects.find((s) => s.id === sid) ?? null;

  const filedTraits = (s: Subject | null): TraitsDraft => ({
    traits: s?.traits ?? DEFAULT_TRAITS,
    mix: s?.mix ?? DEFAULT_MIX,
    belief: s?.belief ?? DEFAULT_BELIEF,
    attendancePct: s?.attendancePct ?? DEFAULT_ATTENDANCE,
  });

  const [draft, setDraft] = useState<TraitsDraft>(() => filedTraits(subject));
  const draftRef = useRef(draft);
  /* Which draft groups were actually dragged since the last commit — cleared
     on every commit and on every subject switch. Only these keys ever reach
     `onSaveTraits` (see the file doc comment, "COMMIT ONLY WHAT WAS ACTUALLY
     TOUCHED"): committing belief alone must never also stamp DEFAULT_TRAITS/
     DEFAULT_MIX/DEFAULT_ATTENDANCE onto a desk that never set them. */
  const dirtyRef = useRef<Set<TraitGroup>>(new Set());
  /* A newly picked subject is a new draft — nothing carries over from the
     one it replaced, the same rule EffortCard holds for `roundKey`. */
  useEffect(() => {
    const next = filedTraits(subject);
    draftRef.current = next;
    setDraft(next);
    dirtyRef.current = new Set();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  /* Builds the next draft from `draftRef.current`, not the `draft` state
     variable: several drag frames land inside one React batch, so the NEXT
     drag frame must read the LATEST value `commit()` will also read, not
     whatever `draft` closed over when this render's handler was bound. */
  const apply = (patch: TraitsDraft, group: TraitGroup) => {
    draftRef.current = patch;
    setDraft(patch);
    dirtyRef.current.add(group);
  };
  const commit = () => {
    if (!subject || dirtyRef.current.size === 0) return;
    const d = draftRef.current;
    const patch: SubjectTraitsPatch = {};
    if (dirtyRef.current.has("traits")) patch.traits = d.traits;
    if (dirtyRef.current.has("mix")) patch.mix = d.mix;
    if (dirtyRef.current.has("belief")) patch.belief = d.belief;
    if (dirtyRef.current.has("attendancePct")) patch.attendancePct = d.attendancePct;
    onSaveTraits(subject.id, patch);
    dirtyRef.current = new Set();
  };

  const setTrait = (key: keyof SubjectTraits, v: number) =>
    apply({ ...draftRef.current, traits: { ...draftRef.current.traits, [key]: clamp(v, 0, 1) } }, "traits");
  const setMixShare = (key: keyof SubjectMix, v: number) =>
    apply({ ...draftRef.current, mix: rebalanceMix(draftRef.current.mix, key, v) }, "mix");
  const setBelief = (v: number) => apply({ ...draftRef.current, belief: Math.round(clamp(v, 1, 5)) }, "belief");
  const setAttendance = (v: number) => apply({ ...draftRef.current, attendancePct: Math.round(clamp(v, 0, 100)) }, "attendancePct");

  /* The profile draft — independent of the subject picker entirely. */
  const [profileDraft, setProfileDraft] = useState<Profile>(() => ({
    chronotype: profile?.chronotype ?? null,
    testAnxiety: profile?.testAnxiety ?? DEFAULT_ANXIETY,
  }));
  const profileDraftRef = useRef(profileDraft);
  /* Re-syncs the draft whenever the incoming `profile` prop itself changes
     (identity, not value — App.tsx only ever hands down a new `settings.profile`
     object when it actually changed, so this never fires on unrelated re-renders).
     Without this, an import landing elsewhere (e.g. Settings) while SIGNALS stays
     mounted was never reflected here, so the next anxiety commit would write the
     PRE-IMPORT chronotype back over the just-imported one (T17 review minor). */
  useEffect(() => {
    const next: Profile = { chronotype: profile?.chronotype ?? null, testAnxiety: profile?.testAnxiety ?? DEFAULT_ANXIETY };
    profileDraftRef.current = next;
    setProfileDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);
  const applyProfile = (p: Profile) => { profileDraftRef.current = p; setProfileDraft(p); };
  const commitProfile = () => onSaveProfile(profileDraftRef.current);
  /* A discrete choice, not a drag — commits the moment it's picked. */
  const pickChronotype = (c: Chronotype) => {
    const next = { ...profileDraft, chronotype: profileDraft.chronotype === c ? null : c };
    applyProfile(next);
    onSaveProfile(next);
  };
  const setAnxiety = (v: number) => applyProfile({ ...profileDraft, testAnxiety: Math.round(clamp(v, 1, 5)) });

  if (subjects.length === 0) {
    return (
      <p className="text-[11px] uppercase tracking-wider leading-relaxed" style={hintStyle}>
        LIST A SUBJECT TO SET ITS SHAPE PRIORS.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <Field label="SUBJECT">
        <select
          className={inputCls + " cursor-pointer font-semibold"}
          style={inputStyle}
          value={sid}
          onChange={(e) => setSubjectId(e.target.value)}
        >
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>

      <div>
        <span className="block mb-2" style={{ ...microLabel, color: C.faint }}>SHAPE PRIORS — HOW THIS DESK'S OWN MATERIAL BEHAVES</span>
        <div className="space-y-3">
          {TRAIT_KEYS.map((t) => (
            <Slider
              key={t.key}
              label={t.label}
              hint={t.hint}
              value={draft.traits[t.key]}
              min={0} max={1} step={0.05}
              format={(v) => v.toFixed(2)}
              onDraft={(v) => setTrait(t.key, v)}
              onCommit={commit}
            />
          ))}
        </div>
      </div>

      <div>
        <span className="block mb-2" style={{ ...microLabel, color: C.faint }}>ASSESSMENT MIX — SUMS TO 1</span>
        <div className="space-y-3">
          {MIX_KEYS.map((m) => (
            <Slider
              key={m.key}
              label={m.label}
              value={draft.mix[m.key]}
              min={0} max={1} step={0.05}
              format={(v) => v.toFixed(2)}
              onDraft={(v) => setMixShare(m.key, v)}
              onCommit={commit}
            />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Slider
          label="BELIEF"
          hint="self-rated confidence in current standing, 1 (worst) - 5 (best)"
          value={draft.belief}
          min={1} max={5} step={1}
          format={(v) => String(v)}
          onDraft={setBelief}
          onCommit={commit}
        />
        <Slider
          label="ATTENDANCE"
          hint="attendance rate for this subject"
          value={draft.attendancePct}
          min={0} max={100} step={1}
          format={(v) => `${v}%`}
          onDraft={setAttendance}
          onCommit={commit}
        />
      </div>

      <div className="border-t pt-4" style={{ borderColor: C.line }}>
        <span className="block mb-2" style={{ ...microLabel, color: C.faint }}>PROFILE — PERSON-LEVEL, NOT TIED TO ONE DESK</span>
        <div className="space-y-3">
          <div>
            <span className="block mb-1.5" style={{ ...microLabel, color: C.faint }}>CHRONOTYPE</span>
            <div className="flex gap-1.5">
              {(["lark", "owl"] as const).map((c) => {
                const on = profileDraft.chronotype === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => pickChronotype(c)}
                    aria-pressed={on}
                    className="gx-focus border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider"
                    style={{
                      fontFamily: FONT.mono,
                      borderColor: on ? C.amber : C.lineBright,
                      color: on ? C.amber : C.faint,
                      background: on ? "rgba(232,163,61,0.1)" : "transparent",
                    }}
                  >
                    {c === "lark" ? "LARK" : "OWL"}
                  </button>
                );
              })}
            </div>
          </div>
          <Slider
            label="TEST ANXIETY"
            hint="1 (calm) - 5 (high anxiety)"
            value={profileDraft.testAnxiety ?? DEFAULT_ANXIETY}
            min={1} max={5} step={1}
            format={(v) => String(v)}
            onDraft={setAnxiety}
            onCommit={commitProfile}
          />
        </div>
      </div>
    </div>
  );
}
