#!/usr/bin/env python3
"""Змонтувати демо (версія без сцени «Спільнота»): посценна озвучка лягає на початок своєї сцени.

  python3 scripts/mux-demo-v2.py   →  tutorial-out/demo-v2-voiced.mp4

Сцени — з docs/demo-v2-scenes.json (записані record-tight-v2.ts),
голос — tutorial-out/demo-v2-vo/NN.mp3. Кожна репліка стартує рівно на межі
своєї сцени; якщо сцена вийшла коротшою за репліку, скрипт про це каже —
тоді перезаписувати, а не тягнути картинку.
"""
import json, pathlib, subprocess, tempfile

OUT = pathlib.Path('tutorial-out')
V = OUT / 'demo-v2.webm'
VO = sorted((OUT / 'demo-v2-vo').glob('*.mp3'))
scenes = json.loads(pathlib.Path('docs/demo-v2-scenes.json').read_text())
starts = [s['start'] for s in scenes['scenes']]
assert len(starts) == len(VO), f'сцен {len(starts)}, реплік {len(VO)}'

def dur(p):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                 '-of', 'csv=p=0', str(p)], capture_output=True, text=True).stdout)

vdur = dur(V)
# запис починається раніше за сцену 1 (вхід у демо) — цей підвід відрізаємо,
# а всі межі сцен зсуваємо на його довжину
lead = starts[0]  # у демо це частки секунди
starts = [s - lead for s in starts]
vdur -= lead
ends = starts[1:] + [vdur]
print(f'підвід {lead:.1f} с відрізано')
for i, (f, s, e) in enumerate(zip(VO, starts, ends), 1):
    d = dur(f)
    flag = '  ⚠ репліка довша за сцену' if d > e - s + 0.2 else ''
    print(f'{i} сцена {s:6.2f}–{e:6.2f} с ({e - s:5.1f}) · голос {d:5.1f} с{flag}')

# adelay приймає мілісекунди; всі репліки міксуються в одну доріжку
inputs, delays = [], []
for i, (f, s) in enumerate(zip(VO, starts)):
    inputs += ['-i', str(f)]
    delays.append(f'[{i + 1}:a]adelay={int(s * 1000)}|{int(s * 1000)}[a{i}]')
mix = ''.join(f'[a{i}]' for i in range(len(VO))) + f'amix=inputs={len(VO)}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]'
fc = ';'.join(delays + [mix])

target = OUT / 'demo-v2-voiced.mp4'
subprocess.run(['ffmpeg', '-y', '-v', 'warning', '-stats', '-ss', f'{lead:.3f}', '-i', str(V), *inputs,
                '-filter_complex', fc, '-map', '0:v:0', '-map', '[aout]',
                '-c:v', 'libx264', '-crf', '21', '-preset', 'slow', '-pix_fmt', 'yuv420p',
                '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart',
                str(target)], check=True)
print(f'\n✅ {target} · {target.stat().st_size / 1048576:.1f} МБ · {dur(target):.0f} с')
