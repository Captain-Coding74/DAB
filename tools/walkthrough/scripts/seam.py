"""Loop-seam check: the jump N-1 -> 0 should look like an ordinary consecutive-frame step.
usage: seam.py FRAMES_DIR [N = number of fNNNN.png files]   (needs numpy + Pillow)
A copy of tools/hero-bg/scripts/seam.py, so this kit does not depend on the hero kit."""
import sys, numpy as np
from PIL import Image
import glob
d = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else len(glob.glob(f"{d}/f[0-9][0-9][0-9][0-9].png"))
def L(i): return np.asarray(Image.open(f"{d}/f{i:04d}.png").convert("RGB").resize((480, 270)), dtype=np.float32)
pairs = [(i, i + 1) for i in range(0, N - 1, max(1, (N - 1) // 40))]
diffs = [float(np.abs(L(a) - L(b)).mean()) for a, b in pairs]
seam = float(np.abs(L(N - 1) - L(0)).mean())
# second-order: the motion at the seam should continue, compare (0-(N-1)) with (1-0)
acc = float(np.abs((L(0) - L(N - 1)) - (L(1) - L(0))).mean())
accs = [float(np.abs((L(a + 1) - L(a)) - (L(a + 2) - L(a + 1))).mean()) for a, _ in pairs[:-1]]
print(f"consecutive diff: median {np.median(diffs):.3f}  p95 {np.percentile(diffs,95):.3f}  max {max(diffs):.3f}")
print(f"seam {N-1}->0 diff: {seam:.3f}   ratio to median {seam/np.median(diffs):.2f}")
print(f"seam accel: {acc:.3f}   typical accel median {np.median(accs):.3f} p95 {np.percentile(accs,95):.3f}")
print("SEAM OK" if seam <= np.percentile(diffs, 95) * 1.15 and acc <= np.percentile(accs, 95) * 1.25 else "SEAM SUSPECT")
