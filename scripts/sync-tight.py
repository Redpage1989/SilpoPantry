#!/usr/bin/env python3
"""Покласти демо-озвучку на щільний перезапис (докладніше — sync-voiceover.py)."""
import json, re, subprocess, tempfile, pathlib, sys

A = sys.argv[1]
V = pathlib.Path('tutorial-out/demo-tight.mp4')
OUT = pathlib.Path('tutorial-out/demo-tight-voiced.mp4')

def dur(p):
    return float(subprocess.run(["ffprobe","-v","error","-show_entries","format=duration",
                                 "-of","csv=p=0",str(p)],capture_output=True,text=True).stdout)

starts = [m['start'] for m in json.loads(pathlib.Path('docs/demo-tight-scenes.json').read_text())['scenes']]
paras = [p.strip() for p in pathlib.Path('docs/elevenlabs-text.txt').read_text(encoding='utf-8').split('\n\n') if p.strip()]
adur, vdur = dur(A), dur(V)

log = subprocess.run(["ffmpeg","-v","info","-i",A,"-af","silencedetect=noise=-45dB:d=0.15","-f","null","-"],
                     capture_output=True,text=True).stderr
gaps = sorted((a,b) for a,b in zip([float(x) for x in re.findall(r"silence_start: ([\d.]+)",log)],
                                    [float(x) for x in re.findall(r"silence_end: ([\d.]+)",log)]) if b>a)
lens=[len(p) for p in paras]; T=sum(lens); cum=[];acc=0
for n in lens[:-1]:
    acc+=n; cum.append(acc/T*adur)
cuts=[];prev=0.0
for want in cum:
    cand=[g for g in gaps if g[0]>prev+0.4]
    best=min(cand,key=lambda g:abs((g[0]+g[1])/2-want)); mid=(best[0]+best[1])/2
    cuts.append(mid); prev=mid
bnd=[0.0]+cuts+[adur]
segs=[(bnd[i],bnd[i+1]) for i in range(len(paras))]

print(f"відео {vdur:.1f} с · доріжка {adur:.1f} с · сцен {len(starts)}\n")
with tempfile.TemporaryDirectory() as td:
    tmp=pathlib.Path(td); parts=[]; pos=0.0; over=[]
    for i,((s,e),tgt) in enumerate(zip(segs,starts)):
        gap=tgt-pos
        if gap < -0.2: over.append((i+1, round(-gap,1))); gap=0.05
        if gap>0:
            f=tmp/f"s{i}.wav"
            subprocess.run(["ffmpeg","-y","-v","error","-f","lavfi","-i","anullsrc=r=44100:cl=mono",
                            "-t",f"{gap:.3f}",str(f)],check=True)
            parts.append(f); pos+=gap
        f=tmp/f"g{i}.wav"
        subprocess.run(["ffmpeg","-y","-v","error","-i",A,"-ss",f"{s:.3f}","-to",f"{e:.3f}",
                        "-ac","1","-ar","44100",str(f)],check=True)
        parts.append(f); pos+=e-s
        print(f"  {i+1:2}. {tgt:6.1f}с  {e-s:5.1f}с  {paras[i][:44]}…")
    if over: print(f"\n⚠ репліки, довші за сцену: {over}")
    lst=tmp/"l.txt"; lst.write_text("".join(f"file '{p}'\n" for p in parts))
    tr=tmp/"t.wav"
    subprocess.run(["ffmpeg","-y","-v","error","-f","concat","-safe","0","-i",str(lst),"-c","copy",str(tr)],check=True)
    print(f"\nдоріжка: {dur(tr):.1f} с · відео: {vdur:.1f} с")
    subprocess.run(["ffmpeg","-y","-v","error","-i",str(V),"-i",str(tr),
                    "-filter:a","loudnorm=I=-16:TP=-1.5:LRA=11,apad",
                    "-map","0:v:0","-map","1:a:0","-c:v","copy",
                    "-c:a","aac","-b:a","128k","-ar","48000","-ac","1",
                    "-shortest","-movflags","+faststart",str(OUT)],check=True)
print(f"\n✅ {OUT} · {dur(OUT)//60:.0f}:{dur(OUT)%60:04.1f}")
