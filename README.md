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
| `--out-dir DIR` | Write the manifest and the audio copy to `DIR`, for a trial run. |
| `--compare MANIFEST.json` | Print how the new beat times differ from an existing manifest. |
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

### Read the report

| Section | What to look for |
| --- | --- |
| Decode | The Chrome decode offset. The first two songs give 0 ms (MP3) and -6.5 ms (Opus in M4A). |
| Tempo | One peak that is clearly higher than the rest. |
| Beat grid | The method: one constant grid, or tracked beats when the tempo drifts. |
| Kick alignment | Each 30 s section reads about +5 ms. A section with no clear kick is less certain. |
| Music | Where the sound starts and ends, and the final hit. |
| Bars | `firstDownbeat`, the clues for it, and the confidence. |
| Beats | The beat count, where the list stops, and the tempo at the start, middle and end. |
| Intensity per bar | Quiet parts are low and loud parts are high. The game sets its pace from this. |
| Warnings | Every warning again, in one place. |

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
