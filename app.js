const $ = (id) => document.getElementById(id);
const teamInputs = $("team-inputs");
const screens = ["setup-screen", "game-screen", "results-screen"];
const DIFFICULTIES = {
  mixed: "Всего понемногу",
  easy: "Лёгкий",
  medium: "Средний",
  hard: "Сложный",
};
let game = null;
let questionTimerId = null;
const music = new BackgroundMusic();
const musicToggle = $("music-toggle");
let musicStarted = false;

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
  music.setScene(id === "game-screen" ? "game" : "menu");
  window.scrollTo({ top: 0, behavior: "instant" });
}

function updateTeamControls() {
  const count = teamInputs.children.length;
  $("team-count").value = count;
  $("remove-team").disabled = count === 1;
  $("add-team").disabled = count === 6;
}

function addTeam() {
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
  input.value = `Команда ${number}`;
  input.required = true;
  input.setAttribute("aria-label", `Название команды ${number}`);
  input.autocomplete = "off";
  input.addEventListener("input", () => {
    teamInputs.querySelectorAll("input").forEach((field) => field.setCustomValidity(""));
  });
  label.append(badge, input);
  teamInputs.append(label);
  updateTeamControls();
}

function startGame(teams, rounds, difficulty = "mixed", timeLimit = 0) {
  const levels = shuffle(["easy", "medium", "hard"]);
  const roundLevels = Array.from({ length: rounds }, (_, index) =>
    difficulty === "mixed" ? levels[index % levels.length] : difficulty);
  const pools = Object.fromEntries(levels.map((level) =>
    [level, shuffle(QUESTIONS.filter((question) => question.difficulty === level))]));
  for (const level of new Set(roundLevels)) {
    const needed = roundLevels.filter((entry) => entry === level).length * teams.length;
    if (!pools[level] || pools[level].length < needed) {
      window.alert("Для этой партии не хватает вопросов выбранной сложности. Выберите другой уровень или меньше раундов.");
      return;
    }
  }
  // Every team gets the same difficulty in a round, without repeated questions.
  const questions = roundLevels.flatMap((level) => teams.map(() => pools[level].pop()));
  game = {
    teams: teams.map((name) => ({ name, score: 0 })),
    rounds,
    difficulty,
    timeLimit,
    deadline: null,
    questions,
    index: 0,
    answered: false,
  };
  showScreen("game-screen");
  renderQuestion();
}

function renderScoreboard() {
  $("scoreboard").replaceChildren();
  game.teams.forEach((team, index) => {
    const card = document.createElement("div");
    card.className = "score-card";
    if (index === game.index % game.teams.length) {
      card.classList.add("active");
      card.setAttribute("aria-current", "true");
    }
    const name = document.createElement("span");
    name.textContent = team.name;
    const score = document.createElement("strong");
    score.textContent = `${team.score} / ${game.rounds}`;
    card.append(name, score);
    $("scoreboard").append(card);
  });
}

function updateProgress() {
  const completed = game.index + Number(game.answered);
  $("progress").setAttribute("aria-valuemax", game.questions.length);
  $("progress").setAttribute("aria-valuenow", completed);
  $("progress-fill").style.width = `${(completed / game.questions.length) * 100}%`;
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
}

function updateQuestionTimer() {
  if (!game || game.answered || game.deadline === null) return;
  const remaining = Math.max(0, game.deadline - performance.now());
  const seconds = Math.ceil(remaining / 1000);
  $("timer-value").textContent = `${seconds} с`;
  $("question-timer").setAttribute("aria-label", `Осталось секунд: ${seconds}`);
  $("question-timer").classList.toggle("is-urgent", seconds <= 3);
  $("timer-fill").style.width = `${remaining / (game.timeLimit * 1000) * 100}%`;
  if (remaining === 0) finishQuestion(null, false, true);
}

function startQuestionTimer() {
  $("question-timer").hidden = game.timeLimit === 0;
  $("question-timer").classList.remove("is-urgent", "is-stopped");
  if (game.timeLimit === 0) return;
  // A deadline, rather than tick counting, keeps throttled tabs and late clicks honest.
  game.deadline = performance.now() + game.timeLimit * 1000;
  updateQuestionTimer();
  questionTimerId = window.setInterval(updateQuestionTimer, 100);
}

function renderQuestion() {
  stopQuestionTimer();
  game.deadline = null;
  game.answered = false;
  const question = game.questions[game.index];
  const team = game.teams[game.index % game.teams.length];
  $("round-label").textContent = `Раунд ${Math.floor(game.index / game.teams.length) + 1} из ${game.rounds}`;
  $("turn-label").textContent = `Отвечает: ${team.name}`;
  $("question-counter").textContent = `${game.index + 1} / ${game.questions.length}`;
  $("question-category").textContent = question.category;
  $("question-difficulty").textContent = DIFFICULTIES[question.difficulty];
  $("question-difficulty").dataset.level = question.difficulty;
  $("question-hint").hidden = Boolean(game.timeLimit);
  renderBackground(question);
  $("question-title").textContent = question.question;
  $("feedback").replaceChildren();
  $("feedback").className = "feedback";
  $("next-question").hidden = true;
  $("next-question").textContent = game.index === game.questions.length - 1 ? "К результатам ↗" : "Дальше →";
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
  updateProgress();
  $("question-title").focus();
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
  game.answered = true;
  game.deadline = null;
  stopQuestionTimer();
  if (game.timeLimit) {
    $("question-timer").classList.add("is-stopped");
    $("question-timer").setAttribute("aria-label", timedOut ? "Время вышло" : "Таймер остановлен");
  }
  const question = game.questions[game.index];
  if (isCorrect) game.teams[game.index % game.teams.length].score += 1;
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
  renderScoreboard();
  updateProgress();
  $("next-question").focus({ preventScroll: true });
}

function showResults() {
  $("result-difficulty").textContent = `Сложность: ${DIFFICULTIES[game.difficulty]} · ${game.timeLimit ? "10 секунд на вопрос" : "Без таймера"}`;
  const ranked = [...game.teams].sort((a, b) => b.score - a.score);
  const winners = ranked.filter((team) => team.score === ranked[0].score);
  if (ranked.length === 1) {
    $("result-summary").textContent = `${ranked[0].name}: ${ranked[0].score} из ${game.rounds}. ${ranked[0].score === game.rounds ? "Идеальная партия!" : "Отличный повод вспомнить любимые серии."}`;
  } else if (winners.length > 1) {
    $("result-summary").textContent = `Ничья! Первое место делят: ${winners.map((team) => team.name).join(", ")}.`;
  } else {
    $("result-summary").textContent = `Побеждает ${winners[0].name}! Сегодня это главное светило нашей компании.`;
  }
  $("results-list").replaceChildren();
  ranked.forEach((team) => {
    const row = document.createElement("div");
    row.className = `result-row${team.score === ranked[0].score ? " winner" : ""}`;
    const place = document.createElement("span");
    place.className = "result-place";
    place.textContent = `${ranked.findIndex((entry) => entry.score === team.score) + 1}`.padStart(2, "0");
    const name = document.createElement("strong");
    name.textContent = team.name;
    const score = document.createElement("span");
    score.textContent = `${team.score} / ${game.rounds}`;
    row.append(place, name, score);
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
  teamInputs.lastElementChild.querySelector("input").focus();
});
$("remove-team").addEventListener("click", () => {
  if (teamInputs.children.length > 1) teamInputs.lastElementChild.remove();
  updateTeamControls();
});
$("setup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const inputs = [...teamInputs.querySelectorAll("input")];
  const seen = new Set();
  for (const input of inputs) {
    const name = input.value.trim();
    const key = name.toLocaleLowerCase("ru");
    input.setCustomValidity(!name ? "Введите название команды." : seen.has(key) ? "Названия команд должны отличаться." : "");
    if (!input.reportValidity()) return;
    seen.add(key);
  }
  const settings = new FormData(event.currentTarget);
  const rounds = Number(settings.get("rounds"));
  startGame(inputs.map((input) => input.value.trim()), rounds, settings.get("difficulty"), Number(settings.get("time-limit")));
});
$("next-question").addEventListener("click", () => {
  if (!game.answered) return;
  if (game.index === game.questions.length - 1) {
    showResults();
  } else {
    game.index += 1;
    renderQuestion();
  }
});
$("leave-game").addEventListener("click", () => {
  if (window.confirm("Вернуться к настройкам? Счёт текущей партии не сохранится.")) {
    returnToSetup();
  } else {
    updateQuestionTimer();
  }
});
$("play-again").addEventListener("click", () => startGame(game.teams.map((team) => team.name), game.rounds, game.difficulty, game.timeLimit));
$("change-settings").addEventListener("click", returnToSetup);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updateQuestionTimer();
});

function updateQuestionBankInfo() {
  const difficulty = new FormData($("setup-form")).get("difficulty");
  const count = QUESTIONS.filter((question) => difficulty === "mixed" || question.difficulty === difficulty).length;
  $("question-bank-info").textContent = `Вопросов в этом режиме: ${count}. В пределах партии вопросы не повторяются.`;
}

$("setup-form").addEventListener("change", updateQuestionBankInfo);
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

updateQuestionBankInfo();
addTeam();
addTeam();
