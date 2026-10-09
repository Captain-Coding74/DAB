// Master schedule for the 30 s loop "NIGHT AUDIT: Line by Line". Every window, in seconds of loop time, lives here,
// and intake / sculpture / stamp+rail / scene all read it, so a call on one page and its answer on the other
// cannot drift apart when one side is retuned. All t-scheduled windows lie inside [0.25, 29.90]; the seam
// ([29.90, 30) ∪ [0, 0.25)) holds only periodic motion.
//
//   01 PARSE  0.00 –  8.60   rows stream in, the line reads the banner, it is SKIPPED; the cloud settles into the grid, header found
//   02 CLEAN  8.60 – 19.60   date B.E.→C.E., price ฿/comma stripped, negative folded; matching flagged cells flip to fixed
//   03 CHART 19.60 – 23.80   hand-off glint down the clean column, grid topples into bars, months, hold
//   04 GRADE 23.80 – 28.00   bars curl into the double ring, B+ stamps, column margin rules turn green, all four steps checked
//   reset    28.00 – 29.90   B+ splits, ring peels back to the cloud, rows file away, line returns home, rail rewinds
const f = Object.freeze;

export const SCH = f({
  /* ── left page: one record per raw row (GL-local slot, messy offset and tilt, absolute times) ── */
  cards: f({
    banner: f({ slot: [0, +0.93], dx: -0.06, rho: -2.0, in: 0.25, type: [0.30, 1.10], lift: [2.20, 2.70],
      strike: [3.40, 0.45], tag: 3.85, collapse: [4.65, 5.30], textFade: [4.65, 5.05], ruleFade: [4.65, 5.15],
      settle: [4.75, 5.30], exit: 28.15 }),
    date: f({ slot: [0, +0.31], dx: +0.05, rho: +1.5, in: 1.05, type: [1.15, 1.55], lift: [8.45, 8.95],
      asm: [8.95, 0.55, 0.55], textOut: [9.55, 9.90], plate: [9.80, 10.25], rule: [9.90, 10.25], reels: 10.10,
      tag: 11.15, sweep: [11.10, 0.70, 2.4], settle: [12.10, 12.60], green: 26.20, exit: 28.30 }),
    price: f({ slot: [0, -0.31], dx: -0.03, rho: -1.5, in: 1.50, type: [1.60, 1.95], lift: [12.25, 12.75],
      asm: [12.75, 0.55, 0.55], textOut: [13.35, 13.70], plate: [13.60, 14.05], rule: [13.70, 14.05],
      baht: 13.90, comma: 13.95, zip: 14.10, tag: 14.60, sweep: [14.55, 0.70, 1.8], settle: [15.55, 16.05], green: 26.35, exit: 28.45 }),
    neg: f({ slot: [0, -0.93], dx: -0.06, rho: +2.0, in: 1.90, type: [2.00, 2.20], lift: [15.70, 16.20],
      asm: [16.20, 0.30, 0.55], textOut: [16.80, 17.15], plate: [17.05, 17.50], rule: [17.15, 17.50],
      fold: 17.15, tag: 17.80, sweep: [17.75, 0.60, 2.0], settle: [18.55, 19.05], align: [18.55, 19.05, -0.342], green: 26.50, exit: 28.60 }),
  }),
  exitDur: 0.50,

  /* ── scan line: a reading head. herm keys [t, y, v] in GL-local y; then a carriage return home ── */
  scan: f({
    home: 1.22,
    keys: f([[2.30, 1.22, 0], [3.00, 1.01, -0.27], [3.74, 0.81, -0.27], [4.30, 0.48, 0],
             [8.60, 0.48, 0], [9.00, 0.39, -0.27], [9.74, 0.19, -0.27], [10.30, -0.14, 0],
             [12.40, -0.14, 0], [12.80, -0.23, -0.27], [13.54, -0.43, -0.27], [14.10, -0.76, 0],
             [15.85, -0.76, 0], [16.25, -0.85, -0.27], [16.99, -1.05, -0.27], [17.55, -1.38, 0]]),
    reads: f([[3.00, 3.74], [9.00, 9.74], [12.80, 13.54], [16.25, 16.99]]),   // constant-speed crossings of each text band
    returnHome: f([28.65, 1.10]),                                             // carriage return −1.38 → home, S-eased
    redMix: f([0.7, 2.85, 3.05, 4.65, 5.00]),                                 // banner reject: mix up 2.85-3.05, back 4.65-5.00
    dim: f([18.55, 19.05, 0.65]),                                             // audit done: base glow ×(1 − 0.65), restored by the return
  }),

  /* ── right page ── */
  grid: 5.15,                                                    // CLOUD → GRID starts (nearest cells first)
  header: f([7.00, 7.45, 7.35, 7.65, 19.85, 20.25]),             // strip in, HEADER ✓ in, both out
  glow: f([[11.30, "Date"], [14.75, "Sales"], [17.95, "Sales"]]), // header word echoes a left-page fix
  flags: f([11.35, 11.44, 11.53, 14.80, 14.89, 14.98, 18.00, 18.09, 18.18]),  // flip starts, 3 per fix
  bars: 20.15,
  baseline: f([21.50, 22.00, 23.65, 24.00]),
  months: f([21.70, 23.65, 23.95]),
  breathe: f([22.35, 1.2]),
  ring: f([23.85, 25.05, 25.65]),                                // curl starts, amber → green, done
  flash: f([25.92, 26.50]),                                      // ring flash + shock ring
  stamp: f([25.65, 25.95, 26.70, 28.00, 28.70]),                 // in, flash peak, flash decayed, split start, split end
  glight: f([25.75, 25.95, 26.70, 27.70]),
  s2: f([26.05, 0.80]),
  peel: f([28.10, 28.95, 29.65]),                                // ring → cloud; flags red again
  hair: f([20.50, 21.50, 28.45, 29.25]),                         // gutter hairlines in / out

  /* ── step rail (01 PARSE · 02 CLEAN · 03 CHART · 04 GRADE) ── */
  steps: f({
    tE: f([8.00, 19.05, 23.20, 26.85]),                          // each number rolls to a check; GRADE early enough that
                                                                 // 'B+ and all four checked' holds ~0.75 s before the reset
    fills: f([f([3.90, 7.45]), f([11.25, 14.70, 17.90]), f([22.30]), f([25.95])]),  // segment fills land on real events
    rewind: 29.15,
  }),

  /* ── left column after CLEAN ── */
  column: f({ handoff: f([19.60, 0.70, 2.0]), dim: f([19.60, 20.10]), echo: f([26.20, 26.35, 26.50]) }),   // = cards.*.green
});
