/**
 * The bibliography.
 *
 * Every method in this engine is somebody's paper. A derivation that shows the
 * formula but not where it came from is a magic trick; naming the source is
 * what makes it checkable. Entries are the primary sources — the paper that
 * introduced the method, not a textbook that repeats it.
 *
 * These are authored data, not computed: an entry that is wrong is wrong
 * forever and silently. Verify against the record before adding one.
 */

export interface Citation {
  /** "Page (1954)" — what the footnote prints. */
  short: string;
  authors: string;
  year: number;
  title: string;
  /** Journal, volume(issue), pages — or publisher for books. */
  venue: string;
}

export const CITATIONS = {
  page1954: {
    short: "Page (1954)",
    authors: "Page, E. S.",
    year: 1954,
    title: "Continuous Inspection Schemes",
    venue: "Biometrika 41(1/2), 100–115",
  },
  theil1950: {
    short: "Theil (1950)",
    authors: "Theil, H.",
    year: 1950,
    title: "A Rank-Invariant Method of Linear and Polynomial Regression Analysis",
    venue: "Proc. Koninklijke Nederlandse Akademie van Wetenschappen 53, 386–392",
  },
  sen1968: {
    short: "Sen (1968)",
    authors: "Sen, P. K.",
    year: 1968,
    title: "Estimates of the Regression Coefficient Based on Kendall's Tau",
    venue: "J. American Statistical Association 63(324), 1379–1389",
  },
  kendall1938: {
    short: "Kendall (1938)",
    authors: "Kendall, M. G.",
    year: 1938,
    title: "A New Measure of Rank Correlation",
    venue: "Biometrika 30(1/2), 81–93",
  },
  jamesstein1961: {
    short: "James & Stein (1961)",
    authors: "James, W., & Stein, C.",
    year: 1961,
    title: "Estimation with Quadratic Loss",
    venue: "Proc. 4th Berkeley Symposium on Math. Statistics and Probability 1, 361–379",
  },
  efron1975: {
    short: "Efron & Morris (1975)",
    authors: "Efron, B., & Morris, C.",
    year: 1975,
    title: "Data Analysis Using Stein's Estimator and Its Generalizations",
    venue: "J. American Statistical Association 70(350), 311–319",
  },
  buhlmann1967: {
    short: "Bühlmann (1967)",
    authors: "Bühlmann, H.",
    year: 1967,
    title: "Experience Rating and Credibility",
    venue: "ASTIN Bulletin 4(3), 199–207",
  },
  kalman1960: {
    short: "Kalman (1960)",
    authors: "Kalman, R. E.",
    year: 1960,
    title: "A New Approach to Linear Filtering and Prediction Problems",
    venue: "J. Basic Engineering 82(1), 35–45",
  },
  kish1965: {
    short: "Kish (1965)",
    authors: "Kish, L.",
    year: 1965,
    title: "Survey Sampling",
    venue: "Wiley, New York — §8.2, design effect and effective sample size",
  },
  tversky1992: {
    short: "Tversky & Kahneman (1992)",
    authors: "Tversky, A., & Kahneman, D.",
    year: 1992,
    title: "Advances in Prospect Theory: Cumulative Representation of Uncertainty",
    venue: "J. Risk and Uncertainty 5(4), 297–323",
  },
  hazen1914: {
    short: "Hazen (1914)",
    authors: "Hazen, A.",
    year: 1914,
    title: "Storage to be Provided in Impounding Municipal Water Supply Reservoirs",
    venue: "Transactions of the ASCE 77, 1539–1640",
  },
  bates1969: {
    short: "Bates & Granger (1969)",
    authors: "Bates, J. M., & Granger, C. W. J.",
    year: 1969,
    title: "The Combination of Forecasts",
    venue: "Operational Research Quarterly 20(4), 451–468",
  },
  wolpert1992: {
    short: "Wolpert (1992)",
    authors: "Wolpert, D. H.",
    year: 1992,
    title: "Stacked Generalization",
    venue: "Neural Networks 5(2), 241–259",
  },
  engle1987: {
    short: "Engle & Granger (1987)",
    authors: "Engle, R. F., & Granger, C. W. J.",
    year: 1987,
    title: "Co-integration and Error Correction: Representation, Estimation, and Testing",
    venue: "Econometrica 55(2), 251–276",
  },
  raiffa1961: {
    short: "Raiffa & Schlaifer (1961)",
    authors: "Raiffa, H., & Schlaifer, R.",
    year: 1961,
    title: "Applied Statistical Decision Theory",
    venue: "Harvard Business School, Boston — conjugate Normal-Inverse-Gamma analysis",
  },
  student1908: {
    short: "Student (1908)",
    authors: "Student [Gosset, W. S.]",
    year: 1908,
    title: "The Probable Error of a Mean",
    venue: "Biometrika 6(1), 1–25",
  },
  lentz1976: {
    short: "Lentz (1976)",
    authors: "Lentz, W. J.",
    year: 1976,
    title: "Generating Bessel Functions in Mie Scattering Calculations Using Continued Fractions",
    venue: "Applied Optics 15(3), 668–671",
  },
  abramowitz1964: {
    short: "Abramowitz & Stegun (1964)",
    authors: "Abramowitz, M., & Stegun, I. A.",
    year: 1964,
    title: "Handbook of Mathematical Functions",
    venue: "NBS Applied Mathematics Series 55 — §26.5, incomplete beta",
  },
  vonneumann1941: {
    short: "von Neumann (1941)",
    authors: "von Neumann, J.",
    year: 1941,
    title: "Distribution of the Ratio of the Mean Square Successive Difference to the Variance",
    venue: "Annals of Mathematical Statistics 12(4), 367–395",
  },
  markowitz1959: {
    short: "Markowitz (1959)",
    authors: "Markowitz, H. M.",
    year: 1959,
    title: "Portfolio Selection: Efficient Diversification of Investments",
    venue: "Wiley, New York — Ch. 9, semivariance",
  },
  sortino1994: {
    short: "Sortino & Price (1994)",
    authors: "Sortino, F. A., & Price, L. N.",
    year: 1994,
    title: "Performance Measurement in a Downside Risk Framework",
    venue: "J. Investing 3(3), 59–64",
  },
  hoerl1970: {
    short: "Hoerl & Kennard (1970)",
    authors: "Hoerl, A. E., & Kennard, R. W.",
    year: 1970,
    title: "Ridge Regression: Biased Estimation for Nonorthogonal Problems",
    venue: "Technometrics 12(1), 55–67",
  },
  brown1956: {
    short: "Brown (1956)",
    authors: "Brown, R. G.",
    year: 1956,
    title: "Exponential Smoothing for Predicting Demand",
    venue: "Arthur D. Little, Cambridge MA",
  },
  huber1964: {
    short: "Huber (1964)",
    authors: "Huber, P. J.",
    year: 1964,
    title: "Robust Estimation of a Location Parameter",
    venue: "Annals of Mathematical Statistics 35(1), 73–101",
  },
  rousseeuw1993: {
    short: "Rousseeuw & Croux (1993)",
    authors: "Rousseeuw, P. J., & Croux, C.",
    year: 1993,
    title: "Alternatives to the Median Absolute Deviation",
    venue: "J. American Statistical Association 88(424), 1273–1283",
  },

  /* ── Forecast evaluation: the scoreboard (§26, D5) ─────────────── */
  matheson1976: {
    short: "Matheson & Winkler (1976)",
    authors: "Matheson, J. E., & Winkler, R. L.",
    year: 1976,
    title: "Scoring Rules for Continuous Probability Distributions",
    venue: "Management Science 22(10), 1087–1096",
  },
  gneiting2007: {
    short: "Gneiting & Raftery (2007)",
    authors: "Gneiting, T., & Raftery, A. E.",
    year: 2007,
    title: "Strictly Proper Scoring Rules, Prediction, and Estimation",
    venue: "J. American Statistical Association 102(477), 359–378",
  },
  gneitingCalib2007: {
    short: "Gneiting, Balabdaoui & Raftery (2007)",
    authors: "Gneiting, T., Balabdaoui, F., & Raftery, A. E.",
    year: 2007,
    title: "Probabilistic Forecasts, Calibration and Sharpness",
    venue: "J. Royal Statistical Society B 69(2), 243–268",
  },
  gneiting2011: {
    short: "Gneiting (2011)",
    authors: "Gneiting, T.",
    year: 2011,
    title: "Making and Evaluating Point Forecasts",
    venue: "J. American Statistical Association 106(494), 746–762",
  },
  jordan2019: {
    short: "Jordan, Krüger & Lerch (2019)",
    authors: "Jordan, A., Krüger, F., & Lerch, S.",
    year: 2019,
    title: "Evaluating Probabilistic Forecasts with scoringRules",
    venue: "J. Statistical Software 90(12), 1–37 — closed-form CRPS of the Student-t",
  },
  brier1950: {
    short: "Brier (1950)",
    authors: "Brier, G. W.",
    year: 1950,
    title: "Verification of Forecasts Expressed in Terms of Probability",
    venue: "Monthly Weather Review 78(1), 1–3",
  },
  murphy1973: {
    short: "Murphy (1973)",
    authors: "Murphy, A. H.",
    year: 1973,
    title: "A New Vector Partition of the Probability Score",
    venue: "J. Applied Meteorology 12(4), 595–600",
  },
  dawid1984: {
    short: "Dawid (1984)",
    authors: "Dawid, A. P.",
    year: 1984,
    title: "Statistical Theory: The Prequential Approach",
    venue: "J. Royal Statistical Society A 147(2), 278–292",
  },
  tashman2000: {
    short: "Tashman (2000)",
    authors: "Tashman, L. J.",
    year: 2000,
    title: "Out-of-Sample Tests of Forecasting Accuracy: An Analysis and Review",
    venue: "International J. Forecasting 16(4), 437–450",
  },
  hyndman2006: {
    short: "Hyndman & Koehler (2006)",
    authors: "Hyndman, R. J., & Koehler, A. B.",
    year: 2006,
    title: "Another Look at Measures of Forecast Accuracy",
    venue: "International J. Forecasting 22(4), 679–688",
  },
  stone1974: {
    short: "Stone (1974)",
    authors: "Stone, M.",
    year: 1974,
    title: "Cross-Validatory Choice and Assessment of Statistical Predictions",
    venue: "J. Royal Statistical Society B 36(2), 111–147",
  },

  /* ── Elicitation, pooling and paired comparison (§15c, §27, §28) ── */
  savage1971: {
    short: "Savage (1971)",
    authors: "Savage, L. J.",
    year: 1971,
    title: "Elicitation of Personal Probabilities and Expectations",
    venue: "J. American Statistical Association 66(336), 783–801",
  },
  lichtenstein1982: {
    short: "Lichtenstein, Fischhoff & Phillips (1982)",
    authors: "Lichtenstein, S., Fischhoff, B., & Phillips, L. D.",
    year: 1982,
    title: "Calibration of Probabilities: The State of the Art to 1980",
    venue: "In Kahneman, Slovic & Tversky (eds.), Judgment Under Uncertainty, Cambridge University Press, 306–334",
  },
  stone1961: {
    short: "Stone (1961)",
    authors: "Stone, M.",
    year: 1961,
    title: "The Opinion Pool",
    venue: "Annals of Mathematical Statistics 32(4), 1339–1342",
  },
  genest1986: {
    short: "Genest & Zidek (1986)",
    authors: "Genest, C., & Zidek, J. V.",
    year: 1986,
    title: "Combining Probability Distributions: A Critique and an Annotated Bibliography",
    venue: "Statistical Science 1(1), 114–148",
  },
  thurstone1927: {
    short: "Thurstone (1927)",
    authors: "Thurstone, L. L.",
    year: 1927,
    title: "A Law of Comparative Judgment",
    venue: "Psychological Review 34(4), 273–286",
  },
  bradley1952: {
    short: "Bradley & Terry (1952)",
    authors: "Bradley, R. A., & Terry, M. E.",
    year: 1952,
    title: "Rank Analysis of Incomplete Block Designs: I. The Method of Paired Comparisons",
    venue: "Biometrika 39(3/4), 324–345",
  },
  elo1978: {
    short: "Elo (1978)",
    authors: "Elo, A. E.",
    year: 1978,
    title: "The Rating of Chessplayers, Past and Present",
    venue: "Arco, New York — §8, the rating equation",
  },
  spearman1904: {
    short: "Spearman (1904)",
    authors: "Spearman, C.",
    year: 1904,
    title: "The Proof and Measurement of Association Between Two Things",
    venue: "American J. Psychology 15(1), 72–101",
  },

  /* ── Estimation and planning behind the boards ─────────────────── */
  legendre1805: {
    short: "Legendre (1805)",
    authors: "Legendre, A. M.",
    year: 1805,
    title: "Nouvelles méthodes pour la détermination des orbites des comètes",
    venue: "Courcier, Paris — appendix, la méthode des moindres carrés",
  },
  slutzky1937: {
    short: "Slutzky (1937)",
    authors: "Slutzky, E.",
    year: 1937,
    title: "The Summation of Random Causes as the Source of Cyclic Processes",
    venue: "Econometrica 5(2), 105–146",
  },
  dixon1960: {
    short: "Dixon (1960)",
    authors: "Dixon, W. J.",
    year: 1960,
    title: "Simplified Estimation from Censored Normal Samples",
    venue: "Annals of Mathematical Statistics 31(2), 385–391 — the winsorized mean",
  },
  boyd2004: {
    short: "Boyd & Vandenberghe (2004)",
    authors: "Boyd, S., & Vandenberghe, L.",
    year: 2004,
    title: "Convex Optimization",
    venue: "Cambridge University Press — §5.5.3, water-filling",
  },
} as const satisfies Record<string, Citation>;

export type CiteKey = keyof typeof CITATIONS;

/** "Page (1954)" — the inline footnote form. */
export const citeShort = (k: CiteKey): string => CITATIONS[k].short;

/** Full reference, one line, as a bibliography entry prints. */
export const citeFull = (k: CiteKey): string => {
  const c = CITATIONS[k];
  return `${c.authors} (${c.year}). ${c.title}. ${c.venue}.`;
};
