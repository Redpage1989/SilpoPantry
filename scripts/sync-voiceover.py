#!/usr/bin/env python3
"""
Розкласти суцільну доріжку ElevenLabs по сценах відео.

Проблема, яку це вирішує: TTS читає текст поспіль, а у відео 20 сцен
різної довжини. Теґи <break> у ElevenLabs могли б тримати паузи, але вони
тарифікуються як звичайні символи — 504 зайвих кредити на 24 теґи. Дешевше
згенерувати чисту мову й розставити паузи тут, до того ж точніше: ffmpeg
кладе репліку рівно на потрібну секунду, а не «десь близько».

Як працює: знаходить тишу між абзацами, ріже доріжку на репліки й збирає
нову — кожна репліка починається рівно на таймкоді своєї сцени.

    python3 scripts/sync-voiceover.py <аудіо.mp3> [вихід.mp4]
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# Таймкоди сцен із docs/VOICEOVER_SCRIPT.md, у секундах.
SCENES = [
    (1, "титр"), (8, "вхід"), (21, "головна"), (29, "шпинат"),
    (40, "сканування"), (48, "підтвердження"), (65, "комора"),
    (85, "підбір страв"), (93, "скоринг"), (101, "рецепт"),
    (114, "списання"), (123, "хочу тірамісу"), (131, "звірив комору"),
    (139, "три рівні"), (148, "готувати чи купити"), (157, "підтвердження кошика"),
    (170, "кошик"), (186, "спільнота"), (199, "trace"), (213, "фінал"),
]
VIDEO = Path("tutorial-out/presentation.mp4")


def run(args: list[str]) -> str:
    return subprocess.run(args, capture_output=True, text=True).stderr


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    ).stdout.strip()
    return float(out)


def align_by_text(audio: Path, total: float, paragraphs: list[str]):
    """
    Межі реплік за текстом, підтягнуті до реальних пауз.

    Пошук самою лише тишею тут не працює: ElevenLabs не робить паузи між
    абзацами довшими за паузи між реченнями — заміряний розподіл суцільний,
    від 0,15 до 0,59 с без розриву. Тому межі спершу передбачаються за
    часткою символів абзацу (темп мовлення рівний), а потім кожна
    підтягується до найближчої справжньої паузи. Дрейф темпу так
    самовиправляється на кожній межі.
    """
    log = run(["ffmpeg", "-v", "info", "-i", str(audio),
               "-af", "silencedetect=noise=-45dB:d=0.15", "-f", "null", "-"])
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    gaps = sorted((a, b) for a, b in zip(starts, ends) if b > a)
    if not gaps:
        return None, "у доріжці немає пауз — нічим різати"

    lens = [len(x) for x in paragraphs]
    cum, acc = [], 0
    for n in lens[:-1]:
        acc += n
        cum.append(acc / sum(lens) * total)

    chosen, prev, drifts = [], 0.0, []
    for want in cum:
        cand = [g for g in gaps if g[0] > prev + 0.4]
        if not cand:
            return None, f"забракло пауз близько {want:.1f} с"
        best = min(cand, key=lambda g: abs((g[0] + g[1]) / 2 - want))
        mid = (best[0] + best[1]) / 2
        drifts.append(abs(mid - want))
        chosen.append(mid)
        prev = mid

    bounds, start = [], 0.0
    for c in chosen:
        bounds.append((start, c))
        start = c
    bounds.append((start, total))
    return bounds, max(drifts)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    audio = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("tutorial-out/presentation-voiced.mp4")
    if not audio.exists():
        print(f"Немає файлу: {audio}")
        return 1
    if not VIDEO.exists():
        print(f"Немає {VIDEO} — спершу npx tsx scripts/record-presentation.ts")
        return 1

    vdur, adur = duration(VIDEO), duration(audio)
    print(f"відео: {vdur:.1f} с · доріжка: {adur:.1f} с")

    text = Path("docs/elevenlabs-text.txt").read_text(encoding="utf-8")
    paragraphs = [x.strip() for x in text.split("\n\n") if x.strip()]
    if len(paragraphs) != len(SCENES):
        print(f"У тексті {len(paragraphs)} абзаців, а сцен {len(SCENES)} — вони мусять збігатися.")
        return 2

    segs, info = align_by_text(audio, adur, paragraphs)
    if segs is None:
        print(f"Не вдалося розкласти: {info}")
        return 2
    print(f"межі за текстом · найбільший відхил від паузи: {info:.2f} с\n")

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        parts, pos, overruns = [], 0.0, []
        for i, ((start, end), (target, label)) in enumerate(zip(segs, SCENES)):
            gap = target - pos
            if gap < -0.2:
                overruns.append((label, -gap))
                gap = 0.05
            if gap > 0:
                sil = tmp / f"sil{i}.wav"
                subprocess.run(
                    ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
                     "-i", "anullsrc=r=44100:cl=mono", "-t", f"{gap:.3f}", str(sil)],
                    check=True)
                parts.append(sil)
                pos += gap
            seg = tmp / f"seg{i}.wav"
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-i", str(audio),
                 "-ss", f"{start:.3f}", "-to", f"{end:.3f}",
                 "-ac", "1", "-ar", "44100", str(seg)], check=True)
            parts.append(seg)
            pos += end - start
            print(f"  {target // 60:.0f}:{target % 60:02.0f}  {label:<22} {end - start:5.1f} с")

        if overruns:
            print("\n⚠ Довші за свою сцену — наступна репліка зсунулась:")
            for label, by in overruns:
                print(f"    «{label}» на {by:.1f} с")
            print("  Виправляється скороченням саме цієї репліки в тексті.")

        lst = tmp / "list.txt"
        lst.write_text("".join(f"file '{p}'\n" for p in parts), encoding="utf-8")
        track = tmp / "track.wav"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat",
                        "-safe", "0", "-i", str(lst), "-c", "copy", str(track)], check=True)

        tdur = duration(track)
        print(f"\nдоріжка після розкладки: {tdur:.1f} с (відео {vdur:.1f} с)")

        vf = []
        if tdur > vdur + 0.3:
            vf = ["-vf", f"tpad=stop_mode=clone:stop_duration={tdur - vdur:.2f}"]
            print(f"голос довший — тримаємо останній кадр {tdur - vdur:.1f} с")

        subprocess.run(
            ["ffmpeg", "-y", "-v", "warning", "-stats",
             "-i", str(VIDEO), "-i", str(track), *vf,
             "-filter:a", "loudnorm=I=-16:TP=-1.5:LRA=11,apad",
             "-map", "0:v:0", "-map", "1:a:0",
             "-c:v", "libx264", "-crf", "21", "-preset", "slow", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
             "-shortest", "-movflags", "+faststart", str(out)], check=True)

    print(f"\n✅ {out} · {out.stat().st_size / 1048576:.1f} МБ · {duration(out):.0f} с")
    return 0


if __name__ == "__main__":
    sys.exit(main())
