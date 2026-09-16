import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const bankScript = `${read("questions.js")}\n${read("backgrounds.js")}`;
const { QUESTIONS, BACKGROUND_BY_TOPIC } = runInNewContext(
  `${bankScript}\n({ QUESTIONS, BACKGROUND_BY_TOPIC });`,
);

describe("question bank", () => {
  it("includes exactly 500 hard questions", () => {
    expect(QUESTIONS).toHaveLength(500);
    expect(QUESTIONS.every((question) => question.difficulty === "hard")).toBe(true);
  });

  it("has unique questions, four distinct answers, and valid background topics", () => {
    const normalize = (text) => text.normalize("NFKC").toLocaleLowerCase("ru-RU")
      .replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    expect(new Set(QUESTIONS.map((question) => normalize(question.question))).size).toBe(QUESTIONS.length);
    for (const question of QUESTIONS) {
      expect(question.difficulty).toBe("hard");
      expect(question.question.trim().length).toBeGreaterThan(0);
      expect(question.category.trim().length).toBeGreaterThan(0);
      expect(question.explanation.trim().length).toBeGreaterThan(0);
      expect(question.answers).toHaveLength(4);
      expect(new Set(question.answers.map(normalize)).size).toBe(4);
      expect(question.answers.every((answer) => answer.trim().length > 0)).toBe(true);
      expect(Number.isInteger(question.correct)).toBe(true);
      expect(question.correct).toBeGreaterThanOrEqual(0);
      expect(question.correct).toBeLessThan(4);
      expect(BACKGROUND_BY_TOPIC[question.illustration]).toBeDefined();
    }
  });
});

describe("quiz settings and persistence", () => {
  let dom;
  let document;
  let submit;

  function boot(saved) {
    dom = new JSDOM(read("index.html"), {
      url: "https://quiz.test", runScripts: "outside-only", pretendToBeVisual: true,
    });
    document = dom.window.document;
    dom.window.scrollTo = vi.fn();
    dom.window.confirm = vi.fn(() => true);
    if (saved) dom.window.localStorage.setItem("bazinga.quiz.v1", saved);
    dom.window.eval(`${bankScript}\n${read("music.js")}\n${read("storage.js")}\n${read("app.js")}
      window.getGame = () => game;
      window.getQuizStorage = () => quizStorage;`);
    submit = () => document.getElementById("setup-form")
      .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  }

  function finishGame(durations = [1000], correctAnswer = () => true) {
    const clock = vi.spyOn(dom.window.performance, "now");
    const count = dom.window.getGame().questions.length;
    for (let index = 0; index < count; index += 1) {
      clock.mockReturnValue(dom.window.getGame().questionStartedAt + durations[index % durations.length]);
      document.querySelector(`.answer[data-correct="${correctAnswer(index)}"]`).click();
      if (index < count - 1) document.getElementById("next-question").click();
    }
    clock.mockRestore();
  }

  function playOvertimeRound(answers) {
    document.getElementById("next-question").click();
    for (let index = 0; index < answers.length; index += 1) {
      document.querySelector(`.answer[data-correct="${answers[index]}"]`).click();
      if (index < answers.length - 1) document.getElementById("next-question").click();
    }
  }

  beforeEach(() => boot());

  afterEach(() => {
    dom.window.close();
    vi.restoreAllMocks();
  });

  it("uses hard questions, ten per team and a fifteen-second timer", () => {
    const settings = new dom.window.FormData(document.getElementById("setup-form"));
    expect(document.querySelector('input[name="difficulty"]')).toBeNull();
    expect(document.querySelector('input[name="rounds"]')).toBeNull();
    expect(settings.get("time-limit")).toBe("15");
    expect(document.getElementById("question-bank-info").textContent).toContain("500");
    expect(document.getElementById("quiz-features").textContent).toContain("500 вопросов");
    submit();
    const game = dom.window.getGame();
    expect(game.rounds).toBe(10);
    expect(game.questions).toHaveLength(20);
    expect(game.timeLimit).toBe(15);
    expect(game.questions.every((question) => question.difficulty === "hard")).toBe(true);
    expect(game.deadline).not.toBeNull();
    expect(document.getElementById("question-timer").hidden).toBe(false);
  });

  it("switches between three panels with screenshots inside features", () => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    expect(tabs).toHaveLength(3);
    expect(document.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
    document.getElementById("tab-features").click();
    expect(document.getElementById("quiz-play").hidden).toBe(true);
    expect(document.getElementById("quiz-rules").hidden).toBe(true);
    expect(document.getElementById("quiz-features").hidden).toBe(false);
    expect(document.getElementById("quiz-features").contains(document.getElementById("quiz-screenshots"))).toBe(true);
    expect(document.querySelectorAll("#quiz-features .screenshot-grid img")).toHaveLength(4);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
    document.getElementById("tab-play").click();
    expect(document.getElementById("quiz-play").hidden).toBe(false);
    expect(document.getElementById("quiz-features").hidden).toBe(true);
  });

  it("supports keyboard tab navigation with one tab stop", () => {
    const key = (id, value) => document.getElementById(id)
      .dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
    key("tab-play", "ArrowLeft");
    expect(document.activeElement.id).toBe("tab-features");
    key("tab-features", "ArrowRight");
    expect(document.activeElement.id).toBe("tab-play");
    key("tab-play", "End");
    expect(document.activeElement.id).toBe("tab-features");
    key("tab-features", "Home");
    expect(document.activeElement.id).toBe("tab-play");
    expect([...document.querySelectorAll('[role="tab"]')].map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  });

  it("preserves the game and countdown across tabs without stealing focus on timeout", () => {
    const clock = vi.spyOn(dom.window.performance, "now").mockReturnValue(1000);
    submit();
    const currentGame = dom.window.getGame();
    const rules = document.getElementById("tab-rules");
    rules.focus();
    rules.click();
    expect(document.getElementById("tab-timer-notice").hidden).toBe(false);
    expect(currentGame.deadline).toBe(16000);
    clock.mockReturnValue(16000);
    dom.window.updateQuestionTimer();
    expect(currentGame.answered).toBe(true);
    expect(document.activeElement).toBe(rules);
    expect(document.getElementById("tab-timer-notice").hidden).toBe(true);
    document.getElementById("tab-play").click();
    expect(dom.window.getGame()).toBe(currentGame);
    expect(document.getElementById("next-question").hidden).toBe(false);
    expect(document.getElementById("quiz-play").hidden).toBe(false);
  });

  it("applies the same defaults when starting without explicit settings", () => {
    dom.window.startGame(["A", "B"]);
    expect(dom.window.getGame().rounds).toBe(10);
    expect(dom.window.getGame().timeLimit).toBe(15);
  });

  it("supports the largest party without repeated hard questions", () => {
    for (let count = 2; count < 6; count += 1) {
      document.getElementById("add-team").click();
    }
    submit();
    const { questions } = dom.window.getGame();
    expect(questions).toHaveLength(60);
    expect(new Set(questions.map((question) => question.question)).size).toBe(60);
    expect(questions.every((question) => question.difficulty === "hard")).toBe(true);
    expect(dom.window.getGame().turnOwners).toEqual(
      Array.from({ length: 6 }, (_, index) => Array(10).fill(index)).flat(),
    );
  });

  it("keeps all ten regulation questions with one team before switching to the next", () => {
    dom.window.startGame(["A", "B"], 0);
    for (let index = 0; index < 10; index += 1) {
      expect(dom.window.currentTeamIndex()).toBe(0);
      expect(document.getElementById("question-counter").textContent).toBe(`${index + 1} / 10`);
      document.querySelector('.answer[data-correct="true"]').click();
      document.getElementById("next-question").click();
    }
    expect(dom.window.currentTeamIndex()).toBe(1);
    expect(dom.window.getGame().teams.map((team) => team.answered)).toEqual([10, 0]);
    expect(document.getElementById("question-counter").textContent).toBe("1 / 10");
    expect(document.getElementById("progress").getAttribute("aria-valuenow")).toBe("0");
    expect(document.getElementById("progress").getAttribute("aria-valuemax")).toBe("10");
    expect(dom.window.getQuizStorage().state.ratings).toHaveLength(0);
  });

  it("ends an unanswered default question after fifteen seconds with no points", () => {
    const clock = vi.spyOn(dom.window.performance, "now").mockReturnValue(1000);
    submit();
    expect(dom.window.getGame().deadline).toBe(16000);
    clock.mockReturnValue(16000);
    dom.window.updateQuestionTimer();
    expect(dom.window.getGame().answered).toBe(true);
    expect(dom.window.getGame().teams.every((team) => team.score === 0)).toBe(true);
    expect([...document.querySelectorAll(".answer")].every((button) => button.disabled)).toBe(true);
    expect(document.getElementById("next-question").hidden).toBe(false);
    expect(dom.window.getQuizStorage().state.answeredQuestions).toEqual([dom.window.getGame().questions[0].question]);
    expect(dom.window.getGame().teams[0]).toMatchObject({ responseTimeMs: 15000, timedAnswers: 1 });
  });

  it("measures correct and incorrect responses but not time spent reading feedback", () => {
    const clock = vi.spyOn(dom.window.performance, "now").mockReturnValue(1000);
    dom.window.startGame(["A"], 0);
    clock.mockReturnValue(3500);
    document.querySelector('.answer[data-correct="true"]').click();
    expect(dom.window.getGame().teams[0]).toMatchObject({ responseTimeMs: 2500, timedAnswers: 1 });
    clock.mockReturnValue(100000);
    document.getElementById("next-question").click();
    clock.mockReturnValue(104000);
    document.querySelector('.answer[data-correct="false"]').click();
    expect(dom.window.getGame().teams[0]).toMatchObject({ responseTimeMs: 6500, timedAnswers: 2, score: 1 });
    dom.window.finishQuestion(null, false);
    expect(dom.window.getGame().teams[0].timedAnswers).toBe(2);
  });

  it("caps a delayed timer callback at fifteen seconds but measures longer untimed responses", () => {
    const clock = vi.spyOn(dom.window.performance, "now").mockReturnValue(1000);
    dom.window.startGame(["A"]);
    clock.mockReturnValue(91000);
    dom.window.updateQuestionTimer();
    expect(dom.window.getGame().teams[0]).toMatchObject({ responseTimeMs: 15000, timedAnswers: 1, score: 0 });
    dom.window.startGame(["A"], 0);
    clock.mockReturnValue(121000);
    document.querySelector('.answer[data-correct="true"]').click();
    expect(dom.window.getGame().teams[0]).toMatchObject({ responseTimeMs: 30000, timedAnswers: 1, score: 1 });
  });

  it("still allows untimed play", () => {
    document.querySelector('input[name="time-limit"][value="0"]').checked = true;
    submit();
    expect(dom.window.getGame().timeLimit).toBe(0);
    expect(dom.window.getGame().deadline).toBeNull();
    expect(document.getElementById("question-timer").hidden).toBe(true);
    expect(document.getElementById("timer-urgency").textContent).toBe("");
    expect(document.getElementById("answers-stage").classList.contains("is-urgent")).toBe(false);
  });

  it("signals the last three seconds without repeating the announcement at every tick", () => {
    const clock = vi.spyOn(dom.window.performance, "now").mockReturnValue(1000);
    submit();
    clock.mockReturnValue(12999);
    dom.window.updateQuestionTimer();
    expect(document.getElementById("timer-urgency").textContent).toBe("");
    clock.mockReturnValue(13000);
    dom.window.updateQuestionTimer();
    expect(document.getElementById("question-timer").classList.contains("is-urgent")).toBe(true);
    expect(document.getElementById("answers-stage").classList.contains("is-urgent")).toBe(true);
    expect(document.getElementById("timer-urgency").textContent).not.toBe("");
    const announcement = document.getElementById("timer-urgency").firstChild;
    clock.mockReturnValue(14000);
    dom.window.updateQuestionTimer();
    expect(document.getElementById("timer-urgency").firstChild).toBe(announcement);
  });

  it.each(["answer", "timeout", "leave"])("clears urgency on %s and starts the next question calmly", (action) => {
    const clock = vi.spyOn(dom.window.performance, "now").mockReturnValue(1000);
    submit();
    clock.mockReturnValue(13000);
    dom.window.updateQuestionTimer();
    if (action === "answer") document.querySelector(".answer").click();
    if (action === "leave") document.getElementById("leave-game").click();
    if (action === "timeout") {
      clock.mockReturnValue(16000);
      dom.window.updateQuestionTimer();
    }
    expect(document.getElementById("timer-urgency").textContent).toBe("");
    expect(document.getElementById("question-timer").classList.contains("is-urgent")).toBe(false);
    expect(document.getElementById("answers-stage").classList.contains("is-urgent")).toBe(false);
    if (action === "leave") submit();
    else document.getElementById("next-question").click();
    expect(document.getElementById("timer-urgency").textContent).toBe("");
    expect(document.getElementById("question-timer").classList.contains("is-urgent")).toBe(false);
  });

  it("omits difficulty labels from setup, questions, and results", () => {
    expect(document.getElementById("setup-screen").textContent).not.toMatch(/сложност|сложны[йех]/i);
    dom.window.startGame(["A"], 0);
    expect(document.getElementById("question-difficulty")).toBeNull();
    finishGame();
    document.getElementById("next-question").click();
    expect(document.getElementById("result-format").textContent).not.toMatch(/сложност|сложны[йех]/i);
  });

  it("restores edited team names and team count after reload", () => {
    document.getElementById("add-team").click();
    const input = document.querySelector(".team-field input");
    input.value = "Quantum";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    const saved = dom.window.localStorage.getItem("bazinga.quiz.v1");
    dom.window.close();
    boot(saved);
    expect(document.querySelectorAll(".team-field")).toHaveLength(3);
    expect(document.querySelector(".team-field input").value).toBe("Quantum");
    document.getElementById("remove-team").click();
    expect(dom.window.getQuizStorage().state.teamNames).toHaveLength(2);
  });

  it("remembers answers from abandoned games and avoids them after reload", () => {
    submit();
    const question = dom.window.getGame().questions[0].question;
    document.querySelector('.answer[data-correct="false"]').click();
    document.getElementById("leave-game").click();
    expect(dom.window.getQuizStorage().state.ratings).toHaveLength(0);
    const saved = dom.window.localStorage.getItem("bazinga.quiz.v1");
    dom.window.close();
    boot(saved);
    submit();
    expect(dom.window.getGame().questions.every((entry) => entry.question !== question)).toBe(true);
    expect(dom.window.getQuizStorage().state.answeredQuestions).toEqual([question]);
  });

  it("prioritizes every remaining fresh question and then reuses without in-game repeats", () => {
    const storage = dom.window.getQuizStorage();
    const freshStart = QUESTIONS.length - 5;
    QUESTIONS.slice(0, freshStart).forEach((question) => storage.recordAnswer(question.question));
    dom.window.startGame(["A", "B"], 0);
    const selected = dom.window.getGame().questions.map((question) => question.question);
    expect(selected).toHaveLength(20);
    expect(new Set(selected).size).toBe(20);
    QUESTIONS.slice(freshStart).forEach((question) => expect(selected).toContain(question.question));
    QUESTIONS.slice(freshStart).forEach((question) => storage.recordAnswer(question.question));
    dom.window.startGame(["A", "B"], 0);
    expect(new Set(dom.window.getGame().questions.map((question) => question.question)).size).toBe(20);
  });

  it("keeps the previous bank's answer history and deals new questions to six teams", () => {
    const answeredQuestions = QUESTIONS.slice(0, 220).map((question) => question.question);
    dom.window.close();
    boot(JSON.stringify({ teamNames: ["A"], answeredQuestions, ratings: [] }));
    expect(dom.window.getQuizStorage().state.answeredQuestions).toEqual(answeredQuestions);
    dom.window.startGame(["A", "B", "C", "D", "E", "F"], 0);
    const selected = dom.window.getGame().questions;
    expect(selected).toHaveLength(60);
    expect(new Set(selected.map((question) => question.question)).size).toBe(60);
    expect(selected.every((question) => !answeredQuestions.includes(question.question))).toBe(true);
  });

  it("records a completed game exactly once before opening results and retains it on reload", () => {
    dom.window.startGame(["A", "B"], 0);
    finishGame([1000], (index) => index !== 11);
    const storage = dom.window.getQuizStorage();
    expect(storage.state.ratings.map((team) => [team.games, team.correct, team.draws, team.points]))
      .toEqual([[1, 10, 0, 15], [1, 9, 0, 9]]);
    expect(document.getElementById("results-screen").hidden).toBe(true);
    document.getElementById("next-question").click();
    dom.window.showResults();
    expect(storage.state.ratings.every((team) => team.games === 1)).toBe(true);
    const saved = dom.window.localStorage.getItem("bazinga.quiz.v1");
    dom.window.close();
    boot(saved);
    expect(document.querySelectorAll("#rating-list tr")).toHaveLength(2);
    expect(dom.window.getQuizStorage().state.ratings.map((team) => team.points)).toEqual([15, 9]);
  });

  it("ends the penalty series early once a team's lead becomes mathematically unbeatable", () => {
    dom.window.startGame(["A", "B"], 0);
    finishGame([3000, 1000]);
    expect(dom.window.getQuizStorage().state.ratings).toHaveLength(0);
    expect(dom.window.getGame().pendingContenders).toEqual([0, 1]);
    expect(document.querySelectorAll(".penalty-mark.is-pending")).toHaveLength(10);
    document.getElementById("next-question").click();
    expect(document.querySelectorAll(".penalty-mark.is-current")).toHaveLength(1);
    document.querySelector('.answer[data-correct="true"]').click();
    expect(dom.window.getGame().complete).toBe(false);
    expect(dom.window.getQuizStorage().state.ratings).toHaveLength(0);
    document.getElementById("next-question").click();
    document.querySelector('.answer[data-correct="false"]').click();
    expect(document.querySelectorAll(".penalty-mark.is-goal")).toHaveLength(1);
    expect(document.querySelectorAll(".penalty-mark.is-miss")).toHaveLength(1);
    playOvertimeRound([true, false]);
    expect(dom.window.getGame().complete).toBe(false);
    expect(dom.window.getGame().pendingContenders).toEqual([0, 1]);
    expect(document.querySelectorAll(".penalty-row.is-eliminated")).toHaveLength(0);
    expect(dom.window.getQuizStorage().state.ratings).toHaveLength(0);
    document.getElementById("next-question").click();
    document.querySelector('.answer[data-correct="true"]').click();
    expect(dom.window.getGame().complete).toBe(false);
    document.getElementById("next-question").click();
    document.querySelector('.answer[data-correct="false"]').click();
    expect(dom.window.getGame().complete).toBe(true);
    expect(dom.window.getGame().winnerIndex).toBe(0);
    expect(document.querySelectorAll(".penalty-mark.is-goal")).toHaveLength(3);
    expect(document.querySelectorAll(".penalty-mark.is-miss")).toHaveLength(3);
    expect(document.querySelectorAll(".penalty-mark.is-skipped")).toHaveLength(4);
    expect(document.querySelectorAll(".penalty-row.is-eliminated")).toHaveLength(1);
    document.getElementById("next-question").click();
    expect(document.querySelector("#results-list .winner strong").textContent).toBe("A");
    expect(document.querySelectorAll("#results-list .winner")).toHaveLength(1);
    expect(document.querySelector("#results-list .result-place").textContent).toBe("01");
    const ratings = dom.window.getQuizStorage().state.ratings;
    expect(ratings.find((team) => team.name === "A"))
      .toMatchObject({ points: 18, wins: 1, draws: 0, correct: 13, answered: 13, timedAnswers: 13 });
    expect(ratings.find((team) => team.name === "B"))
      .toMatchObject({ points: 10, wins: 0, draws: 0, correct: 10, answered: 13, timedAnswers: 13 });
  });

  it("repeats all-hit and all-miss rounds, then eliminates only failed contenders", () => {
    dom.window.startGame(["A", "B", "C", "D"], 0);
    finishGame([1000], (index) => index < 30);
    expect(dom.window.getGame().pendingContenders).toEqual([0, 1, 2]);
    for (let round = 0; round < 5; round += 1) playOvertimeRound([true, true, true]);
    playOvertimeRound([true, true, true]);
    expect(dom.window.getGame().pendingContenders).toEqual([0, 1, 2]);
    playOvertimeRound([false, false, false]);
    expect(dom.window.getGame().pendingContenders).toEqual([0, 1, 2]);
    playOvertimeRound([false, true, true]);
    expect(dom.window.getGame().pendingContenders).toEqual([1, 2]);
    expect(document.querySelectorAll(".penalty-row.is-eliminated")).toHaveLength(1);
    expect(dom.window.getQuizStorage().state.ratings).toHaveLength(0);
    playOvertimeRound([true, false]);
    const game = dom.window.getGame();
    expect(game.complete).toBe(true);
    expect(game.winnerIndex).toBe(1);
    expect(game.teams.map((team) => team.answered)).toEqual([18, 19, 19, 10]);
    expect(new Set(game.questions.map((question) => question.question)).size).toBe(game.questions.length);
    expect(document.querySelectorAll(".penalty-mark.is-skipped")).toHaveLength(1);
    expect(dom.window.getQuizStorage().state.ratings.map((team) => team.answered)).toEqual([18, 19, 19, 10]);
    expect(dom.window.getQuizStorage().state.ratings.map((team) => team.points)).toEqual([16, 23, 17, 0]);
    document.getElementById("next-question").click();
    document.getElementById("play-again").click();
    expect(dom.window.getGame().overtimeRounds).toHaveLength(0);
    expect(document.getElementById("overtime-panel").hidden).toBe(true);
  });

  it("uses a timeout as a penalty miss and keeps urgency and progress scoped to overtime", () => {
    dom.window.startGame(["A", "B"]);
    finishGame();
    document.getElementById("next-question").click();
    const clock = vi.spyOn(dom.window.performance, "now").mockReturnValue(dom.window.getGame().deadline);
    dom.window.updateQuestionTimer();
    expect(document.querySelectorAll(".penalty-mark.is-miss")).toHaveLength(1);
    expect(dom.window.getGame().complete).toBe(false);
    expect(document.getElementById("progress").getAttribute("aria-valuemax")).toBe("2");
    expect(document.getElementById("progress").getAttribute("aria-valuenow")).toBe("1");
    document.getElementById("next-question").click();
    expect(document.getElementById("timer-urgency").textContent).toBe("");
    clock.mockReturnValue(dom.window.getGame().questionStartedAt + 1000);
    document.querySelector('.answer[data-correct="true"]').click();
    expect(dom.window.getGame().complete).toBe(false);
    for (let round = 1; round < 3; round += 1) playOvertimeRound([false, true]);
    expect(dom.window.getGame().complete).toBe(true);
    expect(dom.window.getGame().winnerIndex).toBe(1);
    expect(dom.window.getGame().teams[0].responseTimeMs).toBe(25000);
  });

  it("selects only the five-attempt series leaders for sudden death", () => {
    dom.window.startGame(["A", "B", "C"], 0);
    finishGame();
    for (let round = 0; round < 5; round += 1) {
      playOvertimeRound([false, true, true]);
      if (round < 4) expect(dom.window.getGame().pendingContenders).toEqual([0, 1, 2]);
    }
    expect(dom.window.getGame().pendingContenders).toEqual([1, 2]);
    expect(document.querySelectorAll(".penalty-row.is-eliminated")).toHaveLength(1);
    playOvertimeRound([false, true]);
    expect(dom.window.getGame().winnerIndex).toBe(2);
    expect(dom.window.getGame().turnOwners.slice(-2)).toEqual([1, 2]);
    expect(dom.window.getQuizStorage().state.ratings.map((team) => team.answered)).toEqual([15, 16, 16]);
  });

  it("starts sudden death after an all-miss five-attempt series and keeps every tied team", () => {
    dom.window.startGame(["A", "B"], 0);
    finishGame();
    for (let round = 0; round < 5; round += 1) playOvertimeRound([false, false]);
    expect(dom.window.getGame().pendingContenders).toEqual([0, 1]);
    expect(dom.window.getGame().complete).toBe(false);
    playOvertimeRound([false, true]);
    expect(dom.window.getGame().winnerIndex).toBe(1);
    expect(dom.window.getQuizStorage().state.ratings.map((team) => team.points)).toEqual([10, 16]);
  });

  it("abandons unresolved overtime without recording ratings but keeps answered history", () => {
    dom.window.startGame(["A", "B"], 0);
    finishGame();
    playOvertimeRound([true, true]);
    document.getElementById("leave-game").click();
    expect(dom.window.getQuizStorage().state.ratings).toHaveLength(0);
    expect(dom.window.getQuizStorage().state.answeredQuestions).toHaveLength(22);
  });

  it("continues after bank exhaustion with an explicit notice and distinct questions per round", () => {
    dom.window.startGame(["A", "B"], 0);
    finishGame();
    const game = dom.window.getGame();
    QUESTIONS.forEach((question) => game.usedQuestions.add(question.question));
    document.getElementById("next-question").click();
    expect(document.getElementById("overtime-repeat-note").hidden).toBe(false);
    expect(new Set(game.questions.slice(game.overtimeStart).map((question) => question.question)).size).toBe(2);
    expect(game.complete).toBe(false);
  });

  it("ranks equal cumulative points by average response time and keeps that leader after reload", () => {
    const storage = dom.window.getQuizStorage();
    storage.recordGame([{ name: "Alpha", score: 10, responseTimeMs: 30000, timedAnswers: 10 }], 10);
    storage.recordGame([{ name: "Beta", score: 10, responseTimeMs: 20000, timedAnswers: 10 }], 10);
    dom.window.renderLocalStats();
    expect(document.querySelector("#rating-list th").textContent).toBe("Beta");
    expect(document.getElementById("rating-leader").textContent).toBe("Beta");
    expect(document.getElementById("leader-time").textContent).toContain("2,000");
    expect(document.querySelectorAll("#rating-list .is-leader")).toHaveLength(1);
    const saved = dom.window.localStorage.getItem("bazinga.quiz.v1");
    dom.window.close();
    boot(saved);
    expect(document.getElementById("rating-leader").textContent).toBe("Beta");
    expect(document.getElementById("leader-time").textContent).toContain("2,000");
  });

  it("retains legacy ratings and averages only newly measured answers", () => {
    dom.window.close();
    boot(JSON.stringify({
      teamNames: ["A"], answeredQuestions: [QUESTIONS[0].question],
      ratings: [{ key: "a", name: "A", games: 1, wins: 1, draws: 0, correct: 8, answered: 10, points: 13 }],
    }));
    expect(document.getElementById("leader-points").textContent).toContain("13");
    expect(document.getElementById("leader-time").textContent).toContain("\u2014");
    dom.window.startGame(["A"], 0);
    finishGame();
    expect(dom.window.getQuizStorage().state.ratings[0])
      .toMatchObject({ games: 2, points: 23, answered: 20, timedAnswers: 10, responseTimeMs: 10000 });
    expect(document.getElementById("leader-time").textContent).toContain("1,000");
  });

  it("keeps the fixed format and timer choice on replay with fresh questions", () => {
    dom.window.startGame(["A"], 0);
    const previous = dom.window.getGame().questions.map((question) => question.question);
    finishGame();
    document.getElementById("next-question").click();
    expect(document.getElementById("results-screen").hidden).toBe(false);
    document.getElementById("play-again").click();
    expect(dom.window.getGame().rounds).toBe(10);
    expect(dom.window.getGame().questions).toHaveLength(10);
    expect(dom.window.getGame().questions.every((question) => !previous.includes(question.question))).toBe(true);
    expect(document.getElementById("question-timer").hidden).toBe(true);
  });

  it("confirms a full local reset and disables it during play", () => {
    dom.window.startGame(["A"], 0);
    expect(document.getElementById("reset-local-data").disabled).toBe(true);
    finishGame();
    document.getElementById("next-question").click();
    dom.window.confirm.mockReturnValueOnce(false);
    document.getElementById("reset-local-data").click();
    expect(dom.window.getQuizStorage().state.ratings).toHaveLength(1);
    document.getElementById("reset-local-data").click();
    expect(dom.window.getQuizStorage().state.ratings).toHaveLength(0);
    expect(dom.window.getQuizStorage().state.answeredQuestions).toHaveLength(0);
    expect(document.getElementById("rating-table-wrap").hidden).toBe(true);
    expect(document.querySelectorAll(".team-field")).toHaveLength(2);
    expect(dom.window.localStorage.getItem("bazinga.quiz.v1")).toBeNull();
    expect(document.getElementById("setup-screen").hidden).toBe(false);
    expect(dom.window.getGame()).toBeNull();
  });

  it("shows the leader above the game without expanding ratings and restores it after reload", () => {
    const storage = dom.window.getQuizStorage();
    storage.recordGame([{ name: "A", score: 8 }, { name: "B", score: 2 }], 10);
    dom.window.renderLocalStats();
    const leader = document.getElementById("rating-leader");
    expect(document.querySelector(".local-stats").open).toBe(false);
    expect(leader.closest("details")).toBeNull();
    expect(document.getElementById("leader-banner").hidden).toBe(false);
    expect(document.getElementById("leader-banner").compareDocumentPosition(document.querySelector("main"))
      & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(leader.textContent).toContain("A");
    expect(document.getElementById("leader-points").textContent).toContain("13");
    const saved = dom.window.localStorage.getItem("bazinga.quiz.v1");
    dom.window.close();
    boot(saved);
    expect(document.getElementById("rating-leader").textContent).toContain("A");
    expect(document.querySelector(".local-stats").open).toBe(false);
  });

  it("hides the leader and both reset buttons until there is a rating", () => {
    expect(document.getElementById("leader-banner").hidden).toBe(true);
    expect(document.getElementById("rating-actions").hidden).toBe(true);
    expect(document.getElementById("reset-ratings").closest("#rating-actions")).not.toBeNull();
    expect(document.getElementById("reset-local-data").closest("#rating-actions")).not.toBeNull();
    dom.window.getQuizStorage().recordGame([{ name: "A", score: 0 }], 10);
    dom.window.renderLocalStats();
    expect(document.getElementById("leader-banner").hidden).toBe(false);
    expect(document.getElementById("rating-actions").hidden).toBe(false);
    document.getElementById("reset-ratings").click();
    expect(document.getElementById("leader-banner").hidden).toBe(true);
    expect(document.getElementById("rating-actions").hidden).toBe(true);
  });

  it("shows and highlights every team tied for the highest rating", () => {
    dom.window.getQuizStorage().recordGame([
      { name: "Alpha", score: 8 }, { name: "Beta", score: 8 }, { name: "Gamma", score: 1 },
    ], 10);
    dom.window.renderLocalStats();
    const leader = document.getElementById("rating-leader");
    expect(leader.textContent).toContain("Alpha, Beta");
    expect(leader.textContent).not.toContain("Gamma");
    expect(document.querySelectorAll("#rating-list .is-leader")).toHaveLength(2);
  });

  it("omits the draws column without changing stored tie points or table alignment", () => {
    dom.window.getQuizStorage().recordGame([{ name: "A", score: 5 }, { name: "B", score: 5 }], 10);
    dom.window.renderLocalStats();
    const headers = document.querySelectorAll(".rating-table thead th");
    expect(headers).toHaveLength(7);
    expect([...headers].some((header) => header.textContent === "\u041d\u0438\u0447\u044c\u0438")).toBe(false);
    for (const row of document.querySelectorAll("#rating-list tr")) {
      expect(row.children).toHaveLength(headers.length);
      expect(row.children[1].textContent).toBe("7");
      expect(row.children[5].textContent).toBe("5 / 10");
      expect(row.children[6].textContent).toBe("50%");
    }
    expect(dom.window.getQuizStorage().state.ratings.every((team) => team.draws === 1)).toBe(true);
  });

  it("requires confirmation to clear ratings only and preserves saved teams and answers", () => {
    const storage = dom.window.getQuizStorage();
    storage.saveTeamNames(["Alpha"]);
    dom.window.startGame(["Alpha"], 0);
    expect(document.getElementById("reset-ratings").disabled).toBe(true);
    finishGame();
    document.getElementById("next-question").click();
    const answered = storage.state.answeredQuestions;
    dom.window.confirm.mockReturnValueOnce(false);
    document.getElementById("reset-ratings").click();
    expect(storage.state.ratings).toHaveLength(1);
    document.getElementById("reset-ratings").click();
    expect(storage.state.ratings).toHaveLength(0);
    expect(storage.state.teamNames).toEqual(["Alpha"]);
    expect(storage.state.answeredQuestions).toEqual(answered);
    expect(document.getElementById("rating-table-wrap").hidden).toBe(true);
    expect(document.getElementById("rating-leader").textContent).not.toContain("Alpha");
    expect(document.getElementById("leader-banner").hidden).toBe(true);
    expect(document.getElementById("rating-actions").hidden).toBe(true);
    const saved = dom.window.localStorage.getItem("bazinga.quiz.v1");
    dom.window.close();
    boot(saved);
    expect(dom.window.getQuizStorage().state.ratings).toHaveLength(0);
    expect(document.querySelector(".team-field input").value).toBe("Alpha");
    expect(dom.window.getQuizStorage().state.answeredQuestions).toEqual(answered);
  });

  it("surfaces storage write failure without breaking answers", () => {
    vi.spyOn(dom.window.console, "error").mockImplementation(() => {});
    vi.spyOn(dom.window.Storage.prototype, "setItem").mockImplementation(() => {
      throw new dom.window.DOMException("Quota exceeded", "QuotaExceededError");
    });
    submit();
    document.querySelector('.answer[data-correct="true"]').click();
    expect(document.getElementById("storage-status").textContent).not.toBe("");
    expect(dom.window.getGame().answered).toBe(true);
    expect(document.getElementById("next-question").hidden).toBe(false);
  });
});
