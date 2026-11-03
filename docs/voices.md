# Choosing a soothing voice

The guide talks for a long time, often while you're driving or walking somewhere new, so the voice
should be **calm**: not too high, steady rather than sing-song, unhurried, and soft rather than crisp
and hissy. It should also be **free, private and work offline**. So it runs on the phone itself, and nothing
you hear is sent to a server.

## The voices today: Supertonic 3 (November 2026)

Roamie's main voices are now **[Supertonic 3](https://github.com/supertone-inc/supertonic)** (Supertone, 99 million
parameters, [Open RAIL-M licence](../voices/supertonic-3/LICENSE)): one model that speaks 31 languages, including all five
of Roamie's, with natural intonation; it reads letters rather than phonemes, so it needs no pronunciation
dictionary. Three of its ten voice styles are in the app, and each speaks every language the same way:

| In the app | Style | Supertone's description | Pitch | Spread | Words/min | High freq. |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| **Nora** (default) | F1 | calm, slightly low, steady and composed | 188 | 5.6 | 159 | 0.7% |
| **Victor** (narrator) | M2 | deep, robust; calm, composed and serious | 95 | 5.8 | 161 | 0.4% |
| **Lea** | F5 | kind, gentle, soft-spoken and soothing | 158 | 5.8 | 164 | 1.2% |
| F4 | | crisp and confident | 196 | 3.9 | 185 | 0.5% |
| F2, F3 | | bright and cheerful; announcer | 156–181 | 7.4–7.9 | 154–169 | 0.5–14% |
| M5 | | warm, soft-spoken storyteller | 87 | 5.9 | 159 | 1.0% |
| M1, M3, M4 | | lively; polished presenter; youthful | 98–131 | 5.0–9.2 | 158–193 | 0.4–2.1% |

(Measured as in the table below, on the English preview sentence; the Piper default Jenny measures 179 / 4.0 / 160.)
The Piper voices stay as the "lighter" option (63 MB, faster on old phones) and as the fallback.

How it runs on the phone:

- **Four networks** on ONNX Runtime Web (already used for Piper): how long the sentence takes, what it says, the
  sound in a compact form refined from noise over a few steps, and the 44.1 kHz waveform (`js/supertonicVoice.js`).
- **8-bit**: the app ships a copy with 8-bit weights, 110 MB instead of 398 MB. Checked against the full model with
  the same noise and duration, the 8-bit model's output differs *less* than two renderings of the same sentence by
  the full model differ from each other (mel-cepstral distance 171–188 against 216–291, in the same units), i.e. less
  than the model's own natural variation. 8-bit *arithmetic* (dynamic quantization) was tried and rejected: the
  vocoder's output turned to noise. Expanding the weights back to 32-bit at load was tried too: three times slower in
  the browser and twice the memory. The memory of the tab is about 360 MB (1.2 GB with the full model).
- **Numbers in words** (`js/numbers.js`): the model read "1904" wrongly in German, Spanish and Italian
  ("neunzehn… null vier", "mil nueve… ciento cuatro") though not in English or French. Years, counts, decimals,
  percentages, units, ordinals, centuries and regnal numbers are written out first, in all five languages:
  *nineteen oh four*, *mille neuf cent quatre*, *neunzehnhundertvier*, *im vierzehnten Jahrhundert*, *Luigi
  quattordicesimo*, *siglo catorce*, *Louis quatorze*, *Henry the fifth*.
- **Speed that fits the phone**: the refinement steps go from 8 (cleanest) down to 3 so the voice stays ahead of
  the listener; the app measures the first sentences and settles. On a slow server core, one thread, the browser
  makes speech at 1.9× real time with 8 steps and 1.0× with 4 (a recent iPhone core is about three times faster;
  the app prepares the next sentence while the current one plays).
- **In a worker**: the runtime does its work off the page's main thread (for the Piper voices too now), so the map
  and the first-person view stay smooth while a sentence is being made.
- The same **warmth EQ**, pauses and fades as below; the narrator profile is the same deeper, slower rendering.

## The lighter voices: Piper

### The engine

[Piper](https://github.com/rhasspy/piper) neural text-to-speech (MIT licence), running in the browser on
ONNX Runtime Web. Each voice is a ~63 MB model, plus an 18 MB pronunciation dictionary shared by all
voices. It downloads once, then it's cached on the device. On a laptop CPU (one thread) it speaks 4× faster
than real time; the app prepares the next sentence while the current one plays, so phones keep up.

On top of the raw model output, the app:

- speaks **~10% slower** than the model's default (`length_scale × 1.12`; the *Pace* menu adjusts it),
- adds a **calm pause** (0.28 s) between sentences,
- applies a gentle **"warmth" EQ**: −4 dB above 4.5 kHz (less sibilance and hiss), +2 dB below 220 Hz (more body),
- fades each sentence in and out (no clicks),
- reads regnal numbers naturally in French and German (*Louis XIV* → "Louis quatorze", not "Louis X-I-V romain").

## How the voices were compared

Every female voice in the official collection for our five languages (plus the best male voice where
female options were weak) read the same tour sentence. Each recording was then measured:

| Measure | Why it matters | Calmer is… |
| --- | --- | --- |
| Median pitch (Hz) | High voices sound brighter, more "announcer" | lower |
| Pitch spread (semitones, 10th–90th percentile) | Wide spread = sing-song, animated | narrower |
| Speaking rate (words/min) | Hurried delivery is tiring | slower |
| High-frequency energy (% above 4 kHz) | Sibilance and crispness | lower |

Every recording was also transcribed by a speech recognizer (Whisper) to check it is clearly understood.

| Voice | Pitch | Spread | Words/min | High freq. | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| **en_GB jenny_dioco** ("Jenny (Dioco)") | 179 | **4.0** | **160** | 13.9% | ⭐ English default: steadiest and least hurried |
| **en_US amy** | 190 | 5.1 | 167 | 10.5% | ⭐ English alternative: warm and soft |
| en_US kristin | 162 | 4.2 | 164 | 16.4% | calm, but the crispest; misheard once |
| en_US hfc_female | 208 | 9.5 | 183 | 10.3% | lively, fast |
| en_US lessac | 199 | 9.6 | 191 | 7.6% | lively, fast (great for audiobooks, not for calm) |
| **fr_FR siwis** | 208 | 5.6 | 172 | 12.5% | ⭐ French default: clear and gentle |
| **fr_FR upmc (Jessica)** | 240 | 5.1 | 170 | 7.7% | ⭐ French alternative: warmest timbre, higher voice |
| **es_MX claude** | 184 | 5.8 | **164** | 14.8% | ⭐ Spanish default: unhurried, best recognized |
| **es_ES sharvard (F)** | 197 | 5.0 | 187 | 7.6% | ⭐ Spanish alternative: Castilian, warm but fast |
| **de_DE kerstin** | 165 | **3.7** | **152** | 10.8% | ⭐ German default: the calmest voice measured |
| **de_DE thorsten** | 137 | 10.0 | 167 | 2.5% | ⭐ German alternative: clearest German, male, more animated |
| **it_IT paola** | 195 | 4.6 | 195 | 11.0% | ⭐ Italian default: steady (fast natively; the calm pace fixes it) |
| **it_IT serena** | 218 | 8.4 | 166 | 14.8% | ⭐ Italian alternative: very clear, livelier |

At the app's calm pace, with the numeral fix and the EQ, all ten selected voices were transcribed
essentially word-for-word.

## The documentary narrators

For a second kind of guide (a deep, unhurried storyteller in the tradition of classic British nature
documentaries), the male voices were compared the same way. This is an original voice built from an open
dataset: it doesn't imitate or clone any real person.

| Voice (English, British) | Pitch | Spread | Words/min | High freq. | Recognized |
| --- | ---: | ---: | ---: | ---: | --- |
| **vctk p274** (southern English) | 100 | 5.0 | 157 | 2.2% | ⭐ perfectly: warm, deep, gently expressive, unhurried |
| vctk p226 (Surrey) | 113 | 5.1 | 166 | 2.0% | perfectly (close second) |
| alan | 95 | 3.2 | 150 | 10.2% | perfectly, but flat and brighter |
| vctk p254 (Surrey) | 80 | 2.7 | 179 | 4.7% | yes, but faster and creaky |
| northern_english_male | 110 | 4.3 | 217 | 8.2% | yes, but much too fast |
| vctk p232, p258, p273 | 117–151 | 1.9–6.4 | 210–223 | 2.4–3.7% | misheard words ("pond" for "pont") |
| semaine (spike, obadiah) | | | | | excluded: non-commercial licence |

The narrator profile then makes the chosen voice sound older and more intimate:

- **deeper**: played back at 93% speed (about 1¼ semitones lower), with synthesis sped up to compensate, so
  only the pitch drops, not the pace,
- **slower**: ~20% slower than the model's default, with **0.6 s pauses** between sentences,
- **closer**: more low body (+3.5 dB) and softer highs (−5.5 dB), for a hushed, close-to-the-mic feel,
- **documentary phrasing**: *"And here, on your left… Casa Batlló."*, *"And so, we arrive at Santa
  Maria del Mar."*, *"Our journey continues to…"* (in English, French, Spanish and German).

Narrators in other languages: **Pierre** (French, upmc), **Marcos** (Spanish, sharvard male speaker) and
**Thorsten** (German, already deep, so no pitch drop: it blurred German consonants). Rendered with the full
narrator profile, all four were transcribed word-for-word (Pierre's deeper voice even fixed a mishearing). Italian has no
good male voice in the collection yet.

Named "Arthur" in the app (the dataset speaker has no name).

## Listen

The same sentence (the one used to compare the voices), exactly as the app plays it (numbers in words, pace,
pitch and warmth EQ). The new voices first:

- Nora: [English](voice-samples/nora-en.mp3), [français](voice-samples/nora-fr.mp3), [español](voice-samples/nora-es.mp3), [Deutsch](voice-samples/nora-de.mp3), [italiano](voice-samples/nora-it.mp3)
- Victor, the narrator (the documentary sentence): [English](voice-samples/victor-en.mp3), [français](voice-samples/victor-fr.mp3), [español](voice-samples/victor-es.mp3), [Deutsch](voice-samples/victor-de.mp3), [italiano](voice-samples/victor-it.mp3)
- Lea: [English](voice-samples/lea-en.mp3), [français](voice-samples/lea-fr.mp3), [español](voice-samples/lea-es.mp3), [Deutsch](voice-samples/lea-de.mp3), [italiano](voice-samples/lea-it.mp3)
- Nora reading a passage full of numbers (years, a height, a count, a century, a king): [English](voice-samples/nora-numbers-en.mp3), [français](voice-samples/nora-numbers-fr.mp3), [español](voice-samples/nora-numbers-es.mp3), [Deutsch](voice-samples/nora-numbers-de.mp3), [italiano](voice-samples/nora-numbers-it.mp3)
- Nora as a slow phone hears her, with 3 refinement steps instead of 8: [English](voice-samples/nora-3-steps-en.mp3), [Deutsch](voice-samples/nora-3-steps-de.mp3)

The lighter Piper voices:

- English: [Jenny (Dioco)](voice-samples/en-jenny.mp3), [Amy](voice-samples/en-amy.mp3), narrator [Arthur](voice-samples/en-arthur.mp3)
- Français : [Siwis](voice-samples/fr-siwis.mp3), [Jessica](voice-samples/fr-jessica.mp3), narrateur [Pierre](voice-samples/fr-pierre.mp3)
- Español: [Claude](voice-samples/es-claude.mp3), [Sharvard](voice-samples/es-sharvard.mp3), narrador [Marcos](voice-samples/es-marcos.mp3)
- Deutsch: [Kerstin](voice-samples/de-kerstin.mp3), Erzähler [Thorsten](voice-samples/de-thorsten.mp3)
- Italiano: [Paola](voice-samples/it-paola.mp3), [Serena](voice-samples/it-serena.mp3)

(Narrator samples read the documentary-style sentence.)

## Licences of the selected voices

All are usable in an app, including commercially. Check the model card of any voice you add.

| Voice | Dataset licence |
| --- | --- |
| Jenny (Dioco) | Custom: commercial use allowed; the voice must be credited as "Jenny (Dioco)" in apps ([dataset](https://github.com/dioco-group/jenny-tts-dataset)) |
| Amy | Mycroft mimic3 voices (repository licence CC BY-SA 4.0; see the [model card](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/amy/medium)) |
| Siwis | CC BY 4.0 |
| Jessica (upmc) | CC BY-SA 4.0 |
| Claude | Apache 2.0 |
| Sharvard | CC BY 3.0 |
| Kerstin | CC0 |
| Thorsten | CC0 |
| Paola | CC0 |
| Serena | CC BY 4.0 |
| Arthur (VCTK corpus, speaker p274) | CC BY 4.0 (CSTR, University of Edinburgh) |
| Pierre (upmc) | CC BY-SA 4.0 |
| Marcos (sharvard) | CC BY 3.0 |

Piper itself and the voice models' code are MIT licensed.

## The phone's own voices

You can also pick one of your phone's built-in voices (instant, no download). The app lists the calmest
first: Apple's *Premium/Enhanced* voices (Ava, Zoe, Samantha…), Microsoft's *Natural* voices (Ava, Emma,
Jenny, Denise…), Google's voices. It never auto-picks Apple's novelty voices (Zarvox, Bad News…) or the
robotic "Eloquence" ones. It also speaks slightly slower and lower for a calmer feel.

## Even more natural voices later

Cloud voices (ElevenLabs, OpenAI, Azure Neural) sound more human still, but they cost money per minute,
need an account and a server to keep the key secret, and need data while you travel. Piper is the best free,
private, offline option today. The app's voice layer (`js/narrator.js`) can add other backends later.
