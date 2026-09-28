#!/usr/bin/env python3
"""Пітч v7 після відгуку журі 28.09: облік комори — першим, проблема — з даними.

Журі не побачило, як ведеться облік продуктів і термінів: у v6 це займало
~35 с посеред демо. Тут ролик перебудовано навколо тижня однієї родини:
чек → фото → «Де придбали» → комора з термінами → що ось-ось зіпсується →
страва з наявного → списання → комора знову правдива. Рецепти й кошик — після.
Прибрано спільноту й три цінові рівні: ліміт 5:00.

Сцени ріжуться з уже записаних файлів по межах із docs/*-scenes.json, кожна
репліка стартує на межі своєї сцени (як у mux-demo-v2.py). Нові сцени —
record-pitch-v7-scenes.ts, нові слайди — build-pitch-v7.ts, нові репліки —
docs/elevenlabs-pitch-v7.txt → tutorial-out/pitch-v7-vo/.

    python3 scripts/assemble-pitch-v7.py   →  tutorial-out/pitch-final-v7.mp4
"""
import json
import pathlib
import subprocess
import tempfile

OUT = pathlib.Path('tutorial-out')
W, H, FPS = 780, 1688, 25
LIMIT = 300.0  # журі: 3–5 хвилин

DV = OUT / 'demo-v2-vo'
CV = OUT / 'clip-vo'
V7 = OUT / 'pitch-v7-vo'
SLIDES = OUT / 'slides'
V6 = OUT / 'pitch-final-v6.mp4'


def dur(p) -> float:
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                 '-of', 'csv=p=0', str(p)], capture_output=True, text=True).stdout)


def bounds(scenes_json: str, video: pathlib.Path):
    """Межі сцен запису: [старт i, старт i+1), остання — до кінця файлу."""
    starts = [s['start'] for s in json.loads(pathlib.Path(scenes_json).read_text())['scenes']]
    ends = starts[1:] + [dur(video)]
    return list(zip(starts, ends))


DEMO_V = OUT / 'demo-v2.webm'
DEMO = bounds('docs/demo-v2-scenes.json', DEMO_V)
PLACE_V = OUT / 'clip-place.webm'
PLACE = bounds('docs/clip-place-scenes.json', PLACE_V)
NEW_V = OUT / 'pitch-v7-scenes.webm'
NEW = {m['label']: (m['start'], m['end']) for m in json.loads(pathlib.Path('docs/pitch-v7-scenes.json').read_text())['scenes']}

COOK_LINE = dur(DV / '11.mp3') + 0.6  # та сама пауза, що в record-pitch-v7-scenes.ts

# Слайди фіналу v6 (4 «що агент робить сам» … 8 «метрики») і окремо 9 «наступний
# крок». Межа 210.2 с — чорний кадр переходу між ними, 218.18 — до кліпу «Де придбали».
V6_OUTRO = (165.08, 210.2)
V6_NEXT = (210.2, 218.18)

# (назва, тип, аргументи)
EDL = [
    ('проблема',            'slide', ('v7-problem', V7 / '01.mp3')),
    ('гіпотеза',            'slide', ('v7-hypothesis', V7 / '02.mp3')),
    ('для кого і рішення',  'slide', ('v7-solution', V7 / '03.mp3')),
    ('вхід',                'clip',  (DEMO_V, DEMO[1], [(DV / '02.mp3', 0)])),
    ('чек',                 'clip',  (NEW_V, NEW['чек'], [(V7 / '04.mp3', 0)])),
    ('фото холодильника',   'clip',  (DEMO_V, DEMO[4], [(V7 / '05.mp3', 0)])),
    ('підтвердження',       'clip',  (DEMO_V, DEMO[5], [(DV / '06.mp3', 0)])),
    ('де придбали',         'clip',  (PLACE_V, PLACE[0], [(CV / '01.mp3', 0)])),
    ('комора',              'clip',  (DEMO_V, DEMO[6], [(DV / '07.mp3', 0)])),
    ('головна',             'clip',  (DEMO_V, DEMO[2], [(DV / '03.mp3', 0)])),
    ('шпинат',              'clip',  (DEMO_V, DEMO[3], [(DV / '04.mp3', 0)])),
    ('підбір',              'clip',  (DEMO_V, DEMO[7], [(DV / '08.mp3', 0)])),
    ('рецепт',              'clip',  (DEMO_V, DEMO[9], [(DV / '10.mp3', 0)])),
    ('приготування',        'clip',  (NEW_V, NEW['приготування'], [(DV / '11.mp3', 0), (V7 / '06.mp3', COOK_LINE)])),
    ('тірамісу',            'clip',  (DEMO_V, DEMO[11], [(DV / '12.mp3', 0)])),
    ('звірив комору',       'clip',  (DEMO_V, DEMO[12], [(DV / '13.mp3', 0)])),
    ('готувати чи купити',  'clip',  (DEMO_V, DEMO[14], [(DV / '15.mp3', 0)])),
    ('підтвердження кошика', 'clip', (DEMO_V, DEMO[15], [(DV / '16.mp3', 0)])),
    ('кошик',               'clip',  (DEMO_V, DEMO[16], [(DV / '17.mp3', 0)])),
    ('трасування',          'clip',  (DEMO_V, DEMO[17], [(DV / '18.mp3', 0)])),
    ('агент, MCP, метрики', 'v6',    V6_OUTRO),
    ('пілот',               'slide', ('v7-pilot', V7 / '07.mp3')),
    ('метрика: де придбали', 'clip', (PLACE_V, PLACE[1], [(CV / '02.mp3', 0)])),
    ('наступний крок',      'v6',    V6_NEXT),
    ('фінал',               'clip',  (PLACE_V, PLACE[3], [(CV / '04.mp3', 0)])),
]

VENC = ['-c:v', 'libx264', '-crf', '21', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', str(FPS)]
AENC = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2']
SCALE = f'scale={W}:{H}:flags=lanczos,fps={FPS},setsar=1'


def run(cmd):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', *cmd], check=True)


def clip(src, span, voices, out):
    """Шматок запису + репліки, кожна зі своїм зсувом від початку сцени."""
    s, e = span
    length = e - s
    for f, off in voices:
        if off + dur(f) > length + 0.2:
            print(f'   ⚠ {out.stem}: репліка {f.name} виходить за сцену ({off + dur(f):.1f} > {length:.1f} с)')
    inputs, parts = [], []
    for i, (f, off) in enumerate(voices, start=1):
        inputs += ['-i', str(f)]
        ms = int(off * 1000)
        parts.append(f'[{i}:a]aresample=48000,adelay={ms}|{ms}[a{i}]')
    mix = ''.join(f'[a{i}]' for i in range(1, len(voices) + 1))
    fc = ';'.join(parts + [f'{mix}amix=inputs={len(voices)}:normalize=0,apad[aout]', f'[0:v]{SCALE}[vout]'])
    run(['-ss', f'{s:.3f}', '-t', f'{length:.3f}', '-i', str(src), *inputs,
         '-filter_complex', fc, '-map', '[vout]', '-map', '[aout]', '-t', f'{length:.3f}',
         *VENC, *AENC, str(out)])


def slide(name, voice, out, lead=0.3, tail=0.8):
    length = lead + dur(voice) + tail
    ms = int(lead * 1000)
    run(['-loop', '1', '-framerate', str(FPS), '-i', str(SLIDES / f'{name}.png'), '-i', str(voice),
         '-filter_complex', f'[0:v]{SCALE},fade=in:0:8,fade=out:st={length - 0.32:.2f}:d=0.32[vout];'
                            f'[1:a]aresample=48000,adelay={ms}|{ms},apad[aout]',
         '-map', '[vout]', '-map', '[aout]', '-t', f'{length:.3f}', *VENC, *AENC, str(out)])


def v6(span, out):
    s, e = span
    run(['-ss', f'{s:.3f}', '-t', f'{e - s:.3f}', '-i', str(V6), '-vf', SCALE,
         '-af', 'aresample=48000', *VENC, *AENC, str(out)])


def main():
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='pitch-v7-'))
    parts, t = [], 0.0
    for i, (label, kind, args) in enumerate(EDL, start=1):
        out = tmp / f'{i:02d}.mp4'
        if kind == 'slide':
            slide(*args, out)
        elif kind == 'clip':
            clip(*args, out)
        else:
            v6(args, out)
        d = dur(out)
        print(f'{i:2d} {int(t // 60)}:{t % 60:04.1f}  {label:<22} {d:5.1f} с')
        parts.append(out)
        t += d

    lst = tmp / 'list.txt'
    lst.write_text(''.join(f"file '{p}'\n" for p in parts))
    joined = tmp / 'joined.mp4'
    run(['-f', 'concat', '-safe', '0', '-i', str(lst), '-c', 'copy', str(joined)])
    target = OUT / 'pitch-final-v7.mp4'
    # гучність — одним проходом по всьому ролику: репліки з різних сесій синтезу
    # і вже нормалізований шматок v6 мають звучати рівно
    run(['-i', str(joined), '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', *AENC,
         '-movflags', '+faststart', str(target)])
    total = dur(target)
    print(f'\n✅ {target} · {target.stat().st_size / 1048576:.1f} МБ · {int(total // 60)}:{total % 60:04.1f}')
    if total > LIMIT:
        print(f'⚠ довше за {LIMIT:.0f} с на {total - LIMIT:.1f} с')


if __name__ == '__main__':
    main()
