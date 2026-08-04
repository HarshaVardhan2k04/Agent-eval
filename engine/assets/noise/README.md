# Noise environment presets

Drop background-noise audio files here (mp3 or wav). Each file becomes a
selectable noise environment in the Test STT "Add noise" UI.

Naming -> label: the filename (minus extension) is slugified into the preset
key, and a Title-Cased label is derived from it. Examples:

  traffic.mp3        -> key "traffic",        label "Traffic"
  cafe_babble.mp3    -> key "cafe_babble",    label "Cafe Babble"
  office_ambience.mp3-> key "office_ambience",label "Office Ambience"

Tips:
- A 20-60s clip is plenty; it's looped to cover the whole recording.
- Real field recordings work best (traffic, crowd/babble, cafe, office, wind,
  rain, keyboard). Mono or stereo both fine (we downmix to mono 16k).
