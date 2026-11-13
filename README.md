<img src="assets/icon.svg" width="64" height="64" alt="">

# mediapipe-dance-game

Created in [T3 Code](https://t3.codes).

## How a cue shows

A cue is a cell of a player's grid to touch on a beat. A block starts small in the middle of
the cell and grows. It fills the cell on the beat, and never leaves the cell. Two cues for
one cell nest: the larger block comes first.

The cue fades from the player's colour to yellow, and is full yellow on the beat.

A fist held on a menu item shows its progress with the same block, so the menu teaches how a
round reads.

## Cue sets

A song has 5 cue sets. Each set gives other cues for the same song, and the same cues on
every run, so **Play again** repeats them. Step through the sets with the **🎲 Set** switch
in the top right corner of the menu. Both players play the same set. The game keeps the
choice.

A set gives other cues at the same difficulty. Set 1 is the chart the game always had. Sets
2 to 5 each try 24 candidate charts for the song, the levels and the length, and keep the one
that plays most like the level usually does: closest to the typical mix. The mix is what
makes a chart harder: its shares of slides, two-hand cues and fast slides, its off-beat taps,
and its number of cues. Off-beat taps and the number of cues count half each, because both
say how busy a chart is. The typical mix is the median over the 96 candidate charts of the
four sets together, so every set aims at the same mix.

On the 15 songs, sets 2 to 5 are a median of 1 point from the typical shares of slides and
two-hand cues, and at most about 5. At level 4 the sets of one song differ by a median of 3
fast slides, 4 off-beat taps and 2% of their cues. A set does not match where the cues are,
which hand shapes they ask for, or how the slides split between normal and slow.

The typical mix is not the level rules: at levels 4 and 5 a slide never follows an off-beat
tap, so their charts have about a third fewer slides than the rules say. Set 1 was picked
against the rules, so at level 4 it often has more slides than the other sets.

A `seed=` in the URL replaces the set, for tests. The run report names the seed and the set.

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
video is being finished, with a full bar that pulses. Under that, it asks the players to stay
on the screen to keep the video: Play again, also by a raised hand, throws it away.

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

## Tracking thread

By default the hand and face trackers run on the main thread, as they always did. With
`thread=worker` in the URL they run in the tracking workers instead, and the game draws at the
display's rate while MediaPipe works. The default is `DEFAULT_TRACKING_THREAD` in
`src/game/config.ts`. The tracking workers gave the same hands as the main thread on a test
video. They become the default when a recording of real players has shown the same (see
`scripts/compare-threads.mjs` below).

Each tracker has a tracking worker of its own: Chrome keeps at most 4 active WebGL contexts in a
worker, and split hands with face models need 4.

- The page hands each camera frame to the worker of the tracker in use as a `VideoFrame`. One
  frame is out at a time. A frame that comes meanwhile waits, and a newer one takes its place;
  the newest goes as soon as the worker answers.
- A frame keeps the page time at which it came, so judging corrects for its age as before.
  While a frame is out, judging keeps the timing windows open for it.
- When a tracker's worker cannot be made, or the tracker does not load in it, that tracker
  loads on the main thread. This holds for every tracker: the menu's, and each one that a
  round or the M key loads later.
- A worker that takes more than 30 s to load or more than 5 s for a frame is ended
  (`WORKER_LIMITS` in `src/tracking/config.ts`). A load then falls back to the main thread. A
  frame stops tracking with the game's error message, as any tracker failure does.

| URL parameter | Use |
| --- | --- |
| `thread=main` | The default. Track on the main thread. |
| `thread=worker` | Track in the tracking workers. |
| `framelog=1` | Keep every tracking frame in `window.__dance.frameLog`, for scripts. |

The run report says which thread ran (`tracking.thread`), and how many frames per second the
game drew during play (`tracking.drawnPerSec`) next to the tracking rate.

### Smoke runs with a camera file

`scripts/smoke.mjs` runs the game in headless Chrome against a dev server or a preview build.
`--camera-file=<path>` plays a `.y4m` or `.mjpeg` file as the camera, in a loop. Without it
the camera is Chrome's test picture, which shows no hands.

```
npx vite --port 5192 --strictPort
node scripts/smoke.mjs "http://localhost:5192/?input=camera&autostart=1&players=2&start=75" \
  --press=ready --camera-file=/path/to/recording.mjpeg
```

### Compare the two threads

`scripts/compare-threads.mjs` plays one recording through the game twice, with `thread=main`
and with `thread=worker`. It matches the camera frames that both runs tracked, and prints how
far their hands differ: hand count, palm position, hand size and shape.

It compares the runs only when each one ran on the thread it asked for, both ran on the same
delegate (GPU or CPU), neither reached the game's error phase, and neither had an error on the
page or in a worker. Otherwise it says why, and exits 1.

```
node scripts/compare-threads.mjs --camera-file=/path/to/recording.mov
```

| Option | Use |
| --- | --- |
| `--camera-file=<path>` | The recording. A `.y4m` or `.mjpeg` file plays as it is; any other video goes through `ffmpeg` into a 30 fps `.mjpeg` first. |
| `--url=<url>` | The game. The default is `http://localhost:5192/`. |
| `--players=1` | One player. The default is 2. |
| `--tracker=<mode>` | `hands-full`, `hands-split` or `pose`. The default is the game's choice for the players. |
| `--faces` | Turn on face cues, so that the face models run too. |
| `--seconds=<n>` | How long each run records. The default is 45. |
| `--fps=<n>` | The rate Chrome plays the file at. The default comes from a `.y4m` header, else 30. |
| `--threads=main,main` | Compare two runs on the main thread: how far two runs differ with no thread change. Main against worker should differ no more. The default is `main,worker`. |

It saves both frame logs and the result to `test-results/compare-threads-<time>.json`. The
last line of the result checks the frame matching: with moving hands, the palm distance is
least at shift 0.

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

Seven songs did not come out right from the tool alone. These command options make their manifests again.
The tool now finds the bar start of the last four by itself, from the chords and the drums (see
[How the tool finds the bar start](#how-the-tool-finds-the-bar-start)). The table keeps them as a record.

| Song | Command options | Why |
| --- | --- | --- |
| Job, Hold On | `--half-beat shift` | The kick is syncopated (beat 1 and the "and" of 2), so it sits on the beats and between them alike, and the tool could not tell which pulses are the beats. The snare on beats 2 and 4 shows them. After the shift, every section has a clear kick on the beat and the music starts on the first beat. |
| The Wilderness Knows | `--beats tools/songs/given-beats/the-wilderness-knows.json` | The opening is loose and the kick is soft. The tool's own grid lost the beat in the first 30 s. The given beats come from a comb on the eighth-note pulse (about 186 per minute), fitted in 10 s windows from the clearest window outward. |
| A Feast for All | `--beats tools/songs/given-beats/a-feast-for-all.json` | The kick is clear only from 160 s to the end, and 3 clear blocks pass the constant-tempo test, so the tool chose one grid at 125.1 BPM. The tempo rises smoothly from 122.9 to 125.4 BPM, so the early beats were off. The given beats come from the tool's own window anchors (`fit_windows` and `join_windows` on the percussive and full envelopes, about 124 BPM): all 101 windows hold a clear beat, 5.9 ms RMS from the smooth curve. |
| All Aboard | `--first-downbeat 2` | The tool chose beat 3 with low confidence, from the level rises alone. The chords and the bass change on beat 2, and with bars from beat 2 the kick falls on beats 1 and 3 and the snare on 2 and 4. |
| Nebuchadnezzar's Dream | `--first-downbeat 1` | The tool chose beat 0 with low confidence, because the music starts there. The chords and the bass change on beat 1, and with bars from beat 1 the kick falls on beat 1 and on the "and" of 3, as in the other songs of this style. |
| Hey-Ho, Jonah | `--first-downbeat 2` | The tool chose beat 1 with low confidence, from three level rises alone. The kick and the clap are equally strong on every beat, so they do not show the bar. The chords and the bass change most on beat 2 and least on beat 1. |
| Joseph's Coat of Many Colors | `--first-downbeat 1` | The tool chose beat 0 with low confidence, because the music starts there. The chords and the bass change on beat 1, and with bars from beat 1 the kick falls on beats 1 and 3 and the snare on 2 and 4. |

Signs in the report that a song needs this:

- The kick readings of the beat grid jump by about half a beat from one 20 s block to the next.
- The tool warns that the kick hits and the chord changes do not agree on which pulses are the beats.
- The tool warns of no clear beat in a part of the song where you hear one.
- The tool gives its bar-start choice "Confidence: low": the chords and the drums disagree, or the clues
  do not tell two beats apart. Listen for the high click in the check clips: it must be on the "one".
- The tool gives its bar-start choice "Confidence: medium" and warns that it is not certain, or that the
  music does not tell two beats half a bar apart. Listen for the high click in the check clips too.

### Read the report

| Section | What to look for |
| --- | --- |
| Decode | The Chrome decode offset. The first two songs give 0 ms (MP3) and -6.5 ms (Opus in M4A). |
| Tempo | One peak that is clearly higher than the rest. |
| Beat grid | The method, and why. See the table below. |
| Beats, or the pulses between them | Kick hits and chord changes must be stronger on the beats. If not, the tool moves the beats by half a beat. |
| Kick alignment | Each 30 s section reads about +5 ms. A section with no clear kick is less certain. |
| Music | Where the sound starts and ends, and where the beat stops being clear. |
| Bars | `firstDownbeat`, the four clues for it with their numbers, the weight for each beat, and the confidence. See [How the tool finds the bar start](#how-the-tool-finds-the-bar-start). |
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

### How the tool finds the bar start

The tool reads four clues for the beat that starts the bars (`firstDownbeat`), counted from the
first beat of the music. The report prints each clue with its numbers.

| Clue | What it reads | What it points to | Weight |
| --- | --- | --- | --- |
| Chord changes | How much the chords and the bass change on each beat of the bar. | The beat with the most change, when that change is at least 1.25 times the change on each beat next to it. Many songs change chords at the half bar too, so the beat half a bar away can change almost as much. When the best beat changes less than 1.1 times as much as that beat, the chords point to both: a tie. | 2 |
| Drums | The share of the kick (30 to 150 Hz) and of the snare or clap (1.5 to 6 kHz) on each beat of the bar. | Two beats half a bar apart. The kick falls on beats 1 and 3 and the snare on 2 and 4, so the drums tell those two pairs apart, but often not beat 1 from beat 3. The kick must hit one pair at least 1.25 times as hard as the other pair, and the snare must hit the other pair at least 1.25 times as hard as the kick's pair. A kick on every beat, no clear backbeat, or no clear drums, decides nothing. | 2 |
| Level rises | The largest rises in level. They are section starts. | The beat that fits at least 1.5 times as many rises as the next best. A pickup or a fill can move a rise by one beat. | 1 |
| Song start | Nothing in the music. Many songs start on a bar start. | Beat 0. A song that opens with a pickup breaks this. | 0.5 |

The chords and the drums read every bar of the song, so they weigh most. The song start is weak
evidence: on its own it never beats a clear chord clue.

Each clue that decides adds its weight to the beats it points to. The beat with the most weight
starts the bars. On a tie, the earlier beat wins. So the drums narrow the choice to two beats, the
chords pick one of them, and the song start decides only what the music leaves open. When the chords
tie at the half bar, they narrow the choice to two beats as the drums do, and the level rises or the
song start pick one. The report then names the tie.

| Confidence | When |
| --- | --- |
| High | The clues for the choice weigh 3 or more, only the song start is against it, and a clue other than the song start tells it from the beat half a bar away. |
| Medium | The level rises are against the choice, or the clues for it weigh less than 3, or only the song start tells it from the beat half a bar away. |
| Low | The chords or the drums are against the choice, or another beat has as much weight. |

The unit tests keep the clue numbers of the 15 songs in `public/songs` with their verified bar
starts, and check how far each weight and threshold can move before a song comes out wrong. The
weights need only their order: song start, then level rises, then chords. Two thresholds sit close to
an edge. The chords' 1.25 against the next beat may move only from 1.17 to 1.35 (Todo Bueno and
Nebuchadnezzar's Dream), and the half-bar ratio of 1.1 must stay below 1.17 (Hey-Ho, Jonah). On 15
songs, the drum clue changes no choice: it only makes Job, Hold On certain.

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
