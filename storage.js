function normalizeTeamName(name) {
  return name.trim().toLocaleLowerCase("ru");
}

function averageResponseTime(team) {
  return team.timedAnswers > 0 ? Math.round(team.responseTimeMs / team.timedAnswers) : null;
}

function compareResponseTimes(a, b) {
  const first = averageResponseTime(a);
  const second = averageResponseTime(b);
  if (first === null) return second === null ? 0 : 1;
  if (second === null) return -1;
  return first - second;
}

class QuizStorage {
  static key = "bazinga.quiz.v1";

  constructor(onError = (error) => console.error(error)) {
    if (typeof onError !== "function") {
      throw new TypeError("onError must be a function.");
    }
    this.onError = onError;
    this.data = QuizStorage.defaults();
    let saved;
    try {
      saved = localStorage.getItem(QuizStorage.key);
    } catch (error) {
      this.onError(error);
      return;
    }
    if (saved === null) return;
    let parsed;
    try {
      parsed = JSON.parse(saved);
    } catch (error) {
      this.onError(error);
      return;
    }
    if (!QuizStorage.isValidState(parsed, true)) {
      this.onError(new TypeError("Saved quiz data has an invalid format."));
      return;
    }
    this.data = {
      ...parsed,
      ratings: parsed.ratings.map((rating) => ({ responseTimeMs: 0, timedAnswers: 0, ...rating })),
    };
  }

  static defaults() {
    return {
      teamNames: ["Команда 1", "Команда 2"],
      answeredQuestions: [],
      ratings: [],
    };
  }

  static isCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  static isDraftName(name) {
    return typeof name === "string" && name.length <= 24;
  }

  static isTeamNames(names) {
    return Array.isArray(names) && names.length >= 1 && names.length <= 6
      && Array.from(names).every(QuizStorage.isDraftName);
  }

  static hasFields(value, fields) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).length === fields.length
      && fields.every((field) => Object.hasOwn(value, field));
  }

  static isValidTiming(value) {
    return Object.hasOwn(value, "responseTimeMs") && Object.hasOwn(value, "timedAnswers")
      && QuizStorage.isCount(value.responseTimeMs) && QuizStorage.isCount(value.timedAnswers)
      && (value.timedAnswers > 0 || value.responseTimeMs === 0);
  }

  static isValidState(state, allowLegacy = false) {
    if (!QuizStorage.hasFields(state, ["teamNames", "answeredQuestions", "ratings"])
      || !QuizStorage.isTeamNames(state.teamNames)
      || !Array.isArray(state.answeredQuestions)
      || !state.answeredQuestions.every((text) => typeof text === "string" && text.trim().length > 0)
      || new Set(state.answeredQuestions).size !== state.answeredQuestions.length
      || !Array.isArray(state.ratings)) return false;

    const keys = new Set();
    return state.ratings.every((rating) => {
      const fields = [
        "key", "name", "games", "wins", "draws", "correct", "answered", "points",
      ];
      const legacy = allowLegacy && QuizStorage.hasFields(rating, fields);
      if ((!legacy && (!QuizStorage.hasFields(rating, [...fields, "responseTimeMs", "timedAnswers"])
        || !QuizStorage.isValidTiming(rating) || rating.timedAnswers > rating.answered))
        || !QuizStorage.isDraftName(rating.name)
        || !rating.name.trim()
        || rating.name !== rating.name.trim()
        || rating.key !== normalizeTeamName(rating.name)
        || keys.has(rating.key)
        || !["games", "wins", "draws", "correct", "answered", "points"]
          .every((field) => QuizStorage.isCount(rating[field]))
        || rating.correct > rating.answered
        || rating.wins + rating.draws > rating.games
        || rating.points !== rating.correct + 5 * rating.wins + 2 * rating.draws) return false;
      keys.add(rating.key);
      return true;
    });
  }

  get state() {
    return {
      teamNames: [...this.data.teamNames],
      answeredQuestions: [...this.data.answeredQuestions],
      ratings: this.data.ratings.map((rating) => ({ ...rating })),
    };
  }

  persist() {
    const serialized = JSON.stringify(this.data);
    try {
      localStorage.setItem(QuizStorage.key, serialized);
    } catch (error) {
      this.onError(error);
    }
  }

  saveTeamNames(names) {
    if (!QuizStorage.isTeamNames(names)) {
      throw new TypeError("Expected one to six team names of at most 24 characters.");
    }
    this.data.teamNames = [...names];
    this.persist();
  }

  recordAnswer(questionText) {
    if (typeof questionText !== "string" || !questionText.trim()) {
      throw new TypeError("Expected a nonempty question text.");
    }
    if (this.data.answeredQuestions.includes(questionText)) return;
    this.data.answeredQuestions.push(questionText);
    this.persist();
  }

  recordGame(teams, roundsPerTeam) {
    if (!QuizStorage.isCount(roundsPerTeam) || roundsPerTeam === 0
      || !Array.isArray(teams) || teams.length < 1 || teams.length > 6
      || !Array.from(teams).every((team) => {
        if (team === null || typeof team !== "object") return false;
        const answered = Object.hasOwn(team, "answered") ? team.answered : roundsPerTeam;
        return QuizStorage.isDraftName(team.name) && team.name.trim()
          && QuizStorage.isCount(answered) && answered >= roundsPerTeam
          && QuizStorage.isCount(team.score) && team.score <= answered
          && ((!Object.hasOwn(team, "responseTimeMs") && !Object.hasOwn(team, "timedAnswers"))
            || (QuizStorage.isValidTiming(team) && team.timedAnswers === answered));
      })
      || new Set(teams.map((team) => normalizeTeamName(team.name))).size !== teams.length) {
      throw new TypeError("Expected unique named teams with valid scores, answer counts and timing.");
    }

    const next = this.state;
    const highScore = Math.max(...teams.map((team) => team.score));
    const leaders = teams.filter((team) => team.score === highScore);
    for (const team of teams) {
      const key = normalizeTeamName(team.name);
      let rating = next.ratings.find((entry) => entry.key === key);
      if (!rating) {
        rating = {
          key, name: team.name.trim(), games: 0, wins: 0, draws: 0, correct: 0, answered: 0, points: 0,
          responseTimeMs: 0, timedAnswers: 0,
        };
        next.ratings.push(rating);
      }
      rating.name = team.name.trim();
      rating.games += 1;
      rating.correct += team.score;
      rating.answered += Object.hasOwn(team, "answered") ? team.answered : roundsPerTeam;
      if (Object.hasOwn(team, "timedAnswers")) {
        rating.responseTimeMs += team.responseTimeMs;
        rating.timedAnswers += team.timedAnswers;
      }
      const first = teams.length > 1 && leaders.includes(team);
      if (first && leaders.length === 1) rating.wins += 1;
      if (first && leaders.length > 1) rating.draws += 1;
      rating.points = rating.correct + 5 * rating.wins + 2 * rating.draws;
    }
    if (!QuizStorage.isValidState(next)) {
      throw new TypeError("Game totals exceed the supported integer range.");
    }
    this.data = next;
    this.persist();
  }

  resetRatings() {
    this.data.ratings = [];
    this.persist();
  }

  reset() {
    this.data = QuizStorage.defaults();
    try {
      localStorage.removeItem(QuizStorage.key);
    } catch (error) {
      this.onError(error);
    }
  }
}
