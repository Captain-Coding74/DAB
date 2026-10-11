"""Text-legibility check for an encode: SSIM of decoded frames vs the source PNGs on the text crops textcrops.mjs lists
(caption headline and sub, readout values, SERVER cell, the sample's meta line, finding row 1, stamp, sub-scores,
chart tick labels), at the hold frames 3.0 / 5.4 / 8.5 / 12.5 / 16.8 / 20.5 s and the midpoint of every camera move.
Luma: SSIM on Y (BT.601 weights, what ffmpeg uses for RGB -> yuv420p). Thresholds: holds >= 0.97, moves >= 0.92.
Chroma: yuv420p halves chroma resolution, so thin amber / red / green text (WARNING, the MISSING and DUPLICATES digits,
the green stamp) can never match the RGB source exactly, even losslessly. Each crop's per-RGB-channel SSIM (min over
R, G, B) must therefore stay within CHROMA_SLACK of a lossless yuv420p round-trip of the same source frame: the encode
may not bleed colour beyond what 4:2:0 itself costs. Move frames also score the whole view above the scrim (luma only).

usage: textcheck.py FRAMES_DIR VIDEO [VIDEO ...]      (needs numpy + Pillow, and FFMPEG or ffmpeg on PATH)
output per crop: "<name> <luma SSIM>/<chroma SSIM relative to lossless 4:2:0>"
"""
import json, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FF = os.environ.get("FFMPEG", "ffmpeg")
TH = {"hold": 0.97, "move": 0.92}
CHROMA_SLACK = 0.02


def gauss_kernel(sigma=1.5, r=5):
    x = np.arange(-r, r + 1, dtype=np.float64)
    k = np.exp(-x * x / (2 * sigma * sigma))
    return k / k.sum()


K = gauss_kernel()


def blur(a):
    p = len(K) // 2
    a = np.pad(a, p, mode="reflect")
    a = np.apply_along_axis(lambda r: np.convolve(r, K, mode="valid"), 1, a)
    return np.apply_along_axis(lambda c: np.convolve(c, K, mode="valid"), 0, a)


def ssim(x, y):
    x = x.astype(np.float64); y = y.astype(np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    mx, my = blur(x), blur(y)
    sxx, syy, sxy = blur(x * x) - mx * mx, blur(y * y) - my * my, blur(x * y) - mx * my
    m = ((2 * mx * my + c1) * (2 * sxy + c2)) / ((mx * mx + my * my + c1) * (sxx + syy + c2))
    return float(m.mean())


def luma(a):
    a = a.astype(np.float64)
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def rgbmin(a, b):
    return min(ssim(a[..., ch], b[..., ch]) for ch in range(3))


def roundtrip420(frames_dir, frames, tmp):
    out = {}
    for f in frames:
        p = os.path.join(tmp, f"rt{f:04d}.png")
        subprocess.run([FF, "-loglevel", "error", "-y", "-i", os.path.join(frames_dir, f"f{f:04d}.png"), "-vf", "format=yuv420p,format=rgb24", p], check=True)
        out[f] = np.asarray(Image.open(p).convert("RGB"))
    return out


def decode(video, frames, tmp):
    sel = "+".join(f"eq(n\\,{f})" for f in frames)
    pat = os.path.join(tmp, "d%03d.png")
    subprocess.run([FF, "-loglevel", "error", "-y", "-i", video, "-vf", f"select='{sel}'", "-vsync", "0", pat], check=True)
    return {f: os.path.join(tmp, f"d{i + 1:03d}.png") for i, f in enumerate(frames)}


def main():
    frames_dir, videos = sys.argv[1], sys.argv[2:]
    plan = json.loads(subprocess.run(["node", os.path.join(HERE, "textcrops.mjs")], check=True, capture_output=True, text=True, cwd=os.path.dirname(HERE)).stdout)
    frames = sorted({p["f"] for p in plan})
    ok_all = True
    with tempfile.TemporaryDirectory() as tmp0:
        floor420 = roundtrip420(frames_dir, frames, tmp0)
    for video in videos:
        with tempfile.TemporaryDirectory() as tmp:
            dec = decode(video, frames, tmp)
            worst = {"hold": 1.0, "move": 1.0}
            chroma_worst = 1.0
            fails = []
            print(f"{os.path.basename(video)}  ({os.path.getsize(video) / 1e6:.3f} MB)")
            for p in plan:
                src = np.asarray(Image.open(os.path.join(frames_dir, f"f{p['f']:04d}.png")).convert("RGB"))
                got = np.asarray(Image.open(dec[p["f"]]).convert("RGB"))
                rt = floor420[p["f"]]
                scores = []
                for c in p["crops"]:
                    x0, y0, x1, y1 = c["box"]
                    S_, G_, R_ = src[y0:y1, x0:x1], got[y0:y1, x0:x1], rt[y0:y1, x0:x1]
                    s = ssim(luma(S_), luma(G_))
                    ch = rgbmin(S_, R_) - rgbmin(S_, G_)          # chroma lost beyond lossless 4:2:0
                    scores.append((c["name"], s, ch))
                    worst[p["kind"]] = min(worst[p["kind"]], s)
                    if c["name"] != "viewAboveScrim":
                        chroma_worst = min(chroma_worst, -ch)
                    if s < TH[p["kind"]]:
                        fails.append(f"f{p['f']} {c['name']} luma {s:.4f}")
                    if ch > CHROMA_SLACK and c["name"] != "viewAboveScrim":   # colour bleed is judged on the text crops
                        fails.append(f"f{p['f']} {c['name']} chroma -{ch:.4f} beyond 4:2:0")
                label = f"  {p['kind']:4s} t={p['f'] / 30:6.3f} f{p['f']:04d} {p.get('move', ''):6s}"
                print(label + "  " + "  ".join(f"{n} {s:.3f}/{-ch:+.3f}" for n, s, ch in scores))
            ok = not fails
            ok_all &= ok
            print(f"  luma SSIM: worst hold {worst['hold']:.4f} (>= {TH['hold']}), worst move {worst['move']:.4f} (>= {TH['move']});"
                  f" chroma beyond 4:2:0: worst {chroma_worst:+.4f} (>= -{CHROMA_SLACK})  ->  {'TEXT OK' if ok else 'TEXT FAIL: ' + '; '.join(fails[:6])}")
    sys.exit(0 if ok_all else 1)


if __name__ == "__main__":
    main()
