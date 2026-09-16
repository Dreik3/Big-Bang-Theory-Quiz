import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const script = readFileSync(new URL("./storage.js", import.meta.url), "utf8");
const key = "bazinga.quiz.v1";
const defaults = () => ({ teamNames: ["Команда 1", "Команда 2"], answeredQuestions: [], ratings: [] });
const validRating = () => ({
  key: "шельдон", name: "Шельдон", games: 2, wins: 1, draws: 1, correct: 12, answered: 20, points: 19,
  responseTimeMs: 0, timedAnswers: 0,
});

describe("quiz storage", () => {
  let dom;
  let QuizStorage;
  let storage;
  let onError;
  let browserStorage;

  beforeEach(() => {
    dom = new JSDOM("", { url: "https://quiz.test", runScripts: "outside-only" });
    dom.window.eval(`${script}\nwindow.TestQuizStorage = QuizStorage;`);
    QuizStorage = dom.window.TestQuizStorage;
    browserStorage = dom.window.localStorage;
    onError = vi.fn();
    storage = new QuizStorage(onError);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    dom.window.close();
  });

  it("starts with defaults without writing to localStorage", () => {
    expect(storage.state).toEqual(defaults());
    expect(browserStorage.getItem(key)).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("saves editable drafts, including blank names and six teams", () => {
    const names = ["", " ", "Шельдон", "a".repeat(24), "Пенни", "Радж"];
    storage.saveTeamNames(names);
    names[2] = "changed";
    expect(new QuizStorage(onError).state.teamNames).toEqual(["", " ", "Шельдон", "a".repeat(24), "Пенни", "Радж"]);
    storage.saveTeamNames([""]);
    expect(new QuizStorage(onError).state.teamNames).toEqual([""]);
  });

  it("reloads all saved state and deduplicates question text", () => {
    storage.saveTeamNames(["Физики", "Инженеры"]);
    storage.recordAnswer("Как зовут соседа?");
    storage.recordAnswer("Как зовут соседа?");
    storage.recordAnswer("Где работает Шельдон?");
    storage.recordGame([{ name: "Физики", score: 8 }, { name: "Инженеры", score: 6 }], 10);
    const reloaded = new QuizStorage(onError);
    expect(reloaded.state).toEqual(storage.state);
    expect(reloaded.state.answeredQuestions).toEqual(["Как зовут соседа?", "Где работает Шельдон?"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("migrates legacy ratings without losing names, results, or question history", () => {
    const { responseTimeMs, timedAnswers, ...legacyRating } = validRating();
    const legacy = { teamNames: ["Шельдон", ""], answeredQuestions: ["Q"], ratings: [legacyRating] };
    browserStorage.setItem(key, JSON.stringify(legacy));
    storage = new QuizStorage(onError);
    expect(storage.state).toEqual({ ...legacy, ratings: [validRating()] });
    expect(QuizStorage.isValidState(legacy)).toBe(false);
    expect(QuizStorage.isValidState(storage.state)).toBe(true);
    storage.recordGame([{ name: "Шельдон", score: 1, responseTimeMs: 200, timedAnswers: 2 }], 2);
    expect(new QuizStorage(onError).state).toEqual(storage.state);
    expect(storage.state.ratings[0]).toEqual({
      ...validRating(), games: 3, correct: 13, answered: 22, points: 20, responseTimeMs: 200, timedAnswers: 2,
    });
    expect(storage.state.teamNames).toEqual(legacy.teamNames);
    expect(storage.state.answeredQuestions).toEqual(["Q"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("calculates rounded averages and ranks measured times before missing data", () => {
    const { averageResponseTime, compareResponseTimes } = dom.window;
    expect(averageResponseTime({})).toBeNull();
    expect(averageResponseTime({ responseTimeMs: 0, timedAnswers: 0 })).toBeNull();
    expect(averageResponseTime({ responseTimeMs: 301, timedAnswers: 2 })).toBe(151);
    expect(averageResponseTime({ responseTimeMs: 0, timedAnswers: 2 })).toBe(0);
    const measured = { responseTimeMs: 100, timedAnswers: 2 };
    expect(compareResponseTimes(measured, {})).toBeLessThan(0);
    expect(compareResponseTimes({}, measured)).toBeGreaterThan(0);
    expect(compareResponseTimes({}, { responseTimeMs: 0, timedAnswers: 0 })).toBe(0);
    expect(compareResponseTimes(measured, { responseTimeMs: 150, timedAnswers: 3 })).toBe(0);
    expect(compareResponseTimes(measured, { responseTimeMs: 101, timedAnswers: 2 })).toBeLessThan(0);
  });

  it("rejects malformed legacy ratings instead of silently normalizing them", () => {
    const { responseTimeMs, timedAnswers, ...legacyRating } = validRating();
    const raw = JSON.stringify({ ...defaults(), ratings: [{ ...legacyRating, points: 999 }] });
    browserStorage.setItem(key, raw);
    expect(new QuizStorage(onError).state).toEqual(defaults());
    expect(onError).toHaveBeenCalledOnce();
    expect(browserStorage.getItem(key)).toBe(raw);
  });

  it("accumulates measured sums and counts without counting legacy untimed answers", () => {
    storage.recordGame([{ name: "А", score: 2, responseTimeMs: 600, timedAnswers: 3 }], 3);
    storage.recordGame([{ name: "а", score: 1 }], 4);
    storage.recordGame([{ name: "А", score: 2, responseTimeMs: 1200, timedAnswers: 2 }], 2);
    expect(storage.state.ratings[0]).toEqual({
      key: "а", name: "А", games: 3, wins: 0, draws: 0, correct: 5, answered: 9, points: 5,
      responseTimeMs: 1800, timedAnswers: 5,
    });
    expect(dom.window.averageResponseTime(storage.state.ratings[0])).toBe(360);
    expect(new QuizStorage(onError).state).toEqual(storage.state);
  });

  it("does not use speed to determine game winners", () => {
    storage.recordGame([
      { name: "Slow", score: 2, responseTimeMs: 600, timedAnswers: 3 },
      { name: "Fast", score: 2, responseTimeMs: 300, timedAnswers: 3 },
    ], 3);
    expect(storage.state.ratings.map(({ wins, draws, points }) => ({ wins, draws, points }))).toEqual([
      { wins: 0, draws: 1, points: 4 }, { wins: 0, draws: 1, points: 4 },
    ]);
  });

  it("preserves legacy draws for equal score leaders regardless of time", () => {
    storage.recordGame([
      { name: "А", score: 2, responseTimeMs: 300, timedAnswers: 3 },
      { name: "Б", score: 2, responseTimeMs: 301, timedAnswers: 3 },
      { name: "В", score: 2, responseTimeMs: 600, timedAnswers: 3 },
    ], 3);
    expect(storage.state.ratings.map(({ wins, draws, points }) => ({ wins, draws, points }))).toEqual([
      { wins: 0, draws: 1, points: 4 }, { wins: 0, draws: 1, points: 4 }, { wins: 0, draws: 1, points: 4 },
    ]);
  });

  it("ranks score ahead of speed", () => {
    storage.recordGame([
      { name: "Slow", score: 3, responseTimeMs: 600, timedAnswers: 3 },
      { name: "Fast", score: 2, responseTimeMs: 0, timedAnswers: 3 },
    ], 3);
    expect(storage.state.ratings.map(({ wins, points }) => ({ wins, points }))).toEqual([
      { wins: 1, points: 8 }, { wins: 0, points: 2 },
    ]);
  });

  it("does not prefer measured teams when recording equal legacy game scores", () => {
    storage.recordGame([
      { name: "Legacy", score: 2 },
      { name: "Measured", score: 2, responseTimeMs: 600, timedAnswers: 3 },
    ], 3);
    expect(storage.state.ratings.map(({ wins, points }) => ({ wins, points }))).toEqual([
      { wins: 0, points: 4 }, { wins: 0, points: 4 },
    ]);
  });

  it("never awards a solo bonus even for zero-millisecond measured answers", () => {
    storage.recordGame([{ name: "Solo", score: 3, responseTimeMs: 0, timedAnswers: 3 }], 3);
    expect(storage.state.ratings[0]).toMatchObject({
      wins: 0, draws: 0, points: 3, responseTimeMs: 0, timedAnswers: 3,
    });
    expect(new QuizStorage(onError).state).toEqual(storage.state);
    expect(onError).not.toHaveBeenCalled();
  });

  it("persists each team's actual attempts including overtime and scores above ten", () => {
    storage.recordGame([
      { name: "A", score: 12, answered: 13, timedAnswers: 13, responseTimeMs: 13000 },
      { name: "B", score: 11, answered: 13, timedAnswers: 13, responseTimeMs: 6500 },
      { name: "C", score: 10, answered: 11, timedAnswers: 11, responseTimeMs: 22000 },
      { name: "D", score: 5, answered: 10, timedAnswers: 10, responseTimeMs: 20000 },
    ], 10);
    const ratings = new QuizStorage(onError).state.ratings;
    expect(ratings.map((team) => team.answered)).toEqual([13, 13, 11, 10]);
    expect(ratings.map((team) => team.points)).toEqual([17, 11, 10, 5]);
    expect(ratings.map((team) => team.wins)).toEqual([1, 0, 0, 0]);
    expect(ratings.map((team) => team.timedAnswers)).toEqual([13, 13, 11, 10]);
  });

  it("awards a win and five bonus points only to the sole winner", () => {
    storage.recordGame([{ name: "Шельдон", score: 8 }, { name: "Пенни", score: 3 }], 10);
    expect(storage.state.ratings).toEqual([
      { key: "шельдон", name: "Шельдон", games: 1, wins: 1, draws: 0, correct: 8, answered: 10, points: 13, responseTimeMs: 0, timedAnswers: 0 },
      { key: "пенни", name: "Пенни", games: 1, wins: 0, draws: 0, correct: 3, answered: 10, points: 3, responseTimeMs: 0, timedAnswers: 0 },
    ]);
  });

  it("awards draws and two bonus points only to tied leaders", () => {
    storage.recordGame([{ name: "А", score: 5 }, { name: "Б", score: 5 }, { name: "В", score: 2 }], 10);
    expect(storage.state.ratings.map(({ wins, draws, points }) => ({ wins, draws, points }))).toEqual([
      { wins: 0, draws: 1, points: 7 }, { wins: 0, draws: 1, points: 7 }, { wins: 0, draws: 0, points: 2 },
    ]);
  });

  it("counts an all-zero multiplayer tie but never a solo win or draw", () => {
    storage.recordGame([{ name: "А", score: 0 }, { name: "Б", score: 0 }], 10);
    expect(storage.state.ratings.every((rating) => rating.draws === 1 && rating.points === 2)).toBe(true);
    storage.recordGame([{ name: "Соло", score: 10 }], 10);
    expect(storage.state.ratings[2]).toEqual({
      key: "соло", name: "Соло", games: 1, wins: 0, draws: 0, correct: 10, answered: 10, points: 10,
      responseTimeMs: 0, timedAnswers: 0,
    });
  });

  it("merges Russian names case-insensitively across games and updates display spelling", () => {
    expect(dom.window.normalizeTeamName("  ЁЖИК ")).toBe("ёжик");
    storage.recordGame([{ name: " Шельдон ", score: 8 }, { name: "Пенни", score: 3 }], 10);
    storage.recordGame([{ name: "ШЕЛЬДОН", score: 4 }, { name: "пенни", score: 4 }], 10);
    expect(storage.state.ratings).toHaveLength(2);
    expect(storage.state.ratings[0]).toEqual({ ...validRating(), name: "ШЕЛЬДОН" });
  });

  it("returns snapshots that cannot mutate saved state", () => {
    storage.recordGame([{ name: "А", score: 2 }], 10);
    const snapshot = storage.state;
    snapshot.teamNames.push("extra");
    snapshot.answeredQuestions.push("extra");
    snapshot.ratings[0].points = 100;
    expect(storage.state.teamNames).toEqual(defaults().teamNames);
    expect(storage.state.answeredQuestions).toEqual([]);
    expect(storage.state.ratings[0].points).toBe(2);
  });

  it.each(["{", "", "null", "[]", "false"])("reports malformed data %j without overwriting it", (raw) => {
    browserStorage.setItem(key, raw);
    expect(new QuizStorage(onError).state).toEqual(defaults());
    expect(onError).toHaveBeenCalledOnce();
    expect(browserStorage.getItem(key)).toBe(raw);
  });

  it.each([
    ["missing field", (state) => { delete state.ratings; }],
    ["extra field", (state) => { state.extra = true; }],
    ["nonarray names", (state) => { state.teamNames = "А"; }],
    ["empty names", (state) => { state.teamNames = []; }],
    ["too many names", (state) => { state.teamNames = Array(7).fill("А"); }],
    ["long name", (state) => { state.teamNames = ["А".repeat(25)]; }],
    ["nonstring name", (state) => { state.teamNames = [1]; }],
    ["nonarray questions", (state) => { state.answeredQuestions = {}; }],
    ["blank question", (state) => { state.answeredQuestions = [" "]; }],
    ["nonstring question", (state) => { state.answeredQuestions = [null]; }],
    ["duplicate question", (state) => { state.answeredQuestions = ["Q", "Q"]; }],
    ["nonarray ratings", (state) => { state.ratings = {}; }],
    ["null rating", (state) => { state.ratings = [null]; }],
    ["missing rating field", (state) => { delete state.ratings[0].correct; }],
    ["wrong normalized key", (state) => { state.ratings[0].key = "Шельдон"; }],
    ["blank rating name", (state) => { state.ratings[0].name = ""; }],
    ["duplicate rating key", (state) => { state.ratings.push({ ...state.ratings[0], name: "ШЕЛЬДОН" }); }],
    ["negative count", (state) => { state.ratings[0].games = -1; }],
    ["fractional count", (state) => { state.ratings[0].games = 2.5; }],
    ["unsafe count", (state) => { state.ratings[0].games = 1e100; }],
    ["infinite count", (state) => { state.ratings[0].games = Infinity; }],
    ["numeric string", (state) => { state.ratings[0].games = "2"; }],
    ["too many correct", (state) => { state.ratings[0].answered = 1; }],
    ["too many results", (state) => { state.ratings[0].games = 1; }],
    ["wrong points", (state) => { state.ratings[0].points = 12; }],
    ["missing response time", (state) => { delete state.ratings[0].responseTimeMs; }],
    ["missing timed count", (state) => { delete state.ratings[0].timedAnswers; }],
    ["extra rating field", (state) => { state.ratings[0].extra = 1; }],
    ["too many timed answers", (state) => { state.ratings[0].timedAnswers = 21; }],
    ["time without timed answers", (state) => { state.ratings[0].responseTimeMs = 1; }],
    ...["responseTimeMs", "timedAnswers"].flatMap((field) =>
      [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, "1", null].map((value) =>
        [`invalid ${field}: ${value}`, (state) => { state.ratings[0][field] = value; }])),
  ])("rejects invalid schema: %s", (_label, mutate) => {
    const state = { ...defaults(), ratings: [validRating()] };
    mutate(state);
    const raw = JSON.stringify(state);
    browserStorage.setItem(key, raw);
    storage = new QuizStorage(onError);
    expect(storage.state).toEqual(defaults());
    expect(onError).toHaveBeenCalledOnce();
    expect(browserStorage.getItem(key)).toBe(raw);
    storage.saveTeamNames(["Новая"]);
    expect(new QuizStorage(onError).state.teamNames).toEqual(["Новая"]);
  });

  it("reports denied access to localStorage and continues in memory", () => {
    const error = new dom.window.DOMException("Denied", "SecurityError");
    vi.spyOn(dom.window, "localStorage", "get").mockImplementation(() => { throw error; });
    storage = new QuizStorage(onError);
    storage.saveTeamNames(["А"]);
    storage.recordAnswer("Вопрос?");
    storage.recordGame([{ name: "А", score: 3 }], 10);
    expect(storage.state.teamNames).toEqual(["А"]);
    expect(storage.state.answeredQuestions).toEqual(["Вопрос?"]);
    expect(storage.state.ratings[0].correct).toBe(3);
    expect(onError).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenLastCalledWith(error);
  });

  it("reports read failures", () => {
    const error = new Error("getItem failed");
    vi.spyOn(dom.window.Storage.prototype, "getItem").mockImplementation(() => { throw error; });
    expect(new QuizStorage(onError).state).toEqual(defaults());
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("reports quota errors while preserving in-memory progress", () => {
    const error = new dom.window.DOMException("Full", "QuotaExceededError");
    vi.spyOn(dom.window.Storage.prototype, "setItem").mockImplementation(() => { throw error; });
    storage.saveTeamNames(["А"]);
    storage.recordAnswer("Q");
    storage.recordGame([{ name: "А", score: 4 }], 10);
    expect(storage.state.teamNames).toEqual(["А"]);
    expect(storage.state.answeredQuestions).toEqual(["Q"]);
    expect(storage.state.ratings[0].points).toBe(4);
    expect(onError).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenLastCalledWith(error);
  });

  it("resets all data and removes only the quiz key", () => {
    browserStorage.setItem("other-app", "keep");
    storage.saveTeamNames(["А"]);
    storage.recordAnswer("Q");
    storage.recordGame([{ name: "А", score: 4, responseTimeMs: 500, timedAnswers: 10 }], 10);
    storage.reset();
    expect(storage.state).toEqual(defaults());
    expect(browserStorage.getItem(key)).toBeNull();
    expect(browserStorage.getItem("other-app")).toBe("keep");
    expect(new QuizStorage(onError).state).toEqual(defaults());
  });

  it("clears only ratings and preserves team drafts and answered questions after reload", () => {
    storage.saveTeamNames(["Quantum", "Bazinga"]);
    storage.recordAnswer("Q");
    storage.recordGame([
      { name: "Quantum", score: 8, responseTimeMs: 500, timedAnswers: 10 },
      { name: "Bazinga", score: 4, responseTimeMs: 400, timedAnswers: 10 },
    ], 10);
    storage.resetRatings();
    expect(new QuizStorage(onError).state).toEqual({
      teamNames: ["Quantum", "Bazinga"], answeredQuestions: ["Q"], ratings: [],
    });
    storage.recordGame([{ name: "Quantum", score: 3 }], 10);
    expect(storage.state.ratings[0]).toMatchObject({ games: 1, points: 3, wins: 0, responseTimeMs: 0, timedAnswers: 0 });
  });

  it("reports a failed ratings reset write without deleting teams or question history", () => {
    storage.recordAnswer("Q");
    storage.recordGame([{ name: "A", score: 4 }], 10);
    const error = new Error("setItem denied");
    vi.spyOn(dom.window.Storage.prototype, "setItem").mockImplementation(() => { throw error; });
    storage.resetRatings();
    expect(storage.state.ratings).toEqual([]);
    expect(storage.state.answeredQuestions).toEqual(["Q"]);
    expect(onError).toHaveBeenCalledWith(error);
    expect(new QuizStorage(onError).state.ratings[0].points).toBe(4);
  });

  it("resets memory even if removing the key fails and reports the failure", () => {
    storage.recordAnswer("Q");
    const error = new Error("removeItem denied");
    vi.spyOn(dom.window.Storage.prototype, "removeItem").mockImplementation(() => { throw error; });
    storage.reset();
    expect(storage.state).toEqual(defaults());
    expect(onError).toHaveBeenCalledWith(error);
    expect(JSON.parse(browserStorage.getItem(key)).answeredQuestions).toEqual(["Q"]);
  });

  it.each([[], Array(7).fill("А"), ["А".repeat(25)], [null], Array(2), "А"].map((names) => [names]))("rejects invalid draft names %j", (names) => {
    expect(() => storage.saveTeamNames(names)).toThrow("Expected one to six team names");
    expect(storage.state).toEqual(defaults());
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(["", " ", null, 2])("rejects invalid question text %j", (text) => {
    expect(() => storage.recordAnswer(text)).toThrow("Expected a nonempty question text");
    expect(storage.state).toEqual(defaults());
  });

  it("rejects integer overflow without partially updating results", () => {
    storage.recordGame([{ name: "А", score: 0 }], Number.MAX_SAFE_INTEGER);
    const previous = storage.state;
    expect(() => storage.recordGame([{ name: "А", score: 0 }], 1)).toThrow("integer range");
    expect(storage.state).toEqual(previous);
    expect(new QuizStorage(onError).state).toEqual(previous);
  });

  it("rejects response time overflow without partially updating results", () => {
    storage.recordGame([{ name: "А", score: 0, responseTimeMs: Number.MAX_SAFE_INTEGER, timedAnswers: 1 }], 1);
    const previous = storage.state;
    expect(() => storage.recordGame([
      { name: "А", score: 0, responseTimeMs: 1, timedAnswers: 1 },
    ], 1)).toThrow("integer range");
    expect(storage.state).toEqual(previous);
    expect(new QuizStorage(onError).state).toEqual(previous);
  });

  it("does not mask programmer errors thrown by the error callback", () => {
    const error = new Error("Callback failed");
    browserStorage.setItem(key, "{");
    expect(() => new QuizStorage(() => { throw error; })).toThrow(error);
  });

  it.each([
    [[], 10],
    [Array(2), 10],
    [[{ name: "А", score: 11 }], 10],
    [[{ name: "А", score: -1 }], 10],
    [[{ name: "А", score: 1.5 }], 10],
    [[{ name: "А", score: NaN }], 10],
    [[{ name: " ", score: 1 }], 10],
    [[{ name: "А", score: 1 }, { name: " а ", score: 2 }], 10],
    [[{ name: "А", score: 1 }], 0],
    [[{ name: "А", score: 1 }], Infinity],
    ...[undefined, null, -1, 9, 10.5, Infinity, "11"].map((answered) =>
      [[{ name: "A", score: 1, answered }], 10]),
    [[{ name: "A", score: 12, answered: 11 }], 10],
    [[{ name: "A", score: 11, answered: 12, responseTimeMs: 1200, timedAnswers: 11 }], 10],
    [[{ name: "А", score: 1, responseTimeMs: 100 }], 10],
    [[{ name: "А", score: 1, timedAnswers: 10 }], 10],
    [[{ name: "А", score: 1, responseTimeMs: undefined, timedAnswers: undefined }], 10],
    [[{ name: "А", score: 1, responseTimeMs: 100, timedAnswers: 9 }], 10],
    [[{ name: "А", score: 1, responseTimeMs: 100, timedAnswers: 11 }], 10],
    [[{ name: "А", score: 1, responseTimeMs: 0, timedAnswers: 0 }], 10],
    ...["responseTimeMs", "timedAnswers"].flatMap((field) =>
      [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, "10", null].map((value) =>
        [[{ name: "А", score: 1, responseTimeMs: 100, timedAnswers: 10, [field]: value }], 10])),
  ])("rejects invalid game arguments without partial updates (%j, %j)", (teams, rounds) => {
    expect(() => storage.recordGame(teams, rounds)).toThrow("Expected unique named teams");
    expect(storage.state).toEqual(defaults());
    expect(browserStorage.getItem(key)).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });
});
