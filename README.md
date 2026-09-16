# BigBangTheoryQuiz

## Quiz settings

The standalone quiz has 1000 hard questions and 10 regulation questions per team
(1-6 teams). Each team answers its ten questions consecutively before the next
team starts. Difficulty labels are omitted from the interface because
there is only one level. The 10-second answer timer is enabled by default and
can be disabled. During the last three seconds, a pulsing timer, highlighted
answer area, and a reminder signal urgency; these stop when the question ends.
Reduced-motion preferences disable the pulse. Questions do not repeat until the bank is exhausted.

Teams tied for the most correct answers enter a five-attempt penalty series,
regardless of response time. Teams alternate one question at a time, and every
contender completes all five attempts, with no early eliminations. If the best
scores are still tied, only those leaders enter sudden death. Each remaining
team gets one question per round. After all attempts, incorrect teams are
eliminated if any team answered correctly; if everyone misses or everyone
answers correctly, another round follows.
The game ends with a single winner. A football-penalty-style panel shows hits,
misses, five initial pending slots and eliminated teams. Timeouts are misses. Overtime
keeps the chosen timer setting and uses unused questions first, recycling the
bank with an explicit notice only when it runs out.
Run the question bank and settings tests with `npx vitest run questions.test.js`.

The 780 added questions cover all twelve seasons and include `episode` and
`source` metadata in `questions.js` for fact-checking. Questions and explanations
are written in Russian, with four answer choices and one correct answer.
Existing question text is preserved so saved answer history remains valid.

The website has top-level Game, Rules and Features tabs. Features includes
four interface screenshots that open at full size. Switching tabs preserves
the current game and does not pause its timer; an active countdown warning
appears outside the Game tab. Arrow keys, Home and End navigate the tabs.

## Local teams and ratings

The quiz saves team names, cumulative ratings, and answered question identifiers
in this site's `localStorage` under `bazinga.quiz.v1`. Team names are matched
case-insensitively after trimming whitespace. Renaming a team creates a separate
rating entry; previously used names are suggested in the name fields.

Only completed games affect ratings: each correct answer adds 1 point, a sole
winner gets 5 bonus points. Overtime answers count towards points, accuracy and
timing; each team's actual number of attempts is saved. Legacy draw bonuses
remain intact. Equal cumulative rating points are resolved by lower average
response time, rounded to the nearest millisecond; speed adds no extra points
and never determines the winner of a game.
Solo games award only answer points. The leaderboard includes games, wins,
correct answers, accuracy and average response time. Draws remain in saved data
for point accounting but are not displayed as a separate column. A prominent banner above the game shows
the leading team and points (all leaders when tied), without expanding the
leaderboard. The banner and reset buttons are hidden when there are no ratings.
Completion is recorded on the decisive round's last answer, not on opening
the results screen. An unresolved or abandoned overtime does not affect ratings.

Every new answer is timed from question display to submission, including wrong
answers and untimed-mode answers. Time spent viewing feedback is excluded.
Timeouts count as the full 10-second limit even if a background tab delays the
timer callback. Stored timing totals and measured-answer counts determine the
average across completed games. Existing saved points and question history
are migrated without changes; legacy games have no fabricated timing data.
Entries without measurements display a dash and follow measured entries when
points are equal.

Answered questions (including incorrect answers and timeouts) are remembered
immediately, even when a game is abandoned. Unanswered questions are preferred
in subsequent games; previously answered ones fill any remaining slots.
The current game itself is not restored after reload.

Data stays in this browser and origin, without server sync or account security.
Clearing browser data removes it. The leaderboard has a confirmed ratings-only
reset that preserves current teams and question history, and a separate full
reset. Both are unavailable during a game. Storage errors display a warning
rather than preventing play.
Run persistence tests with `npx vitest run storage.test.js questions.test.js`.

## Quiz background music

The standalone quiz (`index.html` at the repository root) includes original,
locally synthesized background music: quiet ambient chords in the menu and on
the results screen, and a more dramatic minor-key pulse during play. No audio
downloads or external music services are required.

Music starts after the first click or key press, subject to browser audio
permissions. The header button switches music off/on for the current page.
Tracks fade between screens, and playback pauses while the tab is hidden.
Run the focused music tests with `npx vitest run music.test.js`.

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.1.8.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
