const TEAM_DATA = [
  ["ATL", "Atlanta Skyliners"],
  ["BOS", "Boston Foundry"],
  ["BKN", "Brooklyn Voltage"],
  ["CHA", "Charlotte Crown"],
  ["CHI", "Chicago Forge"],
  ["CLE", "Cleveland Comets"],
  ["DAL", "Dallas Outriders"],
  ["DEN", "Denver Peaks"],
  ["DET", "Detroit Motors"],
  ["GSW", "Golden State Harbor"],
  ["HOU", "Houston Cosmos"],
  ["IND", "Indiana Circuit"],
  ["LAC", "Los Angeles Quakes"],
  ["LAL", "Los Angeles Royals"],
  ["MEM", "Memphis Signal"],
  ["MIA", "Miami Tide"],
  ["MIL", "Milwaukee Northstars"],
  ["MIN", "Minnesota Frost"],
  ["NOP", "New Orleans Drift"],
  ["NYK", "New York Empire"],
  ["OKC", "Oklahoma City Horizon"],
  ["ORL", "Orlando Pulse"],
  ["PHI", "Philadelphia Founders"],
  ["PHX", "Phoenix Sol"],
  ["POR", "Portland Timberline"],
  ["SAC", "Sacramento Gold"],
  ["SAS", "San Antonio Armada"],
  ["TOR", "Toronto Beacon"],
  ["UTA", "Utah Canyon"],
  ["WAS", "Washington District"],
].map(([abbr, name], i) => ({ id: i, abbr, name }));

const DEFAULT_RULES = {
  salaryCap: 154.647,
  minSalary: 139.182,
  taxLine: 187.895,
  firstApron: 195.945,
  secondApron: 207.824,
  taxBracket: 5.685,
  ntmle: 14.104,
  tmle: 5.685,
  roomException: 8.781,
};

const RULE_FIELDS = [
  ["salaryCap", "Salary Cap ($M)"],
  ["minSalary", "Minimum Team Salary ($M)"],
  ["taxLine", "Luxury Tax Line ($M)"],
  ["firstApron", "First Apron ($M)"],
  ["secondApron", "Second Apron ($M)"],
  ["taxBracket", "Tax Bracket Size ($M)"],
  ["ntmle", "Non-Taxpayer MLE ($M)"],
  ["tmle", "Taxpayer MLE ($M)"],
  ["roomException", "Room Exception ($M)"],
];

const state = {
  mode: "draft",
  setupStep: 1,
  playerSource: {
    type: "random",
    label: "Generated 500 random players/contracts.",
    players: [],
  },
  userTeamId: 0,
  rosterSize: 10,
  view: "dashboard",
  selectedRosterTeamId: 0,
  rules: { ...DEFAULT_RULES },
  repeaterMode: false,
  draft: {
    started: false,
    complete: false,
    paused: false,
    pickNo: 0,
    order: [],
    cpuPickTimer: null,
    countdownTimer: null,
    cpuPickDeadline: null,
    notifiedPickNo: null,
    pool: [],
    log: [],
    search: "",
  },
  manual: {
    active: false,
    pool: [],
    assignTeamId: 0,
    log: [],
  },
  teams: [],
};

const el = {
  setupSteps: document.querySelector("#setup-steps"),
  userTeam: document.querySelector("#user-team"),
  rosterSize: document.querySelector("#roster-size"),
  repeaterMode: document.querySelector("#repeater-mode"),
  rulesGrid: document.querySelector("#rules-grid"),
  playerFile: document.querySelector("#player-file"),
  randomPlayerCount: document.querySelector("#random-player-count"),
  randomizePlayers: document.querySelector("#randomize-players-btn"),
  playerSourceStatus: document.querySelector("#player-source-status"),
  lockedSettings: document.querySelector("#locked-settings"),
  startDraft: document.querySelector("#start-draft-btn"),
  startManual: document.querySelector("#start-manual-btn"),
  reset: document.querySelector("#reset-btn"),
  statePill: document.querySelector("#draft-state-pill"),
  currentPick: document.querySelector("#current-pick"),
  poolCount: document.querySelector("#pool-count"),
  lastPick: document.querySelector("#last-pick"),
  playerSearch: document.querySelector("#player-search"),
  manualControls: document.querySelector("#manual-controls"),
  assignTeam: document.querySelector("#assign-team"),
  playerPool: document.querySelector("#player-pool"),
  userRoster: document.querySelector("#user-roster"),
  pickLog: document.querySelector("#pick-log"),
  teamTableWrap: document.querySelector("#team-table-wrap"),
  setupPanel: document.querySelector("#setup-panel"),
  draftPanel: document.querySelector("#draft-panel"),
  resultsPanel: document.querySelector("#results-panel"),
  rosterPanel: document.querySelector("#roster-panel"),
  rosterTeamTitle: document.querySelector("#roster-team-title"),
  rosterMeta1: document.querySelector("#roster-meta-1"),
  rosterMeta2: document.querySelector("#roster-meta-2"),
  rosterMeta3: document.querySelector("#roster-meta-3"),
  rosterList: document.querySelector("#current-roster-list"),
  backToDashboard: document.querySelector("#back-to-dashboard-btn"),
  onClockModal: document.querySelector("#on-clock-modal"),
  onClockCopy: document.querySelector("#on-clock-copy"),
  closeOnClockModal: document.querySelector("#close-on-clock-modal"),
};

function parsePlayersJson(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("JSON must be an array of player objects.");
  return normalizePlayers(parsed);
}

function parsePlayersCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV must include a header and at least one row.");
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
  return normalizePlayers(rows);
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function normalizePlayers(rows) {
  const output = [];
  let id = 1;
  rows.forEach((raw) => {
    const name = String(raw.name ?? raw.player ?? "").trim();
    if (!name) return;
    const originTeam = String(raw.originteam ?? raw.origin_team ?? raw.team ?? "FA")
      .trim()
      .toUpperCase() || "FA";
    const pos = String(raw.pos ?? raw.position ?? "F").trim() || "F";
    const salary = Number(raw.salary ?? raw.salarym ?? raw.salary_m ?? raw.annualsalary);
    if (!Number.isFinite(salary) || salary <= 0) return;
    const yearsRaw = Number(raw.years ?? raw.yearsremaining ?? raw.years_remaining ?? 1);
    const years = clamp(Math.round(yearsRaw || 1), 1, 6);
    const valueRaw = Number(raw.value);
    output.push({
      id: id++,
      name,
      originTeam,
      pos,
      salary: Number(salary.toFixed(3)),
      years,
      value: Number.isFinite(valueRaw) ? valueRaw : salary * 1.45 + years * 1.7,
      generated: false,
    });
  });
  return output;
}

function generateRandomPlayers(count) {
  const firstNames = [
    "Jalen","Marcus","Tyrese","Darius","Jabari","Cam","Kobe","Zion","Paolo","Luka","Jaden","Jalen","Max","Scottie","Mikal","Shai","Devin","Malik","Donovan","Jrue","Bam","Jaren","Anfernee","Cade","Evan","Keegan","Amen","Ausar"
  ];
  const lastNames = [
    "Carter","Jackson","Williams","Johnson","Brown","Robinson","Miller","Davis","Wilson","Moore","Anderson","Thomas","White","Harris","Martin","Thompson","Lewis","Walker","Young","Allen","King","Wright","Scott","Green","Brooks","Edwards","Mitchell","Parker"
  ];
  const posList = ["PG", "SG", "SF", "PF", "C", "G/F", "F/C"];
  const players = [];
  for (let i = 1; i <= count; i += 1) {
    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    const origin = TEAM_DATA[Math.floor(Math.random() * TEAM_DATA.length)].abbr;
    const pos = posList[Math.floor(Math.random() * posList.length)];
    const tier = Math.random();
    let salary = 2 + Math.random() * 8;
    if (tier > 0.72) salary = 10 + Math.random() * 18;
    if (tier > 0.9) salary = 28 + Math.random() * 22;
    if (tier > 0.97) salary = 52 + Math.random() * 10;
    const years = 1 + Math.floor(Math.random() * 5);
    players.push({
      id: i,
      name: `${first} ${last} ${i}`,
      originTeam: origin,
      pos,
      salary: Number(salary.toFixed(3)),
      years,
      value: Number((salary * (1.2 + Math.random() * 0.6) + years).toFixed(3)),
      generated: true,
    });
  }
  return players.sort((a, b) => b.value - a.value);
}

function init() {
  state.playerSource.players = generateRandomPlayers(500);
  renderTeamPicker();
  renderAssignTeamPicker();
  renderRules();
  bindEvents();
  rebuildTeams();
  renderAll();
}

function setSetupStep(step) {
  state.setupStep = Math.round(clamp(step, 1, 4));
  renderSetupSteps();
}

function renderTeamPicker() {
  el.userTeam.innerHTML = TEAM_DATA.map(
    (team) => `<option value="${team.id}">${team.name} (${team.abbr})</option>`
  ).join("");
  el.userTeam.value = String(state.userTeamId);
}

function renderRules() {
  el.rulesGrid.innerHTML = RULE_FIELDS.map(
    ([key, label]) => `
      <label>
        ${label}
        <input type="number" step="0.001" min="0" data-rule="${key}" value="${state.rules[key]}" />
      </label>
    `
  ).join("");
}

function renderAssignTeamPicker() {
  el.assignTeam.innerHTML = TEAM_DATA.map(
    (team) => `<option value="${team.id}">${team.name} (${team.abbr})</option>`
  ).join("");
  el.assignTeam.value = String(state.manual.assignTeamId || state.userTeamId);
}

function isSessionLocked() {
  return state.draft.started || state.manual.active;
}

function activePlayerPool() {
  if (state.playerSource.type === "custom" || state.playerSource.type === "random") {
    return clonePlayers(state.playerSource.players);
  }
  return generateRandomPlayers(500);
}

function clonePlayers(players) {
  return players.map((player) => ({ ...player }));
}

function bindEvents() {
  el.setupPanel.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const stepButton = target.closest("[data-setup-step]");
    if (stepButton instanceof HTMLButtonElement && !isSessionLocked()) {
      const nextStep = Number(stepButton.dataset.setupStep);
      setSetupStep(nextStep);
      return;
    }
    const stepAction = target.closest("[data-step-action]");
    if (stepAction instanceof HTMLButtonElement && !isSessionLocked()) {
      const action = stepAction.dataset.stepAction;
      if (action === "next") setSetupStep(state.setupStep + 1);
      if (action === "prev") setSetupStep(state.setupStep - 1);
    }
  });

  el.userTeam.addEventListener("change", () => {
    state.userTeamId = Number(el.userTeam.value);
    if (!isSessionLocked()) {
      state.manual.assignTeamId = state.userTeamId;
      renderAssignTeamPicker();
    }
    renderAll();
  });

  el.rosterSize.addEventListener("change", () => {
    state.rosterSize = clamp(Number(el.rosterSize.value), 5, 15);
    el.rosterSize.value = String(state.rosterSize);
  });

  el.repeaterMode.addEventListener("change", () => {
    state.repeaterMode = el.repeaterMode.checked;
  });

  el.playerSearch.addEventListener("input", () => {
    state.draft.search = el.playerSearch.value.trim().toLowerCase();
    renderPlayerPool();
  });

  el.assignTeam.addEventListener("change", () => {
    state.manual.assignTeamId = Number(el.assignTeam.value);
  });

  el.playerFile.addEventListener("change", async () => {
    if (isSessionLocked()) return;
    const file = el.playerFile.files && el.playerFile.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      let players = [];
      if (ext === "json") players = parsePlayersJson(text);
      else if (ext === "csv") players = parsePlayersCsv(text);
      else throw new Error("Unsupported file type. Use JSON or CSV.");
      if (players.length === 0) throw new Error("No valid players found in file.");
      state.playerSource = {
        type: "custom",
        label: `Imported ${players.length} players from ${file.name}.`,
        players,
      };
      renderAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed.";
      state.playerSourceStatus.textContent = `Import failed: ${msg}`;
    } finally {
      el.playerFile.value = "";
    }
  });

  el.randomizePlayers.addEventListener("click", () => {
    if (isSessionLocked()) return;
    const count = clamp(Number(el.randomPlayerCount.value), 60, 1500);
    el.randomPlayerCount.value = String(count);
    const players = generateRandomPlayers(count);
    state.playerSource = {
      type: "random",
      label: `Generated ${players.length} random players/contracts.`,
      players,
    };
    renderAll();
  });

  el.rulesGrid.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const key = target.dataset.rule;
    if (!key) return;
    const next = Number(target.value);
    if (Number.isFinite(next) && next >= 0) {
      state.rules[key] = next;
      recomputeAllTeams();
      renderTeamTable();
    }
  });

  el.startDraft.addEventListener("click", () => handleDraftControl("draft"));
  el.startManual.addEventListener("click", () => handleDraftControl("manual"));
  el.reset.addEventListener("click", resetSession);
  el.backToDashboard.addEventListener("click", () => setView("dashboard"));
  el.closeOnClockModal.addEventListener("click", hideOnClockModal);
  el.onClockModal.addEventListener("click", (event) => {
    if (event.target === el.onClockModal) hideOnClockModal();
  });

  el.playerPool.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const playerId = Number(target.dataset.playerId);
    if (!playerId) return;
    if (state.manual.active) {
      assignManualPlayer(playerId);
      return;
    }
    const current = currentTeamOnClock();
    if (!current || current.id !== state.userTeamId || state.draft.paused) return;
    const player = state.draft.pool.find((p) => p.id === playerId);
    if (!player) return;
    draftPlayer(player);
  });

  el.rosterList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const playerId = Number(target.dataset.removePlayerId);
    const teamId = Number(target.dataset.teamId);
    if (!state.manual.active || !Number.isFinite(playerId) || !Number.isFinite(teamId)) return;
    removeManualPlayer(teamId, playerId);
  });

  el.teamTableWrap.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const teamButton = target.closest("button[data-team-id]");
    if (!(teamButton instanceof HTMLButtonElement)) return;
    const teamId = Number(teamButton.dataset.teamId);
    if (!Number.isFinite(teamId)) return;
    openRosterPage(teamId);
  });
}

function handleDraftControl(mode) {
  if (!isSessionLocked()) {
    state.mode = mode === "manual" ? "manual" : "draft";
    if (mode === "manual") startManualMode();
    else startDraft();
    return;
  }
  if (mode === "manual") return;
  if (state.manual.active) return;
  if (state.draft.complete) return;
  togglePauseDraft();
}

function rebuildTeams() {
  state.teams = TEAM_DATA.map((team) => ({
    ...team,
    roster: [],
    salary: 0,
    taxBill: 0,
    totalCost: 0,
    capDelta: 0,
    floorGap: 0,
    status: "Under Cap",
    restrictions: ["Room Exception"],
  }));
}

function buildSnakeOrder(teamCount, rounds) {
  const order = [];
  for (let r = 0; r < rounds; r += 1) {
    if (r % 2 === 0) {
      for (let t = 0; t < teamCount; t += 1) order.push(t);
    } else {
      for (let t = teamCount - 1; t >= 0; t -= 1) order.push(t);
    }
  }
  return order;
}

function startDraft() {
  clearDraftTimers();
  hideOnClockModal();
  state.manual.active = false;
  state.manual.pool = [];
  state.manual.log = [];
  rebuildTeams();
  state.draft.started = true;
  state.draft.complete = false;
  state.draft.paused = false;
  state.draft.pickNo = 0;
  state.draft.log = [];
  state.draft.cpuPickDeadline = null;
  state.draft.notifiedPickNo = null;
  state.repeaterMode = el.repeaterMode.checked;
  state.userTeamId = Number(el.userTeam.value);
  state.selectedRosterTeamId = state.userTeamId;
  state.rosterSize = clamp(Number(el.rosterSize.value), 5, 15);
  state.draft.order = buildSnakeOrder(state.teams.length, state.rosterSize);
  state.rules = collectRules();
  state.draft.pool = activePlayerPool();

  const needed = state.teams.length * state.rosterSize;
  if (state.draft.pool.length < needed) {
    let placeholder = 1;
    while (state.draft.pool.length < needed) {
      state.draft.pool.push({
        id: 100000 + placeholder,
        name: `Minimum FA ${placeholder}`,
        originTeam: "FA",
        pos: ["G", "F", "C"][placeholder % 3],
        salary: 2.296,
        years: 1,
        value: 1,
        generated: true,
      });
      placeholder += 1;
    }
  }

  state.draft.pool.sort((a, b) => b.value - a.value);
  renderAll();
  scheduleCpuAutoPick();
}

function startManualMode() {
  clearDraftTimers();
  hideOnClockModal();
  state.draft.started = false;
  state.draft.complete = false;
  state.draft.paused = false;
  state.draft.pickNo = 0;
  state.draft.pool = [];
  state.draft.log = [];
  state.draft.notifiedPickNo = null;
  rebuildTeams();
  state.manual.active = true;
  state.manual.pool = activePlayerPool().sort((a, b) => b.value - a.value);
  state.manual.log = [];
  state.userTeamId = Number(el.userTeam.value);
  state.selectedRosterTeamId = state.userTeamId;
  state.manual.assignTeamId = state.userTeamId;
  state.repeaterMode = el.repeaterMode.checked;
  state.rules = collectRules();
  renderAssignTeamPicker();
  recomputeAllTeams();
  renderAll();
}

function collectRules() {
  const next = { ...DEFAULT_RULES };
  const inputs = el.rulesGrid.querySelectorAll("input[data-rule]");
  inputs.forEach((input) => {
    const key = input.dataset.rule;
    const num = Number(input.value);
    if (key && Number.isFinite(num) && num >= 0) next[key] = num;
  });
  return next;
}

function resetSession() {
  clearDraftTimers();
  hideOnClockModal();
  state.mode = "draft";
  state.setupStep = 1;
  state.playerSource = {
    type: "random",
    label: "Generated 500 random players/contracts.",
    players: generateRandomPlayers(500),
  };
  state.rules = { ...DEFAULT_RULES };
  state.rosterSize = 10;
  state.userTeamId = 0;
  state.selectedRosterTeamId = 0;
  state.view = "dashboard";
  state.repeaterMode = false;
  state.draft = {
    started: false,
    complete: false,
    paused: false,
    pickNo: 0,
    order: [],
    cpuPickTimer: null,
    countdownTimer: null,
    cpuPickDeadline: null,
    notifiedPickNo: null,
    pool: [],
    log: [],
    search: "",
  };
  state.manual = {
    active: false,
    pool: [],
    assignTeamId: 0,
    log: [],
  };
  renderTeamPicker();
  renderAssignTeamPicker();
  renderRules();
  rebuildTeams();
  renderAll();
}

function currentTeamOnClock() {
  if (!state.draft.started || state.draft.complete) return null;
  const teamIdx = state.draft.order[state.draft.pickNo];
  if (teamIdx === undefined) return null;
  return state.teams[teamIdx] || null;
}

function runSinglePick() {
  if (!state.draft.started || state.draft.complete || state.draft.paused) return;
  const team = currentTeamOnClock();
  if (!team) return;
  if (team.id === state.userTeamId) return;
  const choice = choosePlayerForTeam(team);
  if (!choice) {
    state.draft.complete = true;
    clearDraftTimers();
    renderAll();
    return;
  }
  draftPlayer(choice);
}

function choosePlayerForTeam(team) {
  if (state.draft.pool.length === 0) return null;
  const rules = state.rules;
  const remainingForTeam =
    state.rosterSize - team.roster.length > 0 ? state.rosterSize - team.roster.length : 0;
  const projectedFloorGap = Math.max(0, rules.minSalary - team.salary);
  const mustSpend = projectedFloorGap > remainingForTeam * 8;
  const candidates = state.draft.pool.slice(0, 40);

  let best = candidates[0];
  let bestScore = -Infinity;

  candidates.forEach((player) => {
    const projectedSalary = team.salary + player.salary;
    let score = player.value + Math.random() * 0.4;

    if (mustSpend) score += player.salary * 0.45;
    if (projectedSalary > rules.secondApron) score -= 22;
    else if (projectedSalary > rules.firstApron) score -= 10;
    else if (projectedSalary > rules.taxLine) score -= 3;

    if (score > bestScore) {
      best = player;
      bestScore = score;
    }
  });

  return best;
}

function draftPlayer(player) {
  if (state.draft.paused) return;
  hideOnClockModal();
  const team = currentTeamOnClock();
  if (!team) return;

  team.roster.push(player);
  state.draft.pool = state.draft.pool.filter((p) => p.id !== player.id);

  const round = Math.floor(state.draft.pickNo / state.teams.length) + 1;
  const pickInRound = (state.draft.pickNo % state.teams.length) + 1;
  const entry = {
    overall: state.draft.pickNo + 1,
    round,
    pickInRound,
    teamAbbr: team.abbr,
    player: player.name,
    salary: player.salary,
  };
  state.draft.log.unshift(entry);

  state.draft.pickNo += 1;
  if (state.draft.pickNo >= state.draft.order.length) {
    state.draft.complete = true;
    clearDraftTimers();
  }

  recomputeAllTeams();
  renderAll();
  scheduleCpuAutoPick();
}

function recomputeAllTeams() {
  state.teams.forEach((team) => {
    const salary = team.roster.reduce((sum, p) => sum + p.salary, 0);
    const overTax = Math.max(0, salary - state.rules.taxLine);
    const taxBill = calcLuxuryTax(overTax, state.rules.taxBracket, state.repeaterMode);

    team.salary = salary;
    team.taxBill = taxBill;
    team.totalCost = salary + taxBill;
    team.capDelta = state.rules.salaryCap - salary;
    team.floorGap = Math.max(0, state.rules.minSalary - salary);

    if (salary <= state.rules.salaryCap) {
      team.status = "Under Cap";
      team.restrictions = [
        `Cap Space: ${fmtMoney(team.capDelta)}`,
        `Room Exception: ${fmtMoney(state.rules.roomException)}`,
      ];
    } else if (salary <= state.rules.taxLine) {
      team.status = "Over Cap";
      team.restrictions = [
        "No room exception",
        `Non-taxpayer MLE: ${fmtMoney(state.rules.ntmle)}`,
      ];
    } else if (salary <= state.rules.firstApron) {
      team.status = "Tax Team";
      team.restrictions = [
        `Luxury Tax Due: ${fmtMoney(team.taxBill)}`,
        `Taxpayer MLE: ${fmtMoney(state.rules.tmle)}`,
      ];
    } else if (salary <= state.rules.secondApron) {
      team.status = "1st Apron";
      team.restrictions = [
        "No incoming sign-and-trade",
        "Buyout market restrictions",
      ];
    } else {
      team.status = "2nd Apron";
      team.restrictions = [
        "No MLE access",
        "Trade-matching + aggregation limits",
      ];
    }
  });
}

function calcLuxuryTax(overTaxM, bracketM, repeater) {
  if (overTaxM <= 0) return 0;
  const baseRates = repeater ? [3.0, 3.25, 5.5, 6.75] : [1.0, 1.25, 3.5, 4.75];

  let remaining = overTaxM;
  let idx = 0;
  let tax = 0;

  while (remaining > 0) {
    const chunk = Math.min(remaining, bracketM);
    const rate = idx < baseRates.length ? baseRates[idx] : baseRates[3] + (idx - 3) * 0.5;
    tax += chunk * rate;
    remaining -= chunk;
    idx += 1;
  }

  return tax;
}

function clearDraftTimers() {
  if (state.draft.cpuPickTimer) {
    clearTimeout(state.draft.cpuPickTimer);
    state.draft.cpuPickTimer = null;
  }
  if (state.draft.countdownTimer) {
    clearInterval(state.draft.countdownTimer);
    state.draft.countdownTimer = null;
  }
  state.draft.cpuPickDeadline = null;
}

function togglePauseDraft() {
  state.draft.paused = !state.draft.paused;
  if (state.draft.paused) {
    clearDraftTimers();
    hideOnClockModal();
  } else {
    scheduleCpuAutoPick();
  }
  renderAll();
}

function scheduleCpuAutoPick() {
  clearDraftTimers();
  if (!state.draft.started || state.draft.complete || state.draft.paused) return;
  const onClock = currentTeamOnClock();
  if (!onClock || onClock.id === state.userTeamId) return;

  state.draft.cpuPickDeadline = Date.now() + 3000;
  state.draft.countdownTimer = setInterval(() => {
    renderDraftStatus();
  }, 250);
  state.draft.cpuPickTimer = setTimeout(() => {
    runSinglePick();
  }, 3000);
}

function renderAll() {
  renderSetupSteps();
  renderSetupLockState();
  renderModePanels();
  renderDraftStatus();
  renderPlayerPool();
  renderUserRoster();
  renderPickLog();
  renderTeamTable();
  renderCurrentRosterPage();
  renderDraftControlLabel();
  maybeNotifyUserOnClock();
  renderView();
}

function renderModePanels() {
  const manual = state.manual.active;
  el.manualControls.classList.toggle("hidden", !manual);
  if (manual) {
    el.assignTeam.value = String(state.manual.assignTeamId || state.userTeamId);
  }
  el.playerSourceStatus.textContent = state.playerSource.label;
}

function renderSetupSteps() {
  const locked = isSessionLocked();
  const stepPanels = document.querySelectorAll(".setup-step");
  const stepButtons = document.querySelectorAll("[data-setup-step]");
  el.setupSteps.classList.toggle("hidden", locked);

  stepButtons.forEach((btn) => {
    const step = Number(btn.dataset.setupStep);
    btn.classList.toggle("active", step === state.setupStep);
    btn.disabled = locked;
  });

  stepPanels.forEach((panel) => {
    const step = Number(panel.dataset.step);
    panel.classList.toggle("hidden", locked || step !== state.setupStep);
  });
}

function renderSetupLockState() {
  const locked = isSessionLocked();
  el.lockedSettings.classList.toggle("hidden", !locked);
  if (!locked) return;

  const userTeam = state.teams[state.userTeamId];
  const rows = [
    ["Mode", state.manual.active ? "Manual Assignment" : "Draft"],
    ["Player source", state.playerSource.label],
    ["Franchise", userTeam ? `${userTeam.name} (${userTeam.abbr})` : "-"],
    ["Roster spots", String(state.rosterSize)],
    ["Repeater mode", state.repeaterMode ? "On" : "Off"],
    ["Salary cap", fmtMoney(state.rules.salaryCap)],
    ["Salary floor", fmtMoney(state.rules.minSalary)],
    ["Tax line", fmtMoney(state.rules.taxLine)],
    ["First apron", fmtMoney(state.rules.firstApron)],
    ["Second apron", fmtMoney(state.rules.secondApron)],
  ];
  el.lockedSettings.innerHTML = rows
    .map(
      ([label, value]) => `
      <div class="locked-row">
        <strong>${label}</strong>
        <span>${value}</span>
      </div>
    `
    )
    .join("");
}

function renderDraftControlLabel() {
  if (!isSessionLocked()) {
    el.startDraft.textContent = "Start Draft";
    el.startDraft.disabled = false;
    el.startManual.textContent = "Start Manual Assign";
    el.startManual.disabled = false;
    el.startManual.classList.remove("hidden");
    return;
  }
  if (state.manual.active) {
    el.startDraft.textContent = "Manual Mode Active";
    el.startDraft.disabled = true;
    el.startManual.classList.add("hidden");
    return;
  }
  if (state.draft.complete) {
    el.startDraft.textContent = "Draft Complete";
    el.startDraft.disabled = true;
    el.startManual.classList.add("hidden");
    return;
  }
  el.startDraft.disabled = false;
  el.startDraft.textContent = state.draft.paused ? "Resume Draft" : "Pause Draft";
  el.startManual.classList.add("hidden");
}

function setView(nextView) {
  state.view = nextView;
  renderView();
}

function openRosterPage(teamId) {
  state.selectedRosterTeamId = teamId;
  renderCurrentRosterPage();
  setView("roster");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderView() {
  const showRoster = state.view === "roster";
  el.setupPanel.classList.toggle("hidden", showRoster);
  el.draftPanel.classList.toggle("hidden", showRoster);
  el.resultsPanel.classList.toggle("hidden", showRoster);
  el.rosterPanel.classList.toggle("hidden", !showRoster);
}

function renderCurrentRosterPage() {
  const team =
    state.teams.find((item) => item.id === state.selectedRosterTeamId) ||
    state.teams[state.userTeamId] ||
    state.teams[0];
  if (!team) return;

  const isUser = team.id === state.userTeamId;
  el.rosterTeamTitle.textContent = `Current Roster: ${team.name} (${team.abbr})${
    isUser ? " - Your Team" : ""
  }`;
  el.rosterMeta1.textContent = `Team status: ${team.status}`;
  el.rosterMeta2.textContent = `Payroll: ${fmtMoney(team.salary)} | Cap Delta: ${
    team.capDelta >= 0 ? "Cap Space " : "Over Cap "
  }${fmtMoney(Math.abs(team.capDelta))}`;
  el.rosterMeta3.textContent = `Tax bill: ${fmtMoney(team.taxBill)} | Total spend: ${fmtMoney(team.totalCost)}`;

  if (team.roster.length === 0) {
    el.rosterList.innerHTML = `<p class="muted">${
      state.manual.active ? "No players assigned yet for this team." : "No players drafted yet for this team."
    }</p>`;
    return;
  }

  const rows = [...team.roster]
    .sort((a, b) => b.salary - a.salary)
    .map(
      (player, idx) => `
      <div class="item-pick">
        <span>${idx + 1}. ${player.name} (${player.pos})</span>
        <span>
          <strong>${fmtMoney(player.salary)}</strong>
          ${
            state.manual.active
              ? `<button class="btn secondary" data-team-id="${team.id}" data-remove-player-id="${player.id}">Remove</button>`
              : ""
          }
        </span>
      </div>
    `
    )
    .join("");
  el.rosterList.innerHTML = rows;
}

function assignManualPlayer(playerId) {
  if (!state.manual.active) return;
  const team = state.teams[state.manual.assignTeamId];
  if (!team) return;
  const player = state.manual.pool.find((p) => p.id === playerId);
  if (!player) return;

  team.roster.push(player);
  state.manual.pool = state.manual.pool.filter((p) => p.id !== playerId);
  state.manual.log.unshift({
    player: player.name,
    teamAbbr: team.abbr,
    salary: player.salary,
  });
  recomputeAllTeams();
  renderAll();
}

function removeManualPlayer(teamId, playerId) {
  if (!state.manual.active) return;
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) return;
  const index = team.roster.findIndex((p) => p.id === playerId);
  if (index === -1) return;
  const [player] = team.roster.splice(index, 1);
  state.manual.pool.push(player);
  state.manual.pool.sort((a, b) => b.value - a.value);
  state.manual.log.unshift({
    player: `${player.name} (removed)`,
    teamAbbr: team.abbr,
    salary: player.salary,
  });
  recomputeAllTeams();
  renderAll();
}

function renderDraftStatus() {
  if (state.manual.active) {
    el.statePill.textContent = "Manual assignment mode";
    el.statePill.className = "pill neutral";
    el.currentPick.textContent = "Manual mode: assign players to any team.";
    el.poolCount.textContent = `Unassigned players: ${state.manual.pool.length}`;
    const lastManual = state.manual.log[0];
    el.lastPick.textContent = lastManual
      ? `Last assignment: ${lastManual.player} -> ${lastManual.teamAbbr}`
      : "Last assignment: -";
    return;
  }

  const onClock = currentTeamOnClock();
  if (!state.draft.started) {
    el.statePill.textContent = "Not started";
    el.statePill.className = "pill neutral";
    el.currentPick.textContent = "Current pick: -";
    el.poolCount.textContent = "Free-agent pool: -";
    el.lastPick.textContent = "Last pick: -";
    return;
  }

  if (state.draft.complete) {
    el.statePill.textContent = "Draft complete";
    el.statePill.className = "pill";
  } else if (state.draft.paused) {
    el.statePill.textContent = "Draft paused";
    el.statePill.className = "pill";
  } else if (onClock && onClock.id === state.userTeamId) {
    el.statePill.textContent = "You are on the clock";
    el.statePill.className = "pill neutral";
  } else {
    el.statePill.textContent = `${onClock ? onClock.abbr : "-"} on the clock`;
    el.statePill.className = "pill";
  }

  const round = Math.floor(state.draft.pickNo / state.teams.length) + 1;
  const inRound = (state.draft.pickNo % state.teams.length) + 1;
  const cpuCountdown =
    onClock &&
    onClock.id !== state.userTeamId &&
    state.draft.cpuPickDeadline &&
    !state.draft.paused &&
    !state.draft.complete
      ? Math.max(0, Math.ceil((state.draft.cpuPickDeadline - Date.now()) / 1000))
      : null;
  el.currentPick.textContent = state.draft.complete
    ? `Draft complete: ${state.draft.order.length} picks made`
    : `Current pick: #${state.draft.pickNo + 1} (Round ${round}, Pick ${inRound}) - ${
        onClock ? onClock.name : "-"
      }${cpuCountdown !== null ? ` | Auto-pick in ${cpuCountdown}s` : ""}`;

  el.poolCount.textContent = `Free-agent pool: ${state.draft.pool.length}`;
  const last = state.draft.log[0];
  el.lastPick.textContent = last
    ? `Last pick: #${last.overall} ${last.teamAbbr} selected ${last.player} (${fmtMoney(last.salary)})`
    : "Last pick: -";
}

function renderPlayerPool() {
  if (state.manual.active) {
    const query = state.draft.search;
    const list = state.manual.pool
      .filter((p) => {
        if (!query) return true;
        const hay = `${p.name} ${p.pos} ${p.originTeam}`.toLowerCase();
        return hay.includes(query);
      })
      .slice(0, 140);
    if (list.length === 0) {
      el.playerPool.innerHTML = `<p class="muted">No players match your search.</p>`;
      return;
    }
    el.playerPool.innerHTML = list
      .map(
        (p) => `
        <div class="item">
          <div>
            <strong>${p.name}</strong>
            <div class="muted">${p.pos} | Last: ${p.originTeam} | ${p.years} yr${
              p.years > 1 ? "s" : ""
            }</div>
          </div>
          <div>
            <div><strong>${fmtMoney(p.salary)}</strong></div>
            <button data-player-id="${p.id}">Assign</button>
          </div>
        </div>
      `
      )
      .join("");
    return;
  }

  if (!state.draft.started) {
    el.playerPool.innerHTML = `<p class="muted">Start the draft to load players.</p>`;
    return;
  }

  const onClock = currentTeamOnClock();
  const userOnClock = Boolean(onClock && onClock.id === state.userTeamId && !state.draft.paused);
  const query = state.draft.search;
  const list = state.draft.pool
    .filter((p) => {
      if (!query) return true;
      const hay = `${p.name} ${p.pos} ${p.originTeam}`.toLowerCase();
      return hay.includes(query);
    })
    .slice(0, 140);

  if (list.length === 0) {
    el.playerPool.innerHTML = `<p class="muted">No players match your search.</p>`;
    return;
  }

  el.playerPool.innerHTML = list
    .map(
      (p) => `
      <div class="item">
        <div>
          <strong>${p.name}</strong>
          <div class="muted">${p.pos} | Last: ${p.originTeam} | ${p.years} yr${
            p.years > 1 ? "s" : ""
          }</div>
        </div>
        <div>
          <div><strong>${fmtMoney(p.salary)}</strong></div>
          ${
            userOnClock
              ? `<button data-player-id="${p.id}">Draft</button>`
              : `<span class="muted">${onClock ? `${onClock.abbr} pick` : ""}</span>`
          }
        </div>
      </div>
    `
    )
    .join("");
}

function maybeNotifyUserOnClock() {
  if (state.manual.active) {
    hideOnClockModal();
    return;
  }
  if (!state.draft.started || state.draft.complete || state.draft.paused) {
    hideOnClockModal();
    return;
  }
  const onClock = currentTeamOnClock();
  if (!onClock || onClock.id !== state.userTeamId) {
    hideOnClockModal();
    return;
  }
  if (state.draft.notifiedPickNo === state.draft.pickNo) return;

  state.draft.notifiedPickNo = state.draft.pickNo;
  playDing();
  showOnClockModal();
}

function showOnClockModal() {
  const onClock = currentTeamOnClock();
  const round = Math.floor(state.draft.pickNo / state.teams.length) + 1;
  const inRound = (state.draft.pickNo % state.teams.length) + 1;
  el.onClockCopy.textContent = `Pick #${state.draft.pickNo + 1} (Round ${round}, Pick ${inRound}) is yours${
    onClock ? ` for ${onClock.abbr}` : ""
  }.`;
  el.onClockModal.classList.remove("hidden");
}

function hideOnClockModal() {
  el.onClockModal.classList.add("hidden");
}

function playDing() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.stop(ctx.currentTime + 0.28);
    osc.onended = () => {
      ctx.close();
    };
  } catch (_err) {
    // ignore browser audio failures silently
  }
}

function renderUserRoster() {
  const team = state.teams[state.userTeamId];
  if (!team || team.roster.length === 0) {
    el.userRoster.innerHTML = `<p class="muted">${
      state.manual.active ? "No players assigned yet." : "No picks yet."
    }</p>`;
    return;
  }

  el.userRoster.innerHTML = team.roster
    .map(
      (p) => `
      <div class="item-pick">
        <span>${p.name} (${p.pos})</span>
        <strong>${fmtMoney(p.salary)}</strong>
      </div>
    `
    )
    .join("");
}

function renderPickLog() {
  if (state.manual.active) {
    if (state.manual.log.length === 0) {
      el.pickLog.innerHTML = `<p class="muted">No assignments made yet.</p>`;
      return;
    }
    el.pickLog.innerHTML = state.manual.log
      .slice(0, 100)
      .map(
        (entry) => `
        <div class="item-pick">
          <span>${entry.player} -> ${entry.teamAbbr}</span>
          <strong>${fmtMoney(entry.salary)}</strong>
        </div>
      `
      )
      .join("");
    return;
  }

  if (state.draft.log.length === 0) {
    el.pickLog.innerHTML = `<p class="muted">No picks made yet.</p>`;
    return;
  }

  el.pickLog.innerHTML = state.draft.log
    .slice(0, 100)
    .map(
      (entry) => `
      <div class="item-pick">
        <span>#${entry.overall} ${entry.teamAbbr} - ${entry.player}</span>
        <strong>${fmtMoney(entry.salary)}</strong>
      </div>
    `
    )
    .join("");
}

function renderTeamTable() {
  const sorted = [...state.teams].sort((a, b) => b.totalCost - a.totalCost);

  const rows = sorted
    .map((team, i) => {
      const isUser = team.id === state.userTeamId;
      const statusClass =
        team.status === "Under Cap"
          ? "status-under"
          : team.status === "Over Cap" || team.status === "Tax Team"
            ? "status-tax"
            : team.status === "1st Apron"
              ? "status-apron"
              : "status-second";

      return `
        <tr ${isUser ? "style=\"background:#fff1dd\"" : ""}>
          <td>${i + 1}</td>
          <td class="team-tag"><button class="team-link" data-team-id="${team.id}">${team.name} (${team.abbr})</button> ${isUser ? "<span class='pill'>You</span>" : ""}</td>
          <td>${state.manual.active ? `${team.roster.length}` : `${team.roster.length}/${state.rosterSize}`}</td>
          <td>${fmtMoney(team.salary)}</td>
          <td>${fmtMoney(team.taxBill)}</td>
          <td>${fmtMoney(team.totalCost)}</td>
          <td>${team.capDelta >= 0 ? "Cap Space " : "Over Cap "}${fmtMoney(Math.abs(team.capDelta))}</td>
          <td class="${statusClass}">${team.status}</td>
          <td>${team.restrictions.join(" | ")}</td>
          <td>${team.floorGap > 0 ? fmtMoney(team.floorGap) : "-"}</td>
        </tr>
      `;
    })
    .join("");

  el.teamTableWrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Team</th>
            <th>Players</th>
            <th>Salary</th>
            <th>Tax Bill</th>
            <th>Total Spend</th>
            <th>Cap Delta</th>
            <th>Status</th>
            <th>Restrictions / Exceptions</th>
            <th>Floor Gap</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function fmtMoney(valueM) {
  return `$${valueM.toFixed(3)}M`;
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

init();
