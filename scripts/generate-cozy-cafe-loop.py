import math
import random
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 16000
BPM = 102
BEATS_PER_BAR = 4
BARS = 16
SWING = 0.58
MASTER = 0.72

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "audio" / "cozy-cafe-loop.wav"

random.seed(314159)

NOTE = {
    "C": 0, "Cs": 1, "Db": 1, "D": 2, "Ds": 3, "Eb": 3, "E": 4, "F": 5,
    "Fs": 6, "Gb": 6, "G": 7, "Gs": 8, "Ab": 8, "A": 9, "As": 10, "Bb": 10, "B": 11,
}


def midi(name):
    pitch = name[:-1]
    octave = int(name[-1])
    return 12 * (octave + 1) + NOTE[pitch]


def hz(midi_note):
    return 440.0 * (2 ** ((midi_note - 69) / 12))


def beat_time(beat):
    return beat * 60 / BPM


def add(buf, left, right, amp=1.0):
    if 0 <= left < len(buf):
        buf[left][0] += right[0] * amp
        buf[left][1] += right[1] * amp


def env_pluck(t, dur, attack=0.01, decay=2.8):
    if t < 0 or t > dur:
        return 0.0
    if t < attack:
        return t / attack
    return math.exp(-(t - attack) * decay)


def env_pad(t, dur, attack=0.08, release=0.18):
    if t < 0 or t > dur:
        return 0.0
    if t < attack:
        return t / attack
    if t > dur - release:
        return max(0.0, (dur - t) / release)
    return 1.0


def pan(sample, pan_value):
    left = sample * math.sqrt((1 - pan_value) * 0.5)
    right = sample * math.sqrt((1 + pan_value) * 0.5)
    return left, right


def synth_epiano(buf, start, dur, note, velocity=0.32, pan_value=-0.1):
    start_i = int(start * SAMPLE_RATE)
    end_i = min(len(buf), int((start + dur) * SAMPLE_RATE))
    freq = hz(note)
    phase_lfo = random.random() * math.tau
    for i in range(start_i, end_i):
        t = i / SAMPLE_RATE - start
        e = env_pad(t, dur, attack=0.12, release=0.28) * env_pluck(t, dur, attack=0.028, decay=0.38)
        trem = 0.96 + 0.04 * math.sin((t * 3.1) + phase_lfo)
        tone = (
            math.sin(math.tau * freq * t)
            + 0.12 * math.sin(math.tau * freq * 2.0 * t)
        )
        add(buf, i, pan(tone * e * trem, pan_value), velocity)


def synth_mallet(buf, start, dur, note, velocity=0.26, pan_value=0.16):
    start_i = int(start * SAMPLE_RATE)
    end_i = min(len(buf), int((start + dur) * SAMPLE_RATE))
    freq = hz(note)
    for i in range(start_i, end_i):
        t = i / SAMPLE_RATE - start
        e = env_pluck(t, dur, attack=0.008, decay=3.9)
        tone = (
            math.sin(math.tau * freq * t)
            + 0.18 * math.sin(math.tau * freq * 2.0 * t)
        )
        add(buf, i, pan(tone * e, pan_value), velocity)


def synth_kalimba(buf, start, dur, note, velocity=0.2, pan_value=0.0):
    start_i = int(start * SAMPLE_RATE)
    end_i = min(len(buf), int((start + dur) * SAMPLE_RATE))
    freq = hz(note)
    for i in range(start_i, end_i):
        t = i / SAMPLE_RATE - start
        e = env_pluck(t, dur, attack=0.004, decay=6.6)
        tone = math.sin(math.tau * freq * t) + 0.08 * math.sin(math.tau * freq * 3.0 * t)
        add(buf, i, pan(tone * e, pan_value), velocity)


def synth_bass(buf, start, dur, note, velocity=0.38):
    start_i = int(start * SAMPLE_RATE)
    end_i = min(len(buf), int((start + dur) * SAMPLE_RATE))
    freq = hz(note)
    for i in range(start_i, end_i):
        t = i / SAMPLE_RATE - start
        e = env_pluck(t, dur, attack=0.012, decay=2.1)
        tone = math.sin(math.tau * freq * t) + 0.22 * math.sin(math.tau * freq * 2 * t)
        add(buf, i, pan(tone * e, -0.02), velocity)


def synth_brush(buf, start, dur, velocity=0.09, pan_value=0.22):
    start_i = int(start * SAMPLE_RATE)
    end_i = min(len(buf), int((start + dur) * SAMPLE_RATE))
    rng = random.Random(int(start * 1000) + 7)
    last = 0.0
    for i in range(start_i, end_i):
        t = i / SAMPLE_RATE - start
        e = env_pluck(t, dur, attack=0.002, decay=14)
        noise = rng.uniform(-1, 1)
        last = 0.72 * last + 0.28 * noise
        hiss = noise - last
        add(buf, i, pan(hiss * e, pan_value), velocity)


def synth_kick(buf, start, dur=0.18, velocity=0.12):
    start_i = int(start * SAMPLE_RATE)
    end_i = min(len(buf), int((start + dur) * SAMPLE_RATE))
    for i in range(start_i, end_i):
        t = i / SAMPLE_RATE - start
        e = env_pluck(t, dur, attack=0.004, decay=18)
        freq = 78 - 32 * min(1, t / dur)
        tone = math.sin(math.tau * freq * t)
        add(buf, i, pan(tone * e, 0.0), velocity)


chords = [
    ["E4", "B4", "D5"],
    ["Cs4", "G4", "Bb4"],
    ["F4", "C5", "E5"],
    ["F4", "B4", "E5"],
    ["G4", "B4", "D5"],
    ["Cs4", "B4", "F5"],
    ["F4", "A4", "E5"],
    ["F4", "B4", "E5"],
    ["E4", "A4", "G5"],
    ["Eb4", "Ab4", "C5"],
    ["D4", "G4", "E5"],
    ["G4", "Bb4", "F5"],
    ["F4", "C5", "E5"],
    ["F4", "B4", "E5"],
    ["E4", "B4", "D5"],
    ["F4", "B4", "E5"],
]

roots = ["C2", "A1", "D2", "G1", "E2", "A1", "D2", "G1", "F2", "F2", "E2", "A1", "D2", "G1", "C2", "G1"]
fifths = ["G2", "E2", "A2", "D2", "B2", "E2", "A2", "D2", "C3", "C3", "B2", "E2", "A2", "D2", "G2", "D2"]

melody_pool = ["E5", "G5", "A5", "B5", "D6", "E6", "G6"]
answer_pool = ["D5", "E5", "G5", "A5", "B5", "D6"]

duration = beat_time(BARS * BEATS_PER_BAR)
buffer = [[0.0, 0.0] for _ in range(int(duration * SAMPLE_RATE))]

for bar in range(BARS):
    pattern_index = bar % len(chords)
    bar_start = beat_time(bar * BEATS_PER_BAR)
    chord = [midi(n) for n in chords[pattern_index]]
    for offset in [0, 2.0]:
        for n in chord:
            synth_epiano(buffer, bar_start + beat_time(offset), beat_time(1.8), n, velocity=0.06, pan_value=-0.2)
    synth_bass(buffer, bar_start, beat_time(0.92), midi(roots[pattern_index]), velocity=0.26)
    synth_bass(buffer, bar_start + beat_time(2), beat_time(0.92), midi(fifths[pattern_index]), velocity=0.2)

    # Soft swing brushes.
    for beat in range(4):
        synth_brush(buffer, bar_start + beat_time(beat), 0.06, velocity=0.04, pan_value=0.25)
    if bar % 2 == 0:
        synth_kick(buffer, bar_start, velocity=0.045)

    # Original singable call-and-response melody.
    melody_patterns = [
        ["E5", "G5", "A5", "G5"],
        ["B5", "A5", "G5", "E5"],
        ["D5", "E5", "G5", "A5"],
        ["B5", "D6", "B5", "G5"],
    ]
    starts = [0.25, 1.0 + SWING, 2.0, 3.0 + SWING]
    phrase = melody_patterns[bar % len(melody_patterns)]
    if bar % 8 in (6,):
        phrase = ["A5", "G5", "E5"]
        starts = [0.5, 1.75, 3.0]
    for idx, note_name in enumerate(phrase):
        synth_mallet(buffer, bar_start + beat_time(starts[idx]), beat_time(0.7), midi(note_name), velocity=0.24, pan_value=0.18)
        if idx in (0, 2):
            synth_kalimba(buffer, bar_start + beat_time(starts[idx] + 0.5), beat_time(0.48), midi(note_name) - 12, velocity=0.095, pan_value=-0.12)

# Tiny room echo, kept inside the loop length.
delay = int(0.18 * SAMPLE_RATE)
for i in range(delay, len(buffer)):
    buffer[i][0] += buffer[i - delay][1] * 0.055
    buffer[i][1] += buffer[i - delay][0] * 0.055

# Soft fade in/out for loop cleanliness.
fade = int(0.45 * SAMPLE_RATE)
for i in range(fade):
    ramp_in = i / fade
    ramp_out = (fade - i) / fade
    buffer[i][0] *= ramp_in
    buffer[i][1] *= ramp_in
    buffer[-1 - i][0] *= ramp_out
    buffer[-1 - i][1] *= ramp_out

peak = max(max(abs(l), abs(r)) for l, r in buffer) or 1.0
scale = MASTER / peak

OUT.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(OUT), "wb") as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(SAMPLE_RATE)
    frames = bytearray()
    for left, right in buffer:
        l = max(-1, min(1, left * scale))
        r = max(-1, min(1, right * scale))
        frames.extend(struct.pack("<hh", int(l * 32767), int(r * 32767)))
    wav.writeframes(frames)

print(OUT)
