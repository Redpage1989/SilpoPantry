#!/usr/bin/env python3
"""
Зібрати відеопітч: слайди вступу + демо з озвучкою + слайди фіналу.

Тривалість кожного слайда задає озвучка, а не константа в коді: скрипт
ріже доріжку на абзаци тим самим методом, що й sync-voiceover.py —
передбачає межу за часткою символів і підтягує до найближчої справжньої
паузи. Так слайд змінюється рівно тоді, коли диктор переходить до
наступної думки.

    python3 scripts/assemble-pitch.py <вступ.mp3> <фінал.mp3>
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

DEMO = Path("tutorial-out/presentation-voiced.mp4")
SLIDES = Path("tutorial-out/slides")
OUT = Path("tutorial-out/pitch-final.mp4")
INTRO = ["in1", "in2", "in3"]
OUTRO = ["out1", "out2", "out3", "out4", "out5"]
PAD = 0.6  # пауза після останнього слова, щоб слайд не зникав різко


def dur(p: Path) -> float:
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)], capture_output=True, text=True).stdout.strip())


def split_by_text(audio: Path, paragraphs: list[str]) -> list[float]:
    """Довжина кожного абзацу в доріжці, у секундах."""
    total = dur(audio)
    log = subprocess.run(
        ["ffmpeg", "-v", "info", "-i", str(audio),
         "-af", "silencedetect=noise=-45dB:d=0.15", "-f", "null", "-"],
        capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    gaps = sorted((a, b) for a, b in zip(starts, ends) if b > a)

    lens = [len(x) for x in paragraphs]
    cum, acc = [], 0
    for n in lens[:-1]:
        acc += n
        cum.append(acc / sum(lens) * total)

    cuts, prev = [], 0.0
    for want in cum:
        cand = [g for g in gaps if g[0] > prev + 0.4]
        if not cand:
            raise SystemExit(f"забракло пауз у {audio.name} близько {want:.1f} с")
        best = min(cand, key=lambda g: abs((g[0] + g[1]) / 2 - want))
        mid = (best[0] + best[1]) / 2
        cuts.append(mid)
        prev = mid
    bounds = [0.0] + cuts + [total]
    return [bounds[i + 1] - bounds[i] for i in range(len(paragraphs))]


def seg(name: str, sec: float, audio: Path, start: float, out: Path):
    """Слайд + відповідний шматок озвучки."""
    fo = max(0.0, sec - 0.45)
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-loop", "1", "-t", f"{sec:.3f}", "-i", str(SLIDES / f"{name}.png"),
        "-ss", f"{start:.3f}", "-t", f"{sec:.3f}", "-i", str(audio),
        "-vf", f"scale=780:1688,fps=25,format=yuv420p,"
               f"fade=t=in:st=0:d=0.4,fade=t=out:st={fo:.2f}:d=0.45",
        "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,apad",
        "-c:a", "aac", "-b:a", "112k", "-ar", "48000", "-ac", "1",
        "-t", f"{sec:.3f}", "-video_track_timescale", "12800", str(out)], check=True)


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    a_in, a_out = Path(sys.argv[1]), Path(sys.argv[2])
    for f in (a_in, a_out, DEMO):
        if not f.exists():
            print(f"Немає файлу: {f}")
            return 1

    p_in = [x.strip() for x in Path("docs/vo-1-vstup.txt").read_text(encoding="utf-8").split("\n\n") if x.strip()]
    p_out = [x.strip() for x in Path("docs/vo-2-final.txt").read_text(encoding="utf-8").split("\n\n") if x.strip()]
    if len(p_in) != len(INTRO) or len(p_out) != len(OUTRO):
        print(f"Абзаців {len(p_in)}+{len(p_out)}, слайдів {len(INTRO)}+{len(OUTRO)} — мусять збігатися.")
        return 2

    print(f"вступ: {dur(a_in):.1f} с · фінал: {dur(a_out):.1f} с · демо: {dur(DEMO):.1f} с\n")
    d_in = split_by_text(a_in, p_in)
    d_out = split_by_text(a_out, p_out)

    with tempfile.TemporaryDirectory() as td:
        tmp, parts, pos = Path(td), [], 0.0
        for i, (n, d) in enumerate(zip(INTRO, d_in)):
            sec = d + (PAD if i == len(INTRO) - 1 else 0)
            p = tmp / f"{n}.mp4"
            seg(n, sec, a_in, pos, p)
            parts.append(p); pos += d
            print(f"  {n}  {sec:5.1f} с  {p_in[i][:44]}…")

        mid = tmp / "demo.mp4"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(DEMO),
                        "-c:v", "libx264", "-crf", "20", "-preset", "medium",
                        "-pix_fmt", "yuv420p", "-r", "25",
                        "-c:a", "aac", "-b:a", "112k", "-ar", "48000", "-ac", "1",
                        "-video_track_timescale", "12800", str(mid)], check=True)
        parts.append(mid)
        print(f"  demo {dur(DEMO):5.1f} с")

        pos = 0.0
        for i, (n, d) in enumerate(zip(OUTRO, d_out)):
            sec = d + (PAD if i == len(OUTRO) - 1 else 0)
            p = tmp / f"{n}.mp4"
            seg(n, sec, a_out, pos, p)
            parts.append(p); pos += d
            print(f"  {n} {sec:5.1f} с  {p_out[i][:44]}…")

        lst = tmp / "l.txt"
        lst.write_text("".join(f"file '{p}'\n" for p in parts), encoding="utf-8")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                        "-i", str(lst), "-c", "copy", "-movflags", "+faststart",
                        str(OUT)], check=True)

    t = dur(OUT)
    print(f"\n✅ {OUT} · {t//60:.0f}:{t%60:04.1f} · {OUT.stat().st_size/1048576:.1f} МБ")
    if not (180 <= t <= 300):
        print(f"⚠ Поза вимогою 3–5 хв ({t:.0f} с)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
