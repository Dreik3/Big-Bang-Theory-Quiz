const $ = (id) => document.getElementById(id);
const teamInputs = $("team-inputs");
const screens = ["setup-screen", "game-screen", "results-screen"];
const ROUNDS_PER_TEAM = 10;
const PENALTY_ROUNDS = 5;
const responseTimeFormat = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 3, maximumFractionDigits: 3,
});
const quizStorage = new QuizStorage((error) => {
  console.error("Quiz data could not be stored or loaded:", error);
  $("storage-status").textContent = "Не удалось прочитать или сохранить данные браузера. Игра доступна, но команды, рейтинг и история могут не сохраниться после закрытия страницы.";
});
let game = null;
let questionTimerId = null;
const sectionTabs = [...document.querySelectorAll('.section-tabs [role="tab"]')];
let activeTab = "quiz-play";
const music = new BackgroundMusic();
const musicToggle = $("music-toggle");
let musicStarted = false;

function updateTabTimerNotice() {
  $("tab-timer-notice").hidden = activeTab === "quiz-play" || !game || game.answered || game.deadline === null;
}

function selectTab(tab) {
  activeTab = tab.getAttribute("aria-controls");
  for (const button of sectionTabs) {
    const selected = button === tab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(button.getAttribute("aria-controls")).hidden = !selected;
  }
  updateTabTimerNotice();
}

sectionTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % sectionTabs.length;
    else if (event.key === "ArrowLeft") next = (index + sectionTabs.length - 1) % sectionTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = sectionTabs.length - 1;
    else return;
    event.preventDefault();
    selectTab(sectionTabs[next]);
    sectionTabs[next].focus();
  });
});

function reportMusicError(error) {
  console.error("Background music could not start:", error);
  music.setEnabled(false);
  musicToggle.setAttribute("aria-pressed", "false");
  musicToggle.textContent = "Музыка: выкл.";
  $("music-status").textContent = "Не удалось включить музыку. Нажмите кнопку музыки, чтобы попробовать снова.";
}

function startMusic() {
  musicStarted = true;
  music.start().then(() => {
    $("music-status").textContent = "";
  }).catch(reportMusicError);
}

musicToggle.addEventListener("click", () => {
  music.setEnabled(!music.enabled);
  musicToggle.setAttribute("aria-pressed", String(music.enabled));
  musicToggle.textContent = music.enabled ? "Музыка: вкл." : "Музыка: выкл.";
  $("music-status").textContent = "";
  if (music.enabled) startMusic();
});

function unlockMusic(event) {
  if (musicStarted || !music.enabled || event.target === musicToggle) return;
  if (event.type === "keydown" && (event.repeat || ["Tab", "Shift", "Control", "Alt", "Meta", "Escape"].includes(event.key))) return;
  startMusic();
}

if ("AudioContext" in window) {
  document.addEventListener("click", unlockMusic);
  document.addEventListener("keydown", unlockMusic);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) music.pause();
    else if (musicStarted && music.enabled) startMusic();
  });
  window.addEventListener("pagehide", () => music.pause());
  window.addEventListener("pageshow", () => {
    if (musicStarted && music.enabled) startMusic();
  });
} else {
  music.setEnabled(false);
  musicToggle.disabled = true;
  musicToggle.setAttribute("aria-pressed", "false");
  musicToggle.textContent = "Музыка: недоступна";
  $("music-status").textContent = "Этот браузер не поддерживает фоновую музыку. Можно играть без звука.";
}

function shuffle(items) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function showScreen(id) {
  if (id !== "game-screen") {
    stopQuestionTimer();
    if (game) game.deadline = null;
  }
  screens.forEach((screen) => {
    $(screen).hidden = screen !== id;
  });
  $("reset-local-data").disabled = id === "game-screen";
  $("reset-ratings").disabled = id === "game-screen";
  music.setScene(id === "game-screen" ? "game" : "menu");
  window.scrollTo({ top: 0, behavior: "instant" });
}

function updateTeamControls() {
  const count = teamInputs.children.length;
  $("team-count").value = count;
  $("remove-team").disabled = count === 1;
  $("add-team").disabled = count === 6;
}

function addTeam(name) {
  if (teamInputs.children.length >= 6) return;
  const number = teamInputs.children.length + 1;
  const label = document.createElement("label");
  label.className = "team-field";
  const badge = document.createElement("span");
  badge.className = "team-badge";
  badge.textContent = String(number).padStart(2, "0");
  const input = document.createElement("input");
  input.type = "text";
  input.name = `team-${number}`;
  input.maxLength = 24;
  input.value = name ?? `Команда ${number}`;
  input.required = true;
  input.setAttribute("aria-label", `Название команды ${number}`);
  input.autocomplete = "off";
  input.setAttribute("list", "saved-team-names");
  input.addEventListener("input", () => {
    teamInputs.querySelectorAll("input").forEach((field) => field.setCustomValidity(""));
    saveTeamNames();
  });
  label.append(badge, input);
  teamInputs.append(label);
  updateTeamControls();
}

function saveTeamNames() {
  quizStorage.saveTeamNames([...teamInputs.querySelectorAll("input")].map((input) => input.value));
}

function startGame(teams, timeLimit = 15) {
  const needed = ROUNDS_PER_TEAM * teams.length;
  if (QUESTIONS.length < needed) {
    window.alert("Для этой партии не хватает вопросов. Уменьшите число команд.");
    return;
  }
  const answered = new Set(quizStorage.state.answeredQuestions);
  const fresh = shuffle(QUESTIONS.filter((question) => !answered.has(question.question)));
  const previous = shuffle(QUESTIONS.filter((question) => answered.has(question.question)));
  const questions = shuffle([...fresh, ...previous].slice(0, needed));
  game = {
    teams: teams.map((name) => ({ name, score: 0, answered: 0, responseTimeMs: 0, timedAnswers: 0 })),
    rounds: ROUNDS_PER_TEAM,
    timeLimit,
    deadline: null,
    questionStartedAt: null,
    questions,
    index: 0,
    answered: false,
    recorded: false,
    turnOwners: questions.map((_, index) => Math.floor(index / ROUNDS_PER_TEAM)),
    overtimeRounds: [],
    contenders: [],
    pendingContenders: null,
    winnerIndex: null,
    complete: false,
    usedQuestions: new Set(questions.map((question) => question.question)),
    overtimeStart: null,
    overtimeRepeats: false,
  };
  showScreen("game-screen");
  renderQuestion();
}

function currentTeamIndex() {
  return game.turnOwners[game.index];
}

function beginOvertime() {
  game.contenders = game.pendingContenders;
  game.pendingContenders = null;
  game.overtimeStart = game.questions.length;
  const answered = new Set(quizStorage.state.answeredQuestions);
  const available = QUESTIONS.filter((question) => !game.usedQuestions.has(question.question));
  const selected = [
    ...shuffle(available.filter((question) => !answered.has(question.question))),
    ...shuffle(available.filter((question) => answered.has(question.question))),
  ].slice(0, game.contenders.length);
  if (selected.length < game.contenders.length) {
    // Sudden death has no fixed round limit; start a new question cycle if needed.
    game.usedQuestions.clear();
    const selectedKeys = new Set(selected.map((question) => question.question));
    selected.push(...shuffle(QUESTIONS.filter((question) => !selectedKeys.has(question.question)))
      .slice(0, game.contenders.length - selected.length));
    game.overtimeRepeats = true;
  }
  const questions = shuffle(selected);
  questions.forEach((question) => game.usedQuestions.add(question.question));
  game.questions.push(...questions);
  game.turnOwners.push(...game.contenders);
  game.overtimeRounds.push(game.contenders.map((teamIndex) => ({ teamIndex, correct: null })));
  game.index = game.overtimeStart;
  renderQuestion();
}

function penaltyStanding() {
  const stats = new Map(game.contenders.map((teamIndex) => [teamIndex, { goals: 0, attempts: 0 }]));
  for (const round of game.overtimeRounds) {
    for (const attempt of round) {
      const entry = stats.get(attempt.teamIndex);
      if (!entry || attempt.correct === null) continue;
      entry.attempts += 1;
      if (attempt.correct) entry.goals += 1;
    }
  }
  return game.contenders.map((teamIndex) => {
    const entry = stats.get(teamIndex);
    return { teamIndex, goals: entry.goals, remaining: PENALTY_ROUNDS - entry.attempts };
  });
}

// A team is out of the fixed-round penalty series once it can no longer catch the current leader,
// even if it scored every remaining attempt — mirrors real penalty-shootout early-stop rules.
function checkPenaltyDecided() {
  if (!game.overtimeRounds.length || game.overtimeRounds.length > PENALTY_ROUNDS) return false;
  const standing = penaltyStanding();
  if (standing.length < 2) return false;
  const currentBest = Math.max(...standing.map((team) => team.goals));
  const stillInIt = standing.filter((team) => team.goals + team.remaining >= currentBest);
  if (stillInIt.length !== 1) return false;
  game.complete = true;
  game.winnerIndex = stillInIt[0].teamIndex;
  game.recorded = true;
  quizStorage.recordGame(game.teams, game.rounds);
  return true;
}

function resolveRound() {
  let contenders;
  if (game.overtimeRounds.length > 0 && game.overtimeRounds.length < PENALTY_ROUNDS) {
    game.pendingContenders = [...game.contenders];
    return;
  }
  if (game.overtimeRounds.length > PENALTY_ROUNDS) {
    const attempts = game.overtimeRounds[game.overtimeRounds.length - 1];
    const correct = attempts.filter((attempt) => attempt.correct).map((attempt) => attempt.teamIndex);
    contenders = correct.length ? correct : [...game.contenders];
  } else {
    const eligible = game.overtimeRounds.length ? game.contenders : game.teams.map((_, index) => index);
    const best = Math.max(...eligible.map((index) => game.teams[index].score));
    contenders = eligible.filter((index) => game.teams[index].score === best);
  }
  if (contenders.length === 1) {
    game.complete = true;
    game.winnerIndex = contenders[0];
    game.recorded = true;
    quizStorage.recordGame(game.teams, game.rounds);
  } else {
    game.pendingContenders = contenders;
  }
}

function renderOvertime() {
  const visible = game.overtimeRounds.length > 0 || game.pendingContenders !== null;
  $("overtime-panel").hidden = !visible;
  if (!visible) return;
  const active = game.pendingContenders ?? game.contenders;
  const suddenDeath = game.overtimeRounds.length > PENALTY_ROUNDS
    || (game.overtimeRounds.length === PENALTY_ROUNDS && game.pendingContenders);
  $("overtime-title").textContent = game.complete ? "Серия завершена"
    : suddenDeath ? "Тай-брейк: до решающего раунда" : "Серия пенальти: по 5 вопросов";
  $("overtime-status").textContent = game.complete
    ? `Победитель: ${game.teams[game.winnerIndex].name}.`
    : game.pendingContenders
      ? `Следующий раунд: ${active.map((index) => game.teams[index].name).join(", ")}.`
      : suddenDeath ? "Каждая команда отвечает один раз. Выбывание — после всех ответов раунда."
        : `Попытка ${game.overtimeRounds.length} из ${PENALTY_ROUNDS}. Все команды завершат серию из пяти вопросов.`;
  $("overtime-repeat-note").hidden = !game.overtimeRepeats;
  $("penalty-list").replaceChildren();
  const participants = game.overtimeRounds.length
    ? game.overtimeRounds[0].map((attempt) => attempt.teamIndex) : active;
  for (const index of participants) {
    const row = document.createElement("div");
    row.className = "penalty-row";
    const eliminated = game.complete ? index !== game.winnerIndex : !active.includes(index);
    row.classList.toggle("is-eliminated", eliminated);
    const name = document.createElement("strong");
    const goals = game.overtimeRounds.reduce((total, round) =>
      total + Number(round.some((attempt) => attempt.teamIndex === index && attempt.correct === true)), 0);
    name.textContent = `${game.teams[index].name} · ${goals} ✓${eliminated ? " — выбыла" : ""}`;
    const marks = document.createElement("div");
    marks.className = "penalty-marks";
    for (let roundIndex = 0; roundIndex < Math.max(PENALTY_ROUNDS, game.overtimeRounds.length); roundIndex += 1) {
      const round = game.overtimeRounds[roundIndex];
      const attempt = round ? round.find((entry) => entry.teamIndex === index) : { correct: null };
      const mark = document.createElement("span");
      mark.className = "penalty-mark";
      const state = !attempt ? "skipped"
        : attempt.correct === null ? (game.complete ? "skipped" : "pending")
          : attempt.correct ? "goal" : "miss";
      mark.classList.add(`is-${state}`);
      mark.textContent = { skipped: "—", pending: "○", goal: "✓", miss: "×" }[state];
      const label = { skipped: "не участвует", pending: "ожидает ответа", goal: "верный ответ", miss: "ошибка" }[state];
      mark.setAttribute("aria-label", `Раунд ${roundIndex + 1}: ${label}`);
      mark.title = `Раунд ${roundIndex + 1}: ${label}`;
      if (state === "pending" && roundIndex === game.overtimeRounds.length - 1
        && index === currentTeamIndex() && !game.answered) {
        mark.classList.add("is-current");
        mark.setAttribute("aria-current", "step");
      }
      marks.append(mark);
    }
    row.append(name, marks);
    $("penalty-list").append(row);
  }
}

function renderScoreboard() {
  $("scoreboard").replaceChildren();
  game.teams.forEach((team, index) => {
    const card = document.createElement("div");
    card.className = "score-card";
    if (index === currentTeamIndex()) {
      card.classList.add("active");
      card.setAttribute("aria-current", "true");
    }
    const name = document.createElement("span");
    name.textContent = team.name;
    const score = document.createElement("strong");
    score.textContent = `${team.score} / ${game.overtimeRounds.length ? team.answered : game.rounds}`;
    card.append(name, score);
    $("scoreboard").append(card);
  });
}

function updateProgress() {
  const start = game.overtimeStart ?? currentTeamIndex() * ROUNDS_PER_TEAM;
  const total = game.overtimeStart === null ? ROUNDS_PER_TEAM : game.questions.length - start;
  const completed = game.index - start + Number(game.answered);
  $("progress").setAttribute("aria-label", game.overtimeStart !== null ? "Ответов в раунде тай-брейка" : "Ответов текущей команды");
  $("progress").setAttribute("aria-valuemax", total);
  $("progress").setAttribute("aria-valuenow", completed);
  $("progress-fill").style.width = `${(completed / total) * 100}%`;
}

function renderBackground(question) {
  const background = BACKGROUND_BY_TOPIC[question.illustration];
  const photo = $("background-photo");
  photo.hidden = false;
  photo.style.objectPosition = background.position;
  photo.src = background.src;
  $("background-status").textContent = "";
  $("scene-name").textContent = background.label;
  $("background-author").textContent = background.author;
  $("background-author").href = background.authorUrl;
  $("background-license").textContent = PHOTO_LICENSE.name;
  $("background-license").href = PHOTO_LICENSE.url;
  $("background-source").href = background.source;
  $("background-source").title = background.title;
}

function stopQuestionTimer() {
  window.clearInterval(questionTimerId);
  questionTimerId = null;
  setTimerUrgency(false);
  updateTabTimerNotice();
}

function setTimerUrgency(urgent) {
  $("question-timer").classList.toggle("is-urgent", urgent);
  $("answers-stage").classList.toggle("is-urgent", urgent);
  const message = urgent ? "Успейте выбрать ответ!" : "";
  if ($("timer-urgency").textContent !== message) $("timer-urgency").textContent = message;
}

function updateQuestionTimer() {
  if (!game || game.answered || game.deadline === null) return;
  const remaining = Math.max(0, game.deadline - performance.now());
  const seconds = Math.ceil(remaining / 1000);
  $("timer-value").textContent = `${seconds} с`;
  $("question-timer").setAttribute("aria-label", `Осталось секунд: ${seconds}`);
  setTimerUrgency(seconds > 0 && seconds <= 3);
  $("timer-fill").style.width = `${remaining / (game.timeLimit * 1000) * 100}%`;
  if (remaining === 0) finishQuestion(null, false, true);
}

function startQuestionTimer() {
  $("question-timer").hidden = game.timeLimit === 0;
  $("question-timer").classList.remove("is-urgent", "is-stopped");
  if (game.timeLimit === 0) return;
  // A deadline, rather than tick counting, keeps throttled tabs and late clicks honest.
  game.deadline = game.questionStartedAt + game.timeLimit * 1000;
  updateQuestionTimer();
  questionTimerId = window.setInterval(updateQuestionTimer, 100);
}

function renderQuestion() {
  stopQuestionTimer();
  game.deadline = null;
  game.answered = false;
  const question = game.questions[game.index];
  const team = game.teams[currentTeamIndex()];
  $("round-label").textContent = game.overtimeRounds.length
    ? game.overtimeRounds.length <= PENALTY_ROUNDS
      ? `Пенальти · попытка ${game.overtimeRounds.length} из ${PENALTY_ROUNDS}`
      : `До решающего ответа · раунд ${game.overtimeRounds.length - PENALTY_ROUNDS}`
    : `Команда ${currentTeamIndex() + 1} из ${game.teams.length} · вопрос ${game.index % ROUNDS_PER_TEAM + 1} из ${ROUNDS_PER_TEAM}`;
  $("turn-label").textContent = `Отвечает: ${team.name}`;
  $("question-counter").textContent = game.overtimeStart === null
    ? `${game.index % ROUNDS_PER_TEAM + 1} / ${ROUNDS_PER_TEAM}`
    : `${game.index - game.overtimeStart + 1} / ${game.questions.length - game.overtimeStart}`;
  $("question-category").textContent = question.category;
  $("question-hint").hidden = Boolean(game.timeLimit);
  renderBackground(question);
  $("question-title").textContent = question.question;
  $("feedback").replaceChildren();
  $("feedback").className = "feedback";
  $("next-question").hidden = true;
  $("next-question").textContent = "Дальше →";
  $("answers").replaceChildren();
  shuffle(question.answers.map((text, index) => ({ text, correct: index === question.correct })))
    .forEach((answer, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "answer";
      button.dataset.correct = String(answer.correct);
      const letter = document.createElement("span");
      letter.className = "answer-letter";
      letter.textContent = ["А", "Б", "В", "Г"][index];
      const text = document.createElement("span");
      text.textContent = answer.text;
      button.append(letter, text);
      button.addEventListener("click", () => chooseAnswer(button, answer.correct));
      $("answers").append(button);
    });
  renderScoreboard();
  renderOvertime();
  updateProgress();
  $("question-title").focus();
  game.questionStartedAt = performance.now();
  startQuestionTimer();
}

function chooseAnswer(selected, isCorrect) {
  if (game.answered) return;
  if (game.deadline !== null) {
    updateQuestionTimer();
    if (game.answered) return;
  }
  finishQuestion(selected, isCorrect);
}

function finishQuestion(selected, isCorrect, timedOut = false) {
  if (game.answered) return;
  const elapsed = Math.max(0, performance.now() - game.questionStartedAt);
  const responseTimeMs = Math.round(game.timeLimit ? Math.min(elapsed, game.timeLimit * 1000) : elapsed);
  game.answered = true;
  game.deadline = null;
  stopQuestionTimer();
  if (game.timeLimit) {
    $("question-timer").classList.add("is-stopped");
    $("question-timer").setAttribute("aria-label", timedOut ? "Время вышло" : "Таймер остановлен");
  }
  const question = game.questions[game.index];
  const team = game.teams[currentTeamIndex()];
  if (isCorrect) team.score += 1;
  team.answered += 1;
  team.responseTimeMs += responseTimeMs;
  team.timedAnswers += 1;
  quizStorage.recordAnswer(question.question);
  if (game.overtimeRounds.length) {
    game.overtimeRounds[game.overtimeRounds.length - 1]
      .find((attempt) => attempt.teamIndex === currentTeamIndex()).correct = isCorrect;
    checkPenaltyDecided();
  }
  if (!game.complete && game.index === game.questions.length - 1) resolveRound();
  renderLocalStats();
  for (const button of $("answers").children) {
    button.disabled = true;
    if (button.dataset.correct === "true") button.classList.add("correct");
  }
  if (selected && !isCorrect) selected.classList.add("incorrect");
  const title = document.createElement("strong");
  title.textContent = timedOut
    ? "Время вышло! За этот вопрос — 0 баллов."
    : isCorrect ? "Базинга! Это верно. +1 балл" : "Не в этот раз — но теперь вы знаете!";
  const explanation = document.createElement("p");
  explanation.textContent = `${isCorrect ? "" : `Верный ответ: ${question.answers[question.correct]}. `}${question.explanation}`;
  $("feedback").classList.add(isCorrect ? "is-correct" : "is-incorrect");
  $("feedback").append(title, explanation);
  $("next-question").hidden = false;
  $("next-question").textContent = game.complete ? "К результатам ↗"
    : game.pendingContenders ? "Следующий раунд тай-брейка →" : "Дальше →";
  renderScoreboard();
  renderOvertime();
  updateProgress();
  if (activeTab === "quiz-play") $("next-question").focus({ preventScroll: true });
}

function formatResponseTime(team) {
  const average = averageResponseTime(team);
  return average === null ? "—" : `${responseTimeFormat.format(average / 1000)} с`;
}

function compareGameTeams(a, b) {
  return b.score - a.score;
}

function showResults() {
  $("result-format").textContent = `10 вопросов каждой команде · ${game.timeLimit ? `${game.timeLimit} секунд на вопрос` : "Без таймера"}`;
  const ranked = [...game.teams].sort(compareGameTeams);
  const winners = ranked.filter((team) => compareGameTeams(team, ranked[0]) === 0);
  if (ranked.length === 1) {
    $("result-summary").textContent = `${ranked[0].name}: ${ranked[0].score} из ${game.rounds}. ${ranked[0].score === game.rounds ? "Идеальная партия!" : "Отличный повод вспомнить любимые серии."}`;
  } else if (winners.length > 1) {
    $("result-summary").textContent = `Ничья! Первое место делят: ${winners.map((team) => team.name).join(", ")}.`;
  } else {
    $("result-summary").textContent = `Побеждает ${winners[0].name}! ${game.overtimeRounds.length ? "Победа в серии тай-брейка." : "Сегодня это главное светило нашей компании."}`;
  }
  $("results-list").replaceChildren();
  ranked.forEach((team) => {
    const row = document.createElement("div");
    row.className = `result-row${winners.includes(team) ? " winner" : ""}`;
    const place = document.createElement("span");
    place.className = "result-place";
    place.textContent = `${ranked.findIndex((entry) => compareGameTeams(entry, team) === 0) + 1}`.padStart(2, "0");
    const name = document.createElement("strong");
    name.textContent = team.name;
    const score = document.createElement("span");
    score.textContent = `${team.score} / ${team.answered}`;
    const metrics = document.createElement("div");
    metrics.className = "result-metrics";
    const time = document.createElement("small");
    time.textContent = `Среднее время: ${formatResponseTime(team)}`;
    metrics.append(score, time);
    row.append(place, name, metrics);
    $("results-list").append(row);
  });
  showScreen("results-screen");
  $("results-title").focus();
}

function returnToSetup() {
  showScreen("setup-screen");
  teamInputs.querySelector("input").focus({ preventScroll: true });
}

$("add-team").addEventListener("click", () => {
  addTeam();
  saveTeamNames();
  teamInputs.lastElementChild.querySelector("input").focus();
});
$("remove-team").addEventListener("click", () => {
  if (teamInputs.children.length > 1) teamInputs.lastElementChild.remove();
  updateTeamControls();
  saveTeamNames();
});
$("setup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const inputs = [...teamInputs.querySelectorAll("input")];
  const seen = new Set();
  for (const input of inputs) {
    const name = input.value.trim();
    const key = normalizeTeamName(name);
    input.setCustomValidity(!name ? "Введите название команды." : seen.has(key) ? "Названия команд должны отличаться." : "");
    if (!input.reportValidity()) return;
    seen.add(key);
  }
  const settings = new FormData(event.currentTarget);
  const names = inputs.map((input) => input.value.trim());
  quizStorage.saveTeamNames(names);
  startGame(names, Number(settings.get("time-limit")));
});
$("next-question").addEventListener("click", () => {
  if (!game.answered) return;
  if (game.complete) {
    showResults();
  } else if (game.pendingContenders) {
    beginOvertime();
  } else {
    game.index += 1;
    renderQuestion();
  }
});
$("leave-game").addEventListener("click", () => {
  if (window.confirm("Вернуться к настройкам? Незавершённая партия не попадёт в рейтинг. Отвеченные вопросы останутся в истории.")) {
    returnToSetup();
  } else {
    updateQuestionTimer();
  }
});
$("play-again").addEventListener("click", () => startGame(game.teams.map((team) => team.name), game.timeLimit));
$("change-settings").addEventListener("click", returnToSetup);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updateQuestionTimer();
});

function updateQuestionBankInfo() {
  const answered = new Set(quizStorage.state.answeredQuestions);
  const count = QUESTIONS.filter((question) => answered.has(question.question)).length;
  $("question-bank-info").textContent = `Вопросов в игре: ${QUESTIONS.length}. Ещё не отвечено: ${QUESTIONS.length - count}.`;
  $("answered-count").textContent = `Отвечено вопросов: ${count} из ${QUESTIONS.length}.`;
}

function renderLocalStats() {
  const ratings = [...quizStorage.state.ratings].sort((a, b) =>
    b.points - a.points || compareResponseTimes(a, b) || a.name.localeCompare(b.name, "ru"));
  $("rating-list").replaceChildren();
  $("saved-team-names").replaceChildren();
  $("rating-empty").hidden = ratings.length > 0;
  $("rating-table-wrap").hidden = ratings.length === 0;
  $("rating-actions").hidden = ratings.length === 0;
  $("leader-banner").hidden = ratings.length === 0;
  const leaders = ratings.filter((team) =>
    team.points === ratings[0].points && compareResponseTimes(team, ratings[0]) === 0);
  $("leader-label").textContent = leaders.length > 1 ? "Лидеры рейтинга" : "Лидер рейтинга";
  $("rating-leader").textContent = leaders.map((team) => team.name).join(", ");
  $("leader-points").textContent = leaders.length ? `${leaders[0].points} очк.` : "";
  $("leader-time").textContent = leaders.length ? `Среднее время ответа: ${formatResponseTime(leaders[0])}` : "";
  for (const team of ratings) {
    const row = document.createElement("tr");
    row.classList.toggle("is-leader", leaders.includes(team));
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = team.name;
    row.append(name);
    const accuracy = team.answered ? Math.round(team.correct / team.answered * 100) : 0;
    for (const value of [team.points, formatResponseTime(team), team.games, team.wins, `${team.correct} / ${team.answered}`, `${accuracy}%`]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    $("rating-list").append(row);
    const option = document.createElement("option");
    option.value = team.name;
    $("saved-team-names").append(option);
  }
  updateQuestionBankInfo();
}

$("reset-ratings").addEventListener("click", () => {
  if (!window.confirm("Очистить рейтинг всех команд? Текущие команды и история отвеченных вопросов сохранятся.")) return;
  $("storage-status").textContent = "";
  quizStorage.resetRatings();
  renderLocalStats();
  game = null;
  returnToSetup();
});

$("reset-local-data").addEventListener("click", () => {
  if (!window.confirm("Удалить сохранённые команды, весь рейтинг и историю вопросов в этом браузере?")) return;
  $("storage-status").textContent = "";
  quizStorage.reset();
  teamInputs.replaceChildren();
  quizStorage.state.teamNames.forEach((name) => addTeam(name));
  renderLocalStats();
  game = null;
  returnToSetup();
});

$("background-photo").addEventListener("error", () => {
  $("background-photo").hidden = true;
  $("background-status").textContent = "Фото декораций не загрузилось. Можно продолжать игру без фона.";
});

Object.values(BACKGROUNDS).forEach((background) => {
  const item = document.createElement("li");
  const source = document.createElement("a");
  source.href = background.source;
  source.textContent = background.title;
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  item.append(source, ` — ${background.author}, ${PHOTO_LICENSE.name}.`);
  $("photo-credit-list").append(item);
});

renderLocalStats();
quizStorage.state.teamNames.forEach((name) => addTeam(name));
