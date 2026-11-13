<img src="assets/icon.svg" width="64" height="64" alt="">

# mediapipe-dance-game

Created in [T3 Code](https://t3.codes).

## Cue styles

A cue shows when its beat comes in one of two styles. Step through them with the **V** key,
in the menu or in a round, or with the **Cues** switch in the top right corner of the menu.
The game keeps the choice.

| Style | How a cue shows its beat |
| --- | --- |
| Shrink | An outline starts at 2.2 times the cell and shrinks onto its border. It meets the border on the beat. |
| Grow | A block starts small in the middle of the cell and grows. It fills the cell on the beat, and never leaves the cell. |

In both styles the cue fades from the player's colour to yellow, and is full yellow on the beat.
In the grow style, two cues for one cell nest: the larger block comes first.

A fist held on a menu item shows its progress with the mark of the chosen style, so the
menu teaches how a round reads.

## Cue sets

A song has 5 cue sets. Each set gives other cues for the same song, and the same cues on
every run, so **Play again** repeats them. Step through the sets with the **🎲 Set** switch
in the top right corner of the menu. Both players play the same set. The game keeps the
choice.

Set 1 is the chart the game always had. Sets 2 to 5 each try 24 candidate charts for the
song, the levels and the length, and keep the one whose shares of slides and two-hand cues
come closest to the level rules. A `seed=` in the URL replaces the set, for tests. The run
report names the seed and the set.

## Record a round

Turn on **Recording** in the top right corner of the menu. Each round then gives two videos:

| Video | Content |
| --- | --- |
| Game view | The camera picture with the grids, the cues and the score, as on screen, at 720p. It ends with a result card. |
| Camera only | The camera picture alone, not mirrored, at the camera's own size. |

Both carry the song. A video runs from the countdown to 4 seconds after the results show.
With large offsets it runs longer, until the end of the song has reached it.
A pause is left out. A round that stops part-way (restart, recalibrate, menu) gives no video.
The game delays the sound of each video to fit its picture, but it cannot make the sound earlier.
When the picture offset and the camera delay, with the speakers' delay, add up to less than
zero, that video's sound is late by that amount.

While the videos are made, the results screen shows a box in place of the preview. It says
that the recording still runs, with a bar that fills over its last seconds, and then that the
video is being finished, with a full bar that pulses.

When the videos are ready, the results screen shows the round as a small silent preview.
A click on it, or a fist held on it, plays the round with its sound in a player that fills
the window. The player has buttons to switch between the game view and the camera view, to
play the video on show again from its start (**↺ Restart**, also after it has ended), to
download it, and to close. A real click also switches the browser to full
screen. Space pauses and Esc closes. Under the preview are the download links of both videos.

The game keeps no history of recordings. It holds only the videos of the round whose results
are on screen, in memory. When the results close, for any reason (Play again, Menu,
Recalibrate, an error, a reload), the videos are deleted: download them before you leave
the results. A recording that is still in its last seconds, or still being finished, when
the results close is thrown away.

The files are MP4 (H.264 and AAC). The run report of a recorded round has
`settings.recording: true`, to compare its tracking speed with other rounds.

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

Six songs did not come out right from the tool alone. These command options make their manifests again.

| Song | Command options | Why |
| --- | --- | --- |
| Job, Hold On | `--half-beat shift` | The kick is syncopated (beat 1 and the "and" of 2), so it sits on the beats and between them alike, and the tool could not tell which pulses are the beats. The snare on beats 2 and 4 shows them. After the shift, every section has a clear kick on the beat and the music starts on the first beat. |
| The Wilderness Knows | `--beats tools/songs/given-beats/the-wilderness-knows.json` | The opening is loose and the kick is soft. The tool's own grid lost the beat in the first 30 s. The given beats come from a comb on the eighth-note pulse (about 186 per minute), fitted in 10 s windows from the clearest window outward. |

| All Aboard | `--first-downbeat 2` | The tool chose beat 3 with low confidence, from the level rises alone. The chords and the bass change on beat 2, and with bars from beat 2 the kick falls on beats 1 and 3 and the snare on 2 and 4. |
| Nebuchadnezzar's Dream | `--first-downbeat 1` | The tool chose beat 0 with low confidence, because the music starts there. The chords and the bass change on beat 1, and with bars from beat 1 the kick falls on beat 1 and on the "and" of 3, as in the other songs of this style. |
| Hey-Ho, Jonah | `--first-downbeat 2` | The tool chose beat 1 with low confidence, from three level rises alone. The kick and the clap are equally strong on every beat, so they do not show the bar. The chords and the bass change most on beat 2 and least on beat 1. |
| Joseph's Coat of Many Colors | `--first-downbeat 1` | The tool chose beat 0 with low confidence, because the music starts there. The chords and the bass change on beat 1, and with bars from beat 1 the kick falls on beats 1 and 3 and the snare on 2 and 4. |

Signs in the report that a song needs this:

- The kick readings of the beat grid jump by about half a beat from one 20 s block to the next.
- The tool warns that the kick hits and the chord changes do not agree on which pulses are the beats.
- The tool warns of no clear beat in a part of the song where you hear one.
- The tool warns that the bar-start evidence disagrees, and gives its choice "Confidence: low". Listen for the high click in the check clips: it must be on the "one".

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
