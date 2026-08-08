/**
 * Constants of the evaluation harness. Separate from `quant/params.ts` on
 * purpose: nothing here touches a forecast. These are properties of the
 * INSTRUMENT — how many bootstrap replicates, at what confidence, with what
 * seed — and a change to one of them changes what the gate can see, never what
 * the engine says.
 */

/**
 * Bootstrap replicates. 2000 puts the Monte-Carlo error on a 5th/95th
 * percentile well below the sampling error the bootstrap is measuring (which,
 * on ten clusters, is large). More replicates would sharpen a number whose
 * real uncertainty is dominated elsewhere.
 */
export const BOOTSTRAP_B = 2000;

/**
 * The bootstrap's seed. Fixed and committed so a verdict is reproducible: two
 * people running the gate on the same two models must reach the same verdict,
 * or "the gate said no" is not an argument. Chosen arbitrarily (the date this
 * harness was written) and never tuned — a seed swept for a favourable answer
 * would be the worst kind of p-hacking, and pinning it in a committed constant
 * makes such a sweep visible in the diff.
 */
export const BOOTSTRAP_SEED = 20260731;

/** Two-sided confidence level for the verdict interval: a 90% CI. */
export const COMPARE_ALPHA = 0.1;

/**
 * z_{0.95} + z_{0.80} = 1.6449 + 0.8416. The multiplier on a standard error
 * that gives the effect size a one-sided 5% test detects with 80% power — the
 * textbook minimum-detectable-effect constant.
 */
export const MDE_Z = 2.4865;

/**
 * The paired difference of two models' fold scores is at worst as variable as
 * two independent draws of one model's fold scores, which is where the √2
 * comes from. In practice paired differences are far LESS variable, because
 * both models see the same tape — so the reported MDE is an upper bound on the
 * smallest detectable effect, not an estimate of it, and it is labelled as such
 * wherever it is printed.
 */
export const MDE_PAIRING_FACTOR = Math.SQRT2;
