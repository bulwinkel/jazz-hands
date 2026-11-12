<img src="assets/icon.svg" width="64" height="64" alt="">

# mediapipe-dance-game

Created in [T3 Code](https://t3.codes).

## Add a song

`tools/songs/add_song.py` analyses one audio file and writes its manifest for the game.
It prints the evidence for every decision, so you can judge the result without a second run.

### Set up once

The tool needs Python 3.13, `ffmpeg`, Node 22 and Google Chrome.

```
npm run setup-songs
```

This makes the Python environment in `tools/songs/.venv` from `tools/songs/requirements.txt`.

### Run it

```
npm run add-song -- "/path/to/Song Name.mp3"
```

| Option | Use |
| --- | --- |
| `--title "Song Name"` | The title. The default is the file name without its extension. |
| `--id song-name` | The id and file name. The default is the title in lower case with hyphens. |
| `--first-downbeat N` | The index of the first bar start. Overrules the tool. |
| `--half-beat shift` | Move the beats by half a beat, onto the pulses between them. Overrules the tool. |
| `--half-beat keep` | Keep the beats where the beat grid put them. Overrules the tool. |
| `--beats BEATS.json` | Use these beat times in place of the tool's own beat grid: a JSON list of seconds in the audio file. The tool still moves them onto the kick, all together. |
| `--pacing rank` | The default. The quietest 12% of the bars play slow, the next 18% medium, the rest full. |
| `--pacing level` | The pace follows the level of each bar alone. A song with a wide dynamic range then plays slow for long. |
| `--short-start auto` | The default. The Short round starts at the best 90 s, if they beat the first 90 s by 0.1. |
| `--short-start none` | The Short round starts with the song. Use it when the build-up is worth playing. |
| `--short-start 60` | The Short round starts at the bar start nearest to 60 s. |
| `--out-dir DIR` | Write the manifest and the audio copy to `DIR`, for a trial run. |
| `--compare MANIFEST.json` | Print how the new manifest differs from an existing one: beats, bar starts, Short round and pace. |
| `--keep-work` | Keep the intermediate files. The tool prints where they are. |

### What it writes

| File | Content |
| --- | --- |
| `public/songs/<id>.<extension>` | The audio, copied unchanged. |
| `public/songs/<id>.json` | The manifest. |
| `test-results/<id>-beat-check-early.mp3` | A check clip from the first part with a clear kick drum. |
| `test-results/<id>-beat-check-late.mp3` | A check clip from the end of the music. |

The last line of the report is the line to add to `SONGS` in `src/game/config.ts`:

```ts
{ manifest: '/songs/song-name.json', title: 'Song Name' },
```

Then run `npm test`. It checks every song in `SONGS`.

The menu shows the songs as a carousel of covers, in the order of `SONGS`, and plays the
liveliest 20 seconds of the chosen song. The game finds that part from the manifest.

### Give a song a cover picture

A song with no picture shows its title on a plain cover. To give it a picture:

1. Save a square image in `public/songs/`, for example `public/songs/song-name.jpg`.
   The menu shows it at 180 pixels wide, so 512 pixels wide is enough.
2. Add its path to the song's line in `SONGS`:

```ts
{ manifest: '/songs/song-name.json', title: 'Song Name', cover: '/songs/song-name.jpg' },
```

### Songs that needed a correction by hand

Two songs did not come out right from the tool alone. These commands make their manifests again.

| Song | Command options | Why |
| --- | --- | --- |
| Job, Hold On | `--half-beat shift` | The kick is syncopated (beat 1 and the "and" of 2), so it sits on the beats and between them alike, and the tool could not tell which pulses are the beats. The snare on beats 2 and 4 shows them. After the shift, every section has a clear kick on the beat and the music starts on the first beat. |
| The Wilderness Knows | `--beats tools/songs/given-beats/the-wilderness-knows.json` | The opening is loose and the kick is soft. The tool's own grid lost the beat in the first 30 s. The given beats come from a comb on the eighth-note pulse (about 186 per minute), fitted in 10 s windows from the clearest window outward. |

Signs in the report that a song needs this:

- The kick readings of the beat grid jump by about half a beat from one 20 s block to the next.
- The tool warns that the kick hits and the chord changes do not agree on which pulses are the beats.
- The tool warns of no clear beat in a part of the song where you hear one.

### Read the report

| Section | What to look for |
| --- | --- |
| Decode | The Chrome decode offset. The first two songs give 0 ms (MP3) and -6.5 ms (Opus in M4A). |
| Tempo | One peak that is clearly higher than the rest. |
| Beat grid | The method, and why. See the table below. |
| Beats, or the pulses between them | Kick hits and chord changes must be stronger on the beats. If not, the tool moves the beats by half a beat. |
| Kick alignment | Each 30 s section reads about +5 ms. A section with no clear kick is less certain. |
| Music | Where the sound starts and ends, and where the beat stops being clear. |
| Bars | `firstDownbeat`, the clues for it, and the confidence. |
| Beats | The beat count, where the list stops and why, and the tempo at the start, middle and end. |
| Intensity per bar | The pace of each bar, and the share of slow, medium and full bars. |
| Short round | The mean intensity of the first 90 s and of the best 90 s, and `shortStartSec`. |
| Warnings | Every warning again, in one place. |

The tool picks one of three methods for the beat grid:

| Method | When |
| --- | --- |
| Constant grid | The kick stays within 15 ms of one grid for the whole song. |
| Window anchors | The tempo drifts. Tempo and phase are fitted in 12 s windows and joined. This follows soft percussion. |
| Tracked beats | The tempo drifts and the kick is clear in most of the song. Used only when the tracked beats stay near the anchors and follow the kick more closely. |

Three cases to know:

- A fast song with a half-time feel is written at half its tempo, for example 90 BPM for 180.
  The game puts a cue on every second beat of a fast song anyway.
- When the song ends with a long part that has no clear beat, the beat list stops on the last
  bar start before it. The report warns. `durationSec` stays the full length, so the round
  ends with music and no cues.
- A beat before the start of the audio is dropped. `firstDownbeat` counts from the beats that remain.

The tool exits with code 1 and one error line when it cannot make a manifest it trusts.
It then writes no manifest.

### Listen to the check clips

```
open test-results/song-name-beat-check-early.mp3
open test-results/song-name-beat-check-late.mp3
```

Each clip is 25 s of the song at reduced level, with a click on every beat.
The click on a bar start is one octave higher.

- The clicks must sit on the beat for the whole clip.
- The high click must sit on the first beat of each bar.
  If it does not, run the tool again with `--first-downbeat N`.
- In the late clip, the last click is the last beat of the list.
