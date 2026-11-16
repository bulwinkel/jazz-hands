<img src="assets/icon.svg" width="64" height="64" alt="">

# Jazz Hands

Jazz Hands is a dance game for one or two players. You play it with your hands, in front
of a webcam.

The music plays, and a cell of your grid fills on a beat. Put a hand in that cell when it is
full. [MediaPipe](https://github.com/google-ai-edge/mediapipe) finds your hands and your face
in the camera picture. It runs in the browser, so the camera picture stays on your computer.

Created in [T3 Code](https://t3.codes).

## Run it

You need:

- Node 22
- Google Chrome
- A webcam and speakers
- Room to step back, until the camera sees how far your arms reach

```
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome and allow the camera.

- The first `npm run dev` downloads the MediaPipe models from Google, about 34 MB. After
  that, the game needs no network connection.
- A large screen helps. Press F for full screen, or touch **Full screen** at the bottom left.
  The button shows only where the browser can make a page full screen.
- With no webcam, open `http://localhost:5173/?input=mouse`. The mouse is then one hand. Hold
  1, 2, 3 or 4 for a fist, an open hand, a point or a peace sign. With two players, the other
  player gets a copy of the hand half the screen away, in the same cell of their grid. On the
  results the copy stays open, so only the hand at the pointer chooses.

## Play

1. Choose a song, the number of players, a level for each player and the length of the round.
   Point at an item with an open hand ✋, then hold a fist ✊ on it to choose it. The mouse
   works too.
2. Choose **Let's dance**, then walk back to your spot. Two players stand side by side: each
   one gets one half of the screen.
3. Hold a hand in the Start cell ✋ to start the round. It is the top-right cell of your grid.
   With two players, both hold.
4. Dance. A block grows in a cell and fills it on the beat: have a hand in the cell then.

Does your grid not fit your reach? Before you start, hold a hand in the Calibrate cell 📏, the
top-left cell of your grid. See [Calibrate](#calibrate).

Each player has a level of their own, so a child and an adult can play one round together.

| Level | Name | What a player gets |
| --- | --- | --- |
| 1 | Slow | One cell at a time, with time between the cues |
| 2 | Every beat | A cue on every beat, and two cells at once on some bar starts |
| 3 | Two hands + slides | More cues for two hands, and slides: three cells in a line, one after another |
| 4 | Fast hands | Taps between the beats |
| 5 | All signs | Level 4 with a hand shape on every cue |

Each player also has two switches:

| Switch | What it adds |
| --- | --- |
| Hand shapes ✊ ✋ ☝️ ✌️ | Some cues ask for a hand shape. |
| Faces 😁 😲 😘 | The round asks for a smile, an open mouth or a kiss. See [Faces](#faces). |

| Key | Use |
| --- | --- |
| Space | Start the round. In a round: pause. On the results: play again. |
| Enter | Start the round, in the menu. |
| Esc | Go back to the menu. The **Menu** button at the bottom right does the same. |
| F | Full screen. |
| ← and → | Step through the songs, in the menu. |
| R | Start the round again. The **Restart** button beside **Pause** does the same. |
| C | Calibrate every player. The **Recalibrate** button of the results does the same. |
| M | Change the hand tracker. |
| D | Show the tracking numbers. |
| `[` and `]` | Camera delay, 10 ms less or more. |
| `,` and `.` | Picture offset, 10 ms less or more. |

## Share your videos

The game can record a round as a video. Turn on **Recording** in the top right corner of the
menu. Download the video from the results screen before you leave it: the game does not keep
it. See [Record a round](#record-a-round).

I would love to see your rounds. Share your videos with me:

- X: [@kelvinbulw](https://x.com/kelvinbulw)
- Instagram: [@wbv.dev](https://www.instagram.com/wbv.dev/)

## Work on the code

| Command | Use |
| --- | --- |
| `npm run dev` | The game with the dev server, on `http://localhost:5173`. |
| `npm test` | The unit tests. |
| `npm run typecheck` | The TypeScript check. |
| `npm run build` | A build in `dist/`. |
| `npm run preview` | Serve the build. |
| `npm run add-song -- "/path/to/Song Name.mp3"` | Add a song. See [Add a song](#add-a-song). |

| Folder | Content |
| --- | --- |
| `src/game` | The game: charts, judging, the menu, the results and the recording. |
| `src/tracking` | The MediaPipe trackers for hands, poses and faces. |
| `public/songs` | Each song's audio, cover picture and manifest. |
| `tools/songs` | The tool that analyses a song and writes its manifest. |
| `scripts` | The asset setup and the automated runs in headless Chrome. |

## Licence

The code is under the MIT licence. See [LICENSE](LICENSE).

The songs and their cover pictures in `public/songs/` are not under the MIT licence. I made
the songs with [Suno](https://suno.com) and the covers with an image model. You may play
them with the game, and copy and share them for non-commercial use. Keep the tags of the
audio files as they are. See [public/songs/README.md](public/songs/README.md).

The MediaPipe runtime and models come from Google, under their own licences.

## Reference

The sections below describe each part of the game in detail.

- [Calibrate](#calibrate)
- [How a cue shows](#how-a-cue-shows)
- [Slides](#slides)
- [Faces](#faces)
- [Cue sets](#cue-sets)
- [Rate the cue set](#rate-the-cue-set)
- [Moves](#moves)
- [Record a round](#record-a-round)
- [Tracking thread](#tracking-thread)
- [Add a song](#add-a-song)

## Calibrate

A calibration fits a player's grid to their reach. The player draws the biggest circles they
can with both arms, and the game grows the grid around their hands. A child then gets a
smaller, lower grid than an adult.

A calibration is optional. After **Let's dance**, the game goes straight to the ready screen.
Each player starts on the grid of their last calibration, or on the standard grid.

The ready screen shows two cells in each player's grid:

| Cell | Place | A hand held in it |
| --- | --- | --- |
| Start ✋ | Top right | Starts the round after 1 s. With two players, both hold. Space also starts. |
| Calibrate 📏 | Top left | Calibrates this player after 1.5 s. |

- The Calibrate cell is the second choice: its outline is thin and dashed, and its sign and
  word are fainter.
- A hand in the Start cell does not count for the Calibrate cell, and the reverse.
- A player who holds the Start cell does not calibrate. With both hands up, one in each cell,
  the player starts. A Calibrate hold ends when the same player's Start hold begins.
- A calibration from the Calibrate cell waits 1 s for the hand to leave the cell. Then the
  player draws circles for 6 s. Then the ready screen shows again.
- Only the player who held calibrates. The grid of the other player does not change. With two
  players, the screen names the player: "P1: draw the biggest circles you can with both arms!"
- When both players hold their Calibrate cells, the first hold that completes calibrates first.
  The hold of the other player goes on, and that player calibrates next. A hold that ends
  during a calibration, also by a gap in tracking, does not start again until the ready
  screen shows.
- The results show only the Start cell. A hand held in it for 1.5 s plays again.

The C key and the **Recalibrate** button of the results calibrate every player. After the C key
or a click, the players first have 8 s to walk back to their spots. After a fist on the button,
the calibration waits 1 s for that hand to leave the button.

The game keeps the grid of each player's last calibration in memory, for that player and that
number of players, until the page reloads. A new round from the menu starts on that grid.
**Play again** and **R** keep the grids of the round.

A calibration counts only when it sees at least 20 hand positions, and they span at least the
smallest grid: 0.18 of the frame wide and 0.3 high (`GRID.minWidth` and `GRID.minHeight`). A
player who stands still through a calibration then keeps their grid. When a calibration does
not count, nothing changes: the player gets back the grid they had before it, the kept grid
stays, and a note says "Grid not changed: draw bigger circles to calibrate". With two players
the note names the player. This holds for the calibration of one player and of every player.

The run report names:

| Field | What it holds |
| --- | --- |
| `players[].calibrated` | True when the player's grid came from a calibration, in this round or kept from an earlier round. False for the standard grid. |

## How a cue shows

A cue is a cell of a player's grid to touch on a beat. A block starts small in the middle of
the cell and grows. It fills the cell on the beat, and never leaves the cell. Two cues for
one cell nest: the larger block comes first.

The cue appears white and fades to the player's colour, which it reaches on the beat: the
full block has the player's colour.

A fist held on a menu item shows its progress with the same block, so the menu teaches how a
round reads.

## Slides

A slide is three taps in a line, at levels 3 to 5. Its cells fill one after another, one on
each of three cue beats in a row.

- The cells are the start cell, the middle cell and the end cell of a row, a column or a
  diagonal. The start cell and the end cell are two steps apart.
- Each cell shows as a tap: its block fills the cell on its own beat. No line or arrow joins
  the cells. The cell that is due next is bright, and the later cells are faint.
- Each cell is judged and scored as a tap of its own. A slide gives 3 cues and 3 results: a
  missed middle cell gives one Miss, and the start cell and the end cell keep their own results.
- A cell of a slide asks for no hand shape from the shapes switch. At level 5 each cell asks
  for the shape of its own beat.

### When a chart makes a slide

On a cue beat where the music is busy (intensity 0.5 or more, `CHART.busyIntensity`), one roll
starts a slide with the chance `slideChance` of the level, when a slide fits there.

| Level | `slideChance` |
| --- | --- |
| 1 and 2 | 0: no slides |
| 3 | 0.28 |
| 4 and 5 | 0.35 |

A slide fits on a cue beat only when all of these are true:

- The cell of the beat is not the centre cell. No line of three starts in the centre.
- The next two cue beats follow, one stride apart: one beat for each cell.
- The cue before it is not an off-beat tap.
- Its end cell comes before the first beat of the next planned move, and that beat stays free.

Nothing else comes inside a slide: no off-beat tap, and no other cue on its beats. The next cue
comes on the cue beat after the end cell at the earliest.

A round that starts inside the song never starts with the rest of a slide: a slide stays or goes
as a whole, by its start cell.

So a chart has a smaller share of slides than the chance. In a Short round, the typical mix of
a song (see [Cue sets](#cue-sets)) has a share of slides of 0.25 at level 3 and 0.19 at levels
4 and 5: the median over the 20 songs. At levels 4 and 5 a slide never follows an off-beat tap.

### How a tap is judged

A tap asks for a hand in its cell on its beat. A hand counts in a cell up to 12% of the cell
size beyond its edge (`GRID.cellMargin`). Each cell has two windows around its beat (`perfectMs`
and `goodMs` in `LEVELS`):

| Level | Perfect | Good |
| --- | --- | --- |
| 1 | 150 ms early to 200 ms late | 350 ms early to 450 ms late |
| 2 to 5 | 120 ms early to 160 ms late | 280 ms early to 350 ms late |

- A cell is Perfect when a tracking frame inside its Perfect window shows a hand in it. A hand
  that comes early and stays in the cell is correct play.
- A tap is Perfect as soon as all its cells are Perfect. Otherwise it ends when the Good window
  closes: Good when each cell had a hand in the Good window, else a Miss.
- A tap for two hands needs a hand in each of its two cells. A tap with a hand shape needs the
  shape too. When the tracker cannot read hand shapes, only the place of the hand counts.
- A Perfect scores 100 points and a Good 50, times a combo bonus from 1 to 2. A Miss scores 0
  and ends the combo.

## Faces

With the Faces switch on, the round asks a player for a smile 😁, an open mouth 😲 or a kiss 😘
on a bar start, every few bars. The sign shows over the player's face. A face cue is judged
and scored as a tap, with the face in place of the hand.

The game does not punish a player for what the camera cannot see.

- Before play, the face models look for the face of each player whose chart has face cues.
  They look while a player holds a Start cell, on the ready screen or the results, and during
  the countdown.
- When play begins, a player whose face the tracker has not found in 10 frames gets no face
  cues in this round (`FACES.sightingsToKeep`). One frame is not enough: it can be luck. A note
  says so: "Faces off: the camera cannot see your face". With two players, it names the player:
  "P1 faces off: the camera cannot see your face".
- Only frames that the camera took after the ready screen or the results opened count. The
  count starts again each time the ready screen opens, after a calibration too, and each time
  the results open.
- The Faces switch stays on. Each new round and each **Play again** looks again. **R** has no
  ready screen, so it keeps the choice of the round.
- In the round, a face cue with no hit is a Miss only when the camera saw the face in a frame
  inside the cue's window. With no such frame, the cue gives no result: no score, no change to
  the combo, no count in the total, and no flash.

The face models cost tracking speed, and a tablet gets slower as it gets warm. So they run
only when the game needs a face. In play, that is while a face cue is on screen. A round that
dropped a player's face cues runs no face model for that player in play. Before play, they run
only for a player whose chart has face cues, only while a Start hold is in progress or the
countdown runs, and only until the tracker has found that player's face in 10 frames.

The run report names:

| Field | What it holds |
| --- | --- |
| `players[].faceCues.asked` | The face cues that the round played. 0 when it dropped them before play. |
| `players[].faceCues.droppedBeforePlay` | True when the round dropped the player's face cues, because the tracker had not found the face in 10 frames before play. |
| `players[].faceCues.unseen` | The face cues that gave no result, because no frame in their window had the face. |
| `players[].faceCues.cues[].unseen` | True for a face cue that gave no result. Its `result` is then empty. |

## Cue sets

A song has 6 cue sets. Each set gives other cues for the same song, and the same cues on
every run. Both players play the same set.

The **🎲 Set** switch in the top right corner of the menu steps through `random`, 1, 2, …, 6,
and back to `random`. A new player starts with `random`. The game keeps the choice. A set that
an earlier version kept stays chosen, set 1 too: step the switch on to `random`.

- With `random`, each round that starts from the menu plays one of the 6 sets, each with the
  same chance. It never plays the set that the same song played last in this visit to the
  page, so two rounds of one song in a row differ. The game keeps the last set of each song
  in memory only: a new visit can start with any set.
- **Play again** (a raised hand or Space on the results) and **R** during a round keep the
  set of the round before, and repeat its cues.
- The results show the set that the round played (`🎲 Set 3`) in the top right corner, where
  the menu has the switch. Each player's card shows the moves of their chart
  (`3 points · 1 circle`), and no line for a chart with no moves. A recorded video shows both
  on its end card.

The sets differ by their share of moves (see [Moves](#moves)). Two sets for each share let
players compare two charts of each kind and rate which share they like (see
[Rate the cue set](#rate-the-cue-set)).

| Sets | Share of the phrases in busy music that hold a move |
| --- | --- |
| 1 and 2 | 0: no moves |
| 3 and 4 | 0.35 |
| 5 and 6 | 0.7 |

A set gives other cues at the same difficulty. Each set, set 1 too, tries 24 candidate
charts for the song, the levels and the length, and keeps the one that plays most like the
level usually does: closest to the typical mix. The mix is what makes a chart harder: its
shares of slides and two-hand cues, its off-beat taps, and its number of cues. The shares count
the cues that a roll of a cue beat chose in busy music: a slide counts once, by its start cell.
Off-beat taps and the number of cues count half each, because both say how busy a chart is.
The typical mix is the median over the 144 candidate charts of the six sets together, so
every set aims at the same mix.

The choice measures the charts without moves. A move takes the place of cues on the same cue
beats, and the rest of the chart is what makes it easy or hard. The round then plays the
chosen chart with the set's share of moves.

On the 20 songs, in a Short round at levels 3 and 4, the sets are a median of 0.6 points from
the typical shares of slides and two-hand cues, and at most 5.3 (the two-hand cues of set 4 of
Blessed on the Hillside at level 4). At level 4 the sets of one song differ by a median of 4.4
points in off-beat taps and 3.2% in their cues. A set does not match where the cues are, or
which hand shapes they ask for.

The typical mix is not the level rules: at levels 4 and 5 a slide never follows an off-beat
tap, so their charts have about half the share of slides that the rules say. See
[Slides](#slides).

`set=random` or `set=1` to `set=6` in the URL gives the choice of the switch. A `seed=` in
the URL replaces the set, for tests, and plays without moves: the results then show no set.
`moves=<0 to 1>` gives the share of moves, with a set or with `seed=`.

The run report names:

| Field | What it holds |
| --- | --- |
| `settings.seed` | The chart seed of the round. |
| `settings.cueSet` | The set that the round played. Null with a `seed=` from the URL. |
| `settings.cueSetRandom` | True when the game picked the set at random. |
| `settings.moveShare` | The share of moves of the round. |
| `players[].moves` | Each player's moves, counted by name. |
| `players[].cues[].slideStep` | The place of the cue in a slide: 1 for the start cell, 2 for the middle cell, 3 for the end cell. Other cues have no `slideStep`. |

## Rate the cue set

Each player can rate the set of the round on the results screen, with 1 to 5 stars. The
ratings show which sets the players like at each level.

- Each result card has a row under the moves: **Rate the moves** and 5 stars in the player's
  colour. The yellow stars at the top of the card are the score. The rating stars are larger,
  and an outline until the player chooses.
- Hold a fist on a star for 0.5 s, or click it. That star and every star below it light. A new
  choice replaces the one before.
- An open hand or the mouse pointer on a star shows, lighter, what choosing it would light.
- Each player's hands move a pointer of their own, on every screen that a hand can point at.
  Both players can rate at the same time, each on either card. Two fists on one item choose it
  once.
- A rating is optional. A card with no choice saves nothing.
- A round with a `seed=` in the URL has no set, and no rating row. A build with no dev server
  (`npm run build`) has no rating row either, because nothing can keep the rating there.
- The test bot never rates.

Each choice saves one record at once. The game posts it to the dev server route
`/__cue-set-ratings`, which adds it as one line to `test-results/cue-set-ratings.jsonl`. When
the save fails, the row shows **Not saved**.

| Field | What it holds |
| --- | --- |
| `savedAt` | When the game saved the record, as an ISO time. |
| `roundId` | The round. Both players and a changed rating have the same id. |
| `runReport` | The file name of the round's run report. Null when the rating came before the dev server saved the report. |
| `song`, `length`, `playerCount` | The song id, `short` or `full`, and 1 or 2. |
| `cueSet`, `seed`, `cueSetRandom`, `moveShare` | The set, its chart seed, true when the game picked the set, and its share of moves. |
| `player`, `level`, `shapes`, `faces` | The player (0 is the left player, or the only player), the level, and the switches. |
| `chart` | What the played part of the player's chart held: the shares of `slides` and `doubles`, the `offbeats` taps for each cue that the shares count, the number of `cues`, and the `moves` by name. A slide counts once in `slides` and three times in `cues`. Records from before 2026-11-16 also hold a share of fast slides, and `npm run ratings` reads them as before. See `chartMix` in `src/game/cueSet.ts`. |
| `result` | `score`, `accuracy` from 0 to 1, `perfect`, `good` and `miss`. |
| `rating` | 1 to 5. |

`npm run ratings` prints a summary of the file: the mean rating and the number of ratings by
level and set, by level and share of moves, and by song. It counts only the last record of
each round and player. Give another file as an argument:
`npm run ratings -- path/to/ratings.jsonl`.

## Moves

A move is a named pattern of cues from the dance floor. It takes the place of the random
cues for part of a phrase of 4 bars.

| Move | What a player does |
| --- | --- |
| Point | Bottom-left to top-right and back, twice, then bottom-right to top-left and back, twice. Half of the points start on the other diagonal. |
| Circle | Every outer cell in turn from a corner, clockwise or anticlockwise. |

Each move has two forms. Each step is a tap, and takes one cue interval.

| Form | Point | Circle | Cue intervals |
| --- | --- | --- | --- |
| Taps | 8 taps on the two diagonals | 8 taps on the outer cells | 8 |
| Short taps | 4 taps: up each diagonal once | 4 taps on the corners | 4 |

- A move starts on the first beat of a phrase where the music is busy, and ends inside the
  phrase.
- A level gets the form that its pace has room for. With room for 8 intervals it gets the
  taps. With room for 4 intervals it gets the short taps. With less room it gets no move.
- The phrases, the moves, the diagonals, the corners and the directions do not depend on the
  level. Two players on different levels dance the same move in the same phrase, each at the
  pace of their own level.
- A phrase never gets the same move as the phrase before it.
- Inside a move there are no off-beat taps, no slides and no shapes from the shapes switch.
  Level 5 keeps its shape on every cue.
- The cues before a move keep its first beat free: no slide runs into it, and no off-beat tap
  comes just before it.
- A move ends early when the music gets calmer inside its phrase, or when the last bar of the
  round comes: the cues get further apart, and the rest of the steps does not fit.
- A round that starts inside the song starts no move before its first cue.

At levels 1 and 2 a move keeps the number of cues, and at level 3 it changes it by at most
1.2%. At levels 4 and 5 a move has fewer cues than the chart it replaces: it has no off-beat
taps. On the 20 songs, sets 5 and 6 (a share of 0.7) give a Short round at level 4 a median of
11% fewer cues than the same chart with no moves, and at most 27% fewer (set 5 of Peace, Be
Still).

Add a move in `src/game/moves.ts`: a name, and a function that gives the cells of each form.
The tuning values are `MOVES` in `src/game/config.ts`.

## Record a round

Turn on **Recording** in the top right corner of the menu. Each round then gives two videos:

| Video | Content |
| --- | --- |
| Game view | The camera picture with the grids, the cues and the score, as on screen, at 720p. It ends with a result card. |
| Camera only | The camera picture alone, not mirrored, at the camera's own size. |

Both carry the song. A video runs from the countdown to 4 seconds after the results show.
With large offsets it runs longer, until the end of the song has reached it.
A pause is left out. A round that stops part-way (restart, calibrate, menu) gives no video.
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
screen. Space pauses and Esc closes. Beside the preview are the download links of both videos.

The recording sits beside the buttons, so a recorded round shows the results as large as a
round with no recording. On a window of aspect 13:10 or narrower, which limits the results by
its width, it goes under the buttons.

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
the camera is Chrome's test picture, which shows no hands. Chrome makes no sound and uses no
sound device of the machine: the game's clock then runs also while the machine's sound output
is busy or stuck. A recorded round still gets its sound track. The game picks a cue set at random
for each round, so a check that needs the same chart on every run names one: `set=1`, or a
`seed=`.

```
npx vite --port 5192 --strictPort
node scripts/smoke.mjs "http://localhost:5192/?input=camera&autostart=1&players=2&start=75&set=1" \
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
| `--faces` | Turn on face cues, so that the face models run too. A run whose tracker finds a face in fewer than 10 frames before play drops its face cues, and runs no face model in play. |
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
| A Feast for All | `--beats tools/songs/given-beats/a-feast-for-all.json` | The tool now finds these beats by itself with window anchors. The kick is clear only from 160 s to the end of the 212.8 s song. Those 3 blocks span 52.8 s, less than the 50% needed to test a constant tempo. The tempo rises smoothly from 122.9 to 125.4 BPM. The given beats came from the tool's own `fit_windows` and `join_windows` on the percussive and full envelopes, about 124 BPM. That fit held a clear beat in all 101 windows. Its anchors lie 5.9 ms RMS from the smooth curve. |
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
| Constant grid | At least 2 blocks have a clear kick. The span from the first clear block's start to the last clear block's end covers at least 50% of the song. The kick stays within 15 ms of its usual place on one grid in every clear block. |
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
starts. They check how far each weight and threshold can move before a song comes out wrong.
The margin tests move one weight or threshold at a time.

The song-start weight may rise from 0.5 to 1.95.
At 2, All Aboard, Hey-Ho, Jonah, Joseph's Coat of Many Colors and Nebuchadnezzar's Dream choose the
wrong bar start. Hey-Ho, Jonah also chooses wrong when the level-rises weight reaches 2 or the chord
weight falls to 1.

Two chord thresholds sit close to an edge. The chord ratio of 1.25 against the next beat may move
only from 1.17 to 1.35 (Todo Bueno and Nebuchadnezzar's Dream).
The half-bar ratio of 1.1 must stay below 1.17 (Hey-Ho, Jonah).
Jericho Fell chooses the wrong half bar when the one-beat-early weight falls to 0.2 or the
level-rises decisive ratio falls to 1.12.
On 15 songs, the drum clue changes no choice. It only makes Job, Hold On certain.

The tests also vary all four weights together. When they leave one song out, all the weight sets
that choose the other 14 right also choose that song right, except for Hey-Ho, Jonah. It chooses
right in 1120 of the 1722 weight sets that choose the other 14 right.

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
