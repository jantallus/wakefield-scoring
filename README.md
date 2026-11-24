# Wakefield

**A paragliding race scoring idea: one clock per pilot, slowed down when the pilot flies on their own initiative and running at real time when they use other pilots.**

*[Version française](README.fr.md)*

## The idea

In today's race-to-goal scoring, leading points come from the area under each pilot's distance/time curve. That rewards being in front, not flying without help. A pilot who always stays just behind the lead gaggle, never makes a mistake and keeps following the right leader can end up with more leading points than a pilot who takes initiatives, goes ahead, sometimes falls back and catches up.

Wakefield replaces leading points and time points with a single clock:

- Other pilots create a **field** around them, like gravity: the more useful pilots you can see ahead of you, the stronger the field.
- Your clock runs at **real time** when you are in a gaggle or in someone's wake, and **slows down** when you make progress on the course without help.
- The **final ranking is a time**, so spectators can follow a live leaderboard that reorders as the clocks speed up and slow down.

Being low and in front is rewarded (courage), being high and in front too (thermal efficiency): what counts is not using the others.

## Two portraits

**The one who wins: the opener.** They pick their own line instead of waiting for someone else's. They find many of their thermals themselves and leave them before the gaggle. In a glide, nobody ahead shows them where it goes up. Low and in front (courage) or high and in front (thermal efficiency), their clock runs slow for long stretches. They can cross ESS in the pack, a few seconds behind others, and still win.

**The one who loses time without noticing: the follower.** They fly well, make no mistake and stay with the lead group. But they never open: they climb in thermals others have marked and glide when the group glides. Their clock runs at real time from start to ESS. With today's leading points they score almost as much as the leaders; with Wakefield they drop back.

**On a real task** (PWC Gemona 2026, task 3, a gaggle race):

| | The opener (winner) | A follower |
| --- | --- | --- |
| Arrival at ESS | 15th | 18 s later, 25th |
| Time among the race's first 10 | 77 min | 2 min |
| Share of the flight without help | 46 % | 0 % |
| Thermals climbed with nobody marking them | 43 % | 0 % |
| Time credit | 10.2 min | 2.2 min |
| Wakefield rank | **1st** | 37th |

The credit is bounded (here at most 17.7 min): an autonomous but slow pilot cannot overtake a fast one. Wakefield does not reward being alone, it rewards initiative that makes progress.

## How it is computed

For pilot *i* at time *t*, the field sums every other pilot *j*, at their current position and over their recent track:

```
Φᵢ(t) = Σⱼ ∫ K(r) · A(θ) · M(v_z) · e^(−δ/T) dδ      (plus, where j was climbing, a full-weight marker while that thermal is still occupied)
g     = 1 − e^(−Φ / Φ₀)               (0 = alone, 1 = fully helped)
dτ/dt = 1 − ε · (1 − g) · max(0, v_prog) / v_ref
```

| Term | Meaning | Current value |
| --- | --- | --- |
| K(r) | Reach: a cone ahead of the pilot (3 km long, 0.6 km wide right behind a pilot, widening by 0.22 km per km); almost nothing behind | 3 km |
| A(θ) | Viewing angle: 1 towards the horizon, 0 at the vertical (a gaggle right above you does not help you) | cos θ above, cos² θ below |
| M(v_z) | Track points where the pilot was climbing weigh more (a marked thermal) | 1 vs 0.35 |
| T_m | Memory of the wake | 4 min |
| Thermal cycle | A point where a pilot was climbing keeps marking the thermal, at full weight, for as long as the thermal is occupied: it stays alive while someone climbs within 0.4 km of it, and its cycle ends once nobody has for 60 s (at most 1 h). It then fades out with a short tail (time constant 3 min), since pilots arriving just after still know roughly where the gaggle climbed | 60 s, 0.4 km, 3 min |
| Φ₀ | How much help counts as "helped" | 8 |
| ε | Price of risk: the most time a fully led task can earn (ε × distance / v_ref) | 0.15 |
| v_ref | Reference speed: median speed of pilots at ESS | per task |

The clock is computed only from present and past positions, so it can run live from live tracking. During the task the leaderboard shows a projected time: `τ(t) + remaining distance / v_ref`, which becomes the final corrected time at ESS.

**Pilots who land before ESS** are always ranked behind every pilot at ESS. They get a corrected distance, `distance + ε × km flown autonomously`, capped at the task distance (ties: the longer real distance wins), converted to an estimated time: `time until task deadline + (task distance − corrected distance) / v_ref`.

Cylinders are validated on the WGS84 ellipsoid with the 0.5 % radius tolerance (FAI category 2). Progress along the course uses a flat projection.

## First results: PWC Gemona 2026, tasks 2 and 3

Compared with the official PWCA results (GAP scoring):

| | Task 2 | Task 3 (gaggle race) |
| --- | --- | --- |
| Pilots at ESS compared | 49 | 104 |
| Winner, official / Wakefield | Lambert / Lambert | Puthod / Puthod |
| Rank correlation, official vs Wakefield | 0.97 | 0.96 |
| Time in the race's top 10 vs GAP leading points | 0.65 | 0.41 |
| Time in the race's top 10 vs Wakefield credit | 0.86 | 0.80 |

The final rankings stay very close to the official ones, but the Wakefield credit follows the time really spent at the front much better than GAP leading points, especially in a gaggle race. "Time in the top 10" is an imperfect judge, close to the model's logic, so the advantage is probably somewhat flattering.

Open the replays in a browser: [`replays/task2/index.html`](replays/task2/index.html), [`replays/task3/index.html`](replays/task3/index.html) (serve the folder, for example `python3 -m http.server`, since the page loads `replay.json`).

## Run it

```sh
pip install -r requirements.txt
./run_all.sh            # both tasks; results in out/
```

Or step by step, for one task (`T2` or `T3`):

```sh
cd wakefield
TASKID=T3 python3 parse.py           # read IGC tracks, validate turnpoints, progress along the optimised route
TASKID=T3 python3 field.py 0.15 8    # field, clocks and corrected ranking (ε, Φ₀)
TASKID=T3 python3 export.py          # replay data (needs Φ₀ = 0.8, 3, 8 and 20 for the sensitivity table)
TASKID=T3 python3 front.py           # time spent in the race's top 5 / top 10
python3 compare.py                   # comparison with the official results (both tasks)
```

The task definitions are in `wakefield/parse.py` (`TASKS`). Distances use a flat projection, about 0.2 to 0.5 % shorter than the official ellipsoid distances.

## The application

[`app/`](app/) is a browser application: load the task (XCTrack QR code or `.xctsk`), the IGC tracks (zip) and, optionally, the official results, then tune every parameter with sliders and watch the animated replay, the live leaderboard and the final ranking. Everything runs locally, in a Web Worker: no track leaves the computer. A field takes about 5 to 10 seconds for a task of 120 pilots; ε, the thermal-discovery bonus and the landed pilots' time base recompute instantly.

Online: **https://jantallus.github.io/wakefield-scoring/app/** (once GitHub Pages is on). Locally: `python3 -m http.server` at the repository root, then open `http://localhost:8000/app/`. The "example" button loads Gemona 2026 tasks 2 or 3 from `data/`.

`app/core.js` holds the whole computation and also runs in Node: `node app/test/node_test.js data/gemona-2026/tasks/task3.xctsk.txt <folder of .igc files> data/gemona-2026/official/task3.csv`. It is the **reference implementation**. The Python pipeline in `wakefield/` is kept for analysis, and a GitHub Actions check (`tests/run_consistency.sh`) runs both on Gemona 2026 tasks 2 and 3 at every push: it fails if the pilots at ESS differ, a corrected time differs by more than 15 s, or a landed pilot's corrected distance by more than 0.3 km.

Third-party code in `app/vendor/`: [JSZip](https://stuk.github.io/jszip/) (MIT) and [jsQR](https://github.com/cozmo/jsQR) (Apache 2.0).

## Data

`data/gemona-2026/` holds the public tracks and results of the PWC Gemona 2026 tasks 2 and 3, from the [PWCA scoring pages](https://scoring.pwca.org/gemona-2026/task2.html). See [data/README.md](data/README.md), including how a pilot can ask for their track to be removed.

## Contributing

Ideas, criticism and code are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
