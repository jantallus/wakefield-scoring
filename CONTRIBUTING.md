# Contributing to Wakefield

Wakefield is an open experiment. Pilots, organisers, scorers and developers are all welcome. Issues can be written in English or French.

## Ways to help

- **Discuss the concept.** Open an issue with the `concept` label: a case where the model ranks pilots unfairly, a better shape for the field, a new term (for example a thermal-discovery bonus).
- **Bring a task.** Public IGC tracks and the official results of another task are the best way to test the model. Open an issue with a link to the source.
- **Write code.** Fork the repository, work on a branch, and open a pull request. Keep a change focused on one thing, and say in the pull request what it changes in the results of the Gemona tasks.

## Changing the model

`app/core.js` is the reference implementation. Change it first, then make the same change in the Python pipeline (`wakefield/`): the check `tests/run_consistency.sh`, run by GitHub Actions on every push and pull request, fails if the two disagree.

A change to the field, the clock or the ranking of landed pilots should come with:

1. the reasoning, in plain words;
2. its effect on tasks 2 and 3 of Gemona 2026 (`./run_all.sh`, then `python3 wakefield/compare.py`);
3. any new parameter, with its default value, added to the table in the README.

## Data

Only add tracks that are already public, and cite their source. Never add a track that a pilot has asked to remove. See [data/README.md](data/README.md).
