"""Render local scientific projections; does not open or automate a browser."""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from common.skeleton import all_edges


def main():
    root = Path("C:/aihub/audit_word/spike_review")
    pairs = json.loads((root / "manifest.json").read_text(encoding="utf-8"))["pairs"]
    edges = all_edges()
    results = []
    for page in range(3):
        fig, axes = plt.subplots(3, 4, figsize=(16, 12), constrained_layout=True)
        for row, pair in enumerate(pairs[page * 3:page * 3 + 3]):
            c = pair["candidate"]
            clip = c["clip"]
            x = np.load(Path("C:/aihub/full/npy") / f"{clip}.npy").reshape(-1, 125, 3)
            t = int(c["step_destination_frame"])
            frames = [max(t-2, 0), max(t-1, 0), t, min(t+1, len(x)-1)]
            # Share robust framing to keep the ordinary skeleton readable.
            center = np.median(x, axis=(0, 1))
            for col, frame in enumerate(frames):
                ax = axes[row, col]
                for a, b in edges:
                    color = "#277a5e" if 13 <= a < 34 else "#c75636" if 34 <= a < 55 else "#999999" if a >= 55 else "#242424"
                    ax.plot(x[frame, [a,b], 0], x[frame, [a,b], 1], color=color, linewidth=.7)
                ax.set_xlim(center[0]-3, center[0]+3)
                ax.set_ylim(center[1]+3, center[1]-3)
                ax.set_aspect("equal")
                ax.set_title(f"{clip}\nframe {frame} / step joint {c['step_joint']}", fontsize=9)
                ax.grid(alpha=.2)
                off = int((np.max(np.abs(x[frame,:,:2]-center[:2]),axis=1)>3).sum())
                ax.text(.02,.02,f"outside fixed view: {off} joints",transform=ax.transAxes,fontsize=8)
            results.append({"clip":clip,"frames":frames,"projection":"front x/y", "note":"Points outside fixed view are counted; clipping is intentional, not missing data."})
        path = root / f"static_review_{page+1}.png"
        fig.savefig(path, dpi=130)
        plt.close(fig)
        print(path)
    (root / "static_review.json").write_text(json.dumps(results,indent=2),encoding="utf-8")


if __name__ == "__main__":
    main()
