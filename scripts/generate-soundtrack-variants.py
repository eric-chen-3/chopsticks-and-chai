import math
import random
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 16000
BEATS = 64
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "audio"

NOTE = {
    "C": 0, "Cs": 1, "Db": 1, "D": 2, "Ds": 3, "Eb": 3, "E": 4, "F": 5,
    "Fs": 6, "Gb": 6, "G": 7, "Gs": 8, "Ab": 8, "A": 9, "As": 10, "Bb": 10, "B": 11,
}


def midi(name):
    return 12 * (int(name[-1]) + 1) + NOTE[name[:-1]]


def hz(note):
    return 440 * (2 ** ((note - 69) / 12))


def env(t, dur, attack=0.01, decay=3.0):
    if t < 0 or t > dur:
        return 0
    if t < attack:
        return t / attack
    return math.exp(-(t - attack) * decay)


def pad_env(t, dur):
    if t < 0 or t > dur:
        return 0
    if t < 0.12:
        return t / 0.12
    if t > dur - 0.25:
        return max(0, (dur - t) / 0.25)
    return 1


def pan(v, p):
    return v * math.sqrt((1 - p) / 2), v * math.sqrt((1 + p) / 2)


def add(buf, index, stereo):
    if 0 <= index < len(buf):
        buf[index][0] += stereo[0]
        buf[index][1] += stereo[1]


def tone(buf, start, dur, note, amp, kind="mallet", p=0):
    start_i = int(start * SAMPLE_RATE)
    end_i = min(len(buf), int((start + dur) * SAMPLE_RATE))
    freq = hz(note)
    for i in range(start_i, end_i):
        t = i / SAMPLE_RATE - start
        if kind == "pad":
            e = pad_env(t, dur) * env(t, dur, 0.04, 0.35)
            wave_value = math.sin(math.tau * freq * t) + 0.09 * math.sin(math.tau * freq * 2 * t)
        elif kind == "bass":
            e = env(t, dur, 0.01, 2.0)
            wave_value = math.sin(math.tau * freq * t) + 0.12 * math.sin(math.tau * freq * 2 * t)
        elif kind == "flute":
            e = pad_env(t, dur)
            wave_value = math.sin(math.tau * freq * t) + 0.06 * math.sin(math.tau * freq * 3 * t)
        else:
            e = env(t, dur, 0.004, 4.8)
            wave_value = math.sin(math.tau * freq * t) + 0.12 * math.sin(math.tau * freq * 3 * t)
        add(buf, i, pan(wave_value * e * amp, p))


def brush(buf, start, dur, amp, p=0.25):
    rng = random.Random(int(start * 1000))
    last = 0
    for i in range(int(start * SAMPLE_RATE), min(len(buf), int((start + dur) * SAMPLE_RATE))):
        t = i / SAMPLE_RATE - start
        e = env(t, dur, 0.002, 15)
        n = rng.uniform(-1, 1)
        last = 0.72 * last + 0.28 * n
        add(buf, i, pan((n - last) * e * amp, p))


def kick(buf, start, amp):
    for i in range(int(start * SAMPLE_RATE), min(len(buf), int((start + 0.16) * SAMPLE_RATE))):
        t = i / SAMPLE_RATE - start
        add(buf, i, pan(math.sin(math.tau * (74 - 22 * t) * t) * env(t, 0.16, 0.004, 18) * amp, 0))


def write_wav(path, buf, master=0.72):
    delay = int(0.16 * SAMPLE_RATE)
    for i in range(delay, len(buf)):
        buf[i][0] += buf[i - delay][1] * 0.045
        buf[i][1] += buf[i - delay][0] * 0.045
    fade = int(0.35 * SAMPLE_RATE)
    for i in range(fade):
        buf[i][0] *= i / fade
        buf[i][1] *= i / fade
        buf[-1 - i][0] *= (fade - i) / fade
        buf[-1 - i][1] *= (fade - i) / fade
    peak = max(max(abs(l), abs(r)) for l, r in buf) or 1
    frames = bytearray()
    for l, r in buf:
        frames.extend(struct.pack("<hh", int(max(-1, min(1, l * master / peak)) * 32767), int(max(-1, min(1, r * master / peak)) * 32767)))
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(frames)


def render_variant(filename, bpm, chords, roots, melody, mood):
    random.seed(9100 + len(filename))
    beat = 60 / bpm
    dur = beat * BEATS
    buf = [[0.0, 0.0] for _ in range(int(dur * SAMPLE_RATE))]
    for bar in range(16):
        start = bar * 4 * beat
        chord = chords[bar % len(chords)]
        root = roots[bar % len(roots)]
        for off in (0, 2):
            for n in chord:
                tone(buf, start + off * beat, 1.85 * beat, midi(n), mood["pad"], "pad", -0.22)
        tone(buf, start, 0.9 * beat, midi(root), mood["bass"], "bass", -0.04)
        tone(buf, start + 2 * beat, 0.9 * beat, midi(root) + 7, mood["bass"] * 0.72, "bass", -0.04)
        if mood["drums"]:
            for b in range(4):
                brush(buf, start + b * beat, 0.055, mood["brush"])
            if bar % 2 == 0:
                kick(buf, start, mood["kick"])
        phrase = melody[bar % len(melody)]
        times = [0.25, 1.55, 2.25, 3.55]
        for idx, note_name in enumerate(phrase):
            lead = "flute" if mood["lead"] == "flute" and idx % 2 else "mallet"
            tone(buf, start + times[idx] * beat, 0.68 * beat, midi(note_name), mood["melody"], lead, 0.18)
            if mood["sparkle"] and idx in (1, 3):
                tone(buf, start + (times[idx] + 0.36) * beat, 0.36 * beat, midi(note_name) - 12, mood["sparkle"], "mallet", -0.14)
    path = OUT_DIR / filename
    write_wav(path, buf, mood["master"])
    return path


OUT_DIR.mkdir(parents=True, exist_ok=True)

variants = [
    (
        "soundtrack-sunny-market-stroll.wav",
        106,
        [["E4", "G4", "B4"], ["D4", "G4", "B4"], ["F4", "A4", "C5"], ["E4", "A4", "C5"]],
        ["C2", "G1", "F2", "A1"],
        [["E5", "G5", "A5", "G5"], ["B5", "A5", "G5", "E5"], ["F5", "A5", "C6", "A5"], ["G5", "E5", "D5", "E5"]],
        {"pad": 0.055, "bass": 0.22, "melody": 0.26, "sparkle": 0.08, "brush": 0.035, "kick": 0.035, "drums": True, "lead": "mallet", "master": 0.72},
    ),
    (
        "soundtrack-rainy-jazz-lounge.wav",
        92,
        [["E4", "A4", "C5"], ["Eb4", "Ab4", "C5"], ["D4", "G4", "B4"], ["Cs4", "G4", "Bb4"]],
        ["A1", "Ab1", "G1", "Cs2"],
        [["C5", "E5", "G5", "E5"], ["C5", "Eb5", "G5", "Ab5"], ["B4", "D5", "G5", "B5"], ["Bb4", "Cs5", "F5", "G5"]],
        {"pad": 0.07, "bass": 0.24, "melody": 0.2, "sparkle": 0.04, "brush": 0.025, "kick": 0.02, "drums": True, "lead": "flute", "master": 0.7},
    ),
    (
        "soundtrack-night-teahouse-bossa.wav",
        100,
        [["F4", "B4", "E5"], ["E4", "A4", "D5"], ["D4", "G4", "C5"], ["E4", "G4", "B4"]],
        ["G1", "A1", "D2", "E2"],
        [["B4", "E5", "G5", "B5"], ["A4", "D5", "F5", "A5"], ["G4", "C5", "E5", "G5"], ["B4", "G5", "E5", "D5"]],
        {"pad": 0.06, "bass": 0.26, "melody": 0.22, "sparkle": 0.06, "brush": 0.045, "kick": 0.03, "drums": True, "lead": "flute", "master": 0.71},
    ),
    (
        "soundtrack-morning-garden-melody.wav",
        112,
        [["C4", "E4", "G4"], ["D4", "F4", "A4"], ["E4", "G4", "B4"], ["F4", "A4", "C5"]],
        ["C2", "D2", "E2", "F2"],
        [["G5", "A5", "C6", "A5"], ["F5", "A5", "D6", "A5"], ["G5", "B5", "E6", "D6"], ["C6", "A5", "G5", "E5"]],
        {"pad": 0.045, "bass": 0.2, "melody": 0.28, "sparkle": 0.1, "brush": 0.018, "kick": 0.0, "drums": False, "lead": "mallet", "master": 0.72},
    ),
]

for args in variants:
    print(render_variant(*args))
