(function () {
  const state = {
    token: "",
    tokenHash: "",
    assignment: null,
    schema: null,
    currentIndex: 0,
    responses: {},
    supabase: null
  };

  const $ = (selector) => document.querySelector(selector);

  function surveyPhase() {
    return state.assignment?.phase || "blind_recovery";
  }

  function isFormulationAb() {
    return surveyPhase() === "formulation_ab";
  }

  function isStoryQualityAb() {
    return surveyPhase() === "story_quality_ab";
  }

  function itemKey(item) {
    return item.formulation_pair_id || item.story_quality_pair_id || item.human_item_id || item.pair_id || item.triage_id || "";
  }

  function showFatal(message) {
    $("#fatal").textContent = message;
    $("#fatal").classList.remove("hidden");
    $("#app").classList.add("hidden");
    $("#saveStatus").textContent = "Error";
  }

  function setStatus(message) {
    $("#saveStatus").textContent = message;
  }

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name) || "";
  }

  async function sha256(text) {
    const encoded = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not load ${path}: HTTP ${response.status}`);
    }
    return response.json();
  }

  function storageKey() {
    return `gfm-human-eval:${state.assignment.assignment_id}:${state.tokenHash}`;
  }

  function loadLocalResponses() {
    try {
      const raw = localStorage.getItem(storageKey());
      state.responses = raw ? JSON.parse(raw) : {};
    } catch {
      state.responses = {};
    }
  }

  function saveLocalResponses() {
    localStorage.setItem(storageKey(), JSON.stringify(state.responses));
    setStatus("Progress saved locally");
    renderProgress();
  }

  function option(value, label) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label || value;
    return opt;
  }

  function fillSelect(select, values, placeholder = "Select") {
    select.innerHTML = "";
    select.appendChild(option("", placeholder));
    values.forEach((value) => select.appendChild(option(value, value)));
  }

  function objectiveOptions() {
    return (state.schema.objective_taxonomy || []).map((row) => ({
      id: row.id,
      label: `${row.id} ${row.name}`
    }));
  }

  function objectiveById(id) {
    return (state.schema.objective_taxonomy || []).find((row) => row.id === id) || null;
  }

  function compactList(values, limit = 4) {
    if (!Array.isArray(values)) return "";
    return values.map((x) => String(x).trim()).filter(Boolean).slice(0, limit);
  }

  function appendHelpList(parent, label, values) {
    const items = Array.isArray(values) ? values.map((x) => String(x).trim()).filter(Boolean) : [];
    if (!items.length) return;
    const section = document.createElement("div");
    section.className = "objectiveHelpSection";
    const heading = document.createElement("strong");
    heading.textContent = label;
    section.appendChild(heading);
    const list = document.createElement("ul");
    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });
    section.appendChild(list);
    parent.appendChild(section);
  }

  function renderObjectiveHelp(card) {
    const select = card.querySelector(".objectiveSelect");
    const help = card.querySelector(".objectiveHelp");
    const row = objectiveById(select.value);
    help.innerHTML = "";
    if (!row) {
      help.textContent = "Select an objective to see its definition, story cues, applicable object levels, and boundary rules.";
      return;
    }
    const cues = row.story_cues || {};
    const title = document.createElement("h4");
    title.textContent = `${row.id} ${row.name}`;
    help.appendChild(title);
    if (row.definition) {
      const definition = document.createElement("p");
      definition.textContent = row.definition;
      help.appendChild(definition);
    }
    appendHelpList(help, "Applicable object levels", row.applicable_objects || []);
    appendHelpList(help, "Positive cues", compactList(cues.positive));
    appendHelpList(help, "Negative cues", compactList(cues.negative));
    appendHelpList(help, "Avoid confusing with", compactList(cues.avoid_phrases, 3));
    appendHelpList(help, "Boundary rules", compactList(row.boundary_rules, 3));
  }

  function objectLevelsForObjective(objectiveId) {
    const row = objectiveById(objectiveId);
    const levels = row?.applicable_objects?.length
      ? row.applicable_objects
      : (state.schema.active_objectives.item_schema.object_level.options || []);
    return Array.from(new Set(levels));
  }

  function refreshObjectLevelSelect(card, preferredValue = "") {
    const objectiveId = card.querySelector(".objectiveSelect").value;
    const select = card.querySelector(".objectLevelSelect");
    const validLevels = objectLevelsForObjective(objectiveId);
    const nextValue = validLevels.includes(preferredValue) ? preferredValue : "";
    fillSelect(select, validLevels);
    select.value = nextValue;
  }

  function fillObjectiveSelect(select) {
    select.innerHTML = "";
    select.appendChild(option("", "Select"));
    objectiveOptions().forEach((row) => select.appendChild(option(row.id, row.label)));
  }

  function objectiveLabel(id) {
    const row = objectiveById(id);
    return row ? `${row.id} ${row.name}` : String(id || "");
  }

  function appendCompactBullets(parent, label, values) {
    const items = compactList(values, 4);
    if (!items.length) return;
    const section = document.createElement("div");
    section.className = "candidateObjectiveHelpSection";
    const heading = document.createElement("strong");
    heading.textContent = label;
    section.appendChild(heading);
    const list = document.createElement("ul");
    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });
    section.appendChild(list);
    parent.appendChild(section);
  }

  function renderObjectiveDetails(id) {
    const row = objectiveById(id);
    if (!row) return null;
    const details = document.createElement("div");
    details.className = "candidateObjectiveDetails";
    if (row.definition) {
      const definition = document.createElement("p");
      definition.textContent = row.definition;
      details.appendChild(definition);
    }
    if (Array.isArray(row.applicable_objects) && row.applicable_objects.length) {
      const meta = document.createElement("div");
      meta.className = "candidateObjectiveMeta";
      const label = document.createElement("strong");
      label.textContent = "Applicable objects";
      meta.appendChild(label);
      row.applicable_objects.forEach((objectLevel) => {
        const chip = document.createElement("span");
        chip.textContent = objectLevel;
        meta.appendChild(chip);
      });
      details.appendChild(meta);
    }
    const cues = row.story_cues || {};
    const more = document.createElement("details");
    more.className = "candidateObjectiveMore";
    const summary = document.createElement("summary");
    summary.textContent = "Cues and boundary rules";
    more.appendChild(summary);
    appendCompactBullets(more, "Positive cues", cues.positive);
    appendCompactBullets(more, "Negative cues", cues.negative);
    appendCompactBullets(more, "Avoid confusing with", cues.avoid_phrases);
    appendCompactBullets(more, "Boundary rules", row.boundary_rules);
    if (more.children.length > 1) details.appendChild(more);
    return details;
  }

  function listText(value) {
    if (Array.isArray(value)) {
      return value.map((x) => String(x).trim()).filter(Boolean).join("; ");
    }
    return String(value || "").trim();
  }

  function normalizeCompareValue(value) {
    if (Array.isArray(value)) {
      return value.map((x) => String(x).trim().toLowerCase()).filter(Boolean).sort().join("|");
    }
    return String(value || "").trim().toLowerCase();
  }

  function objectiveSignature(obj) {
    return [
      obj?.l2_id || obj?.objective_id || "",
      obj?.action || "",
      obj?.object_level || ""
    ].map((x) => String(x).trim().toLowerCase()).join("|");
  }

  function appendCandidateSection(parent, title, content) {
    const section = document.createElement("div");
    section.className = "candidateSection";
    const heading = document.createElement("strong");
    heading.textContent = title;
    section.appendChild(heading);
    if (content) {
      section.appendChild(content);
    } else {
      const empty = document.createElement("div");
      empty.className = "candidateEmpty";
      empty.textContent = "Not specified";
      section.appendChild(empty);
    }
    parent.appendChild(section);
  }

  function renderChipList(values, otherValues = []) {
    const items = Array.isArray(values) ? values.map((x) => String(x).trim()).filter(Boolean) : [];
    if (!items.length) return null;
    const other = new Set((Array.isArray(otherValues) ? otherValues : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean));
    const box = document.createElement("div");
    box.className = "candidateChips";
    items.forEach((item) => {
      const chip = document.createElement("span");
      chip.className = `candidateChip${other.has(item.toLowerCase()) ? "" : " candidateDiff"}`;
      chip.textContent = item;
      box.appendChild(chip);
    });
    return box;
  }

  function renderCandidate(container, candidate, otherCandidate = {}) {
    container.innerHTML = "";
    const gm = candidate?.graph_model || {};
    const otherGm = otherCandidate?.graph_model || {};
    const properties = document.createElement("div");
    properties.className = "candidateProperties";
    [
      ["Direction", gm.direction, otherGm.direction],
      ["Weighting", gm.weighting, otherGm.weighting],
      ["Time model", gm.time_model, otherGm.time_model],
      ["Node meaning", gm.node_meaning, otherGm.node_meaning],
      ["Edge meaning", gm.edge_meaning, otherGm.edge_meaning]
    ].forEach(([label, rawValue, otherRawValue]) => {
      const value = listText(rawValue);
      const differs = normalizeCompareValue(rawValue) !== normalizeCompareValue(otherRawValue);
      const row = document.createElement("div");
      row.className = differs ? "candidateDiff" : "";
      const key = document.createElement("span");
      key.textContent = label;
      const val = document.createElement("span");
      val.textContent = value || "Not specified";
      if (!value) val.className = "candidateEmpty";
      row.appendChild(key);
      row.appendChild(val);
      properties.appendChild(row);
    });
    appendCandidateSection(container, "Graph model", properties);

    appendCandidateSection(container, "Operations", renderChipList(candidate?.operations || [], otherCandidate?.operations || []));

    const objectives = Array.isArray(candidate?.objectives) ? candidate.objectives : [];
    if (objectives.length) {
      const box = document.createElement("div");
      box.className = "candidateObjectives";
      const header = document.createElement("div");
      header.className = "candidateObjectiveHeader";
      ["Objective", "Action", "Object level"].forEach((text) => {
        const cell = document.createElement("span");
        cell.textContent = text;
        header.appendChild(cell);
      });
      box.appendChild(header);
      const otherObjectives = new Set((Array.isArray(otherCandidate?.objectives) ? otherCandidate.objectives : []).map(objectiveSignature));
      objectives.forEach((obj) => {
        const row = document.createElement("div");
        row.className = `candidateObjectiveRow${otherObjectives.has(objectiveSignature(obj)) ? "" : " candidateDiff"}`;
        const main = document.createElement("div");
        main.className = "candidateObjectiveMain";
        const label = document.createElement("span");
        const objectiveId = obj.l2_id || obj.objective_id;
        label.textContent = objectiveLabel(objectiveId);
        const action = document.createElement("span");
        action.textContent = obj.action || "Not specified";
        const level = document.createElement("span");
        level.textContent = obj.object_level || "Not specified";
        main.appendChild(label);
        main.appendChild(action);
        main.appendChild(level);
        row.appendChild(main);
        const details = renderObjectiveDetails(objectiveId);
        if (details) row.appendChild(details);
        box.appendChild(row);
      });
      appendCandidateSection(container, "Objectives", box);
    } else {
      appendCandidateSection(container, "Objectives", null);
    }
  }

  function initSupabase() {
    const cfg = window.SURVEY_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
      state.supabase = null;
      return;
    }
    state.supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  async function fetchAssignment() {
    const cfg = window.SURVEY_CONFIG || {};
    const source = cfg.ASSIGNMENT_SOURCE || "static";
    if (source === "supabase") {
      if (!state.supabase) {
        throw new Error("Supabase is required for this survey link but is not configured yet.");
      }
      const { data, error } = await state.supabase.rpc("get_survey_assignment", {
        request_token_hash: state.tokenHash
      });
      if (error) {
        throw new Error(`Could not load assignment for this token: ${error.message}`);
      }
      if (!data) {
        throw new Error("No active assignment was found for this token.");
      }
      return data;
    }
    return fetchJson(`data/assignments/${state.token}.json`);
  }

  function initStaticControls() {
    fillSelect(document.querySelector("[name=direction]"), ["Directed", "Undirected"]);
    fillSelect(document.querySelector("[name=weighting]"), ["Weighted", "Unweighted"]);
    const timeOptions = state.schema.time_model?.options || ["Static", "Dynamic"];
    fillSelect(document.querySelector("[name=time_model]"), timeOptions);

    const ops = state.schema.operations?.options || state.schema.allowed_operations?.options || [];
    const box = $("#operationsBox");
    box.innerHTML = "";
    ops.forEach((op) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "allowed_operations";
      input.value = op;
      label.appendChild(input);
      label.appendChild(document.createTextNode(op));
      box.appendChild(label);
    });
  }

  function blankResponse(item) {
    if (isStoryQualityAb()) {
      return {
        annotator_id: state.assignment.annotator_id,
        assignment_id: state.assignment.assignment_id,
        story_quality_pair_id: item.story_quality_pair_id,
        preferred_story: "",
        submitted: false,
        submitted_at: ""
      };
    }
    if (isFormulationAb()) {
      return {
        annotator_id: state.assignment.annotator_id,
        assignment_id: state.assignment.assignment_id,
        formulation_pair_id: item.formulation_pair_id,
        human_item_id: item.human_item_id || "",
        preferred_candidate: "",
        submitted: false,
        submitted_at: ""
      };
    }
    return {
      annotator_id: state.assignment.annotator_id,
      assignment_id: state.assignment.assignment_id,
      human_item_id: item.human_item_id,
      direction: "",
      weighting: "",
      time_model: "",
      node_meaning: "",
      edge_meaning: "",
      allowed_operations: [],
      active_objectives: [],
      submitted: false,
      submitted_at: ""
    };
  }

  function currentItem() {
    return state.assignment.items[state.currentIndex];
  }

  function currentResponse() {
    const item = currentItem();
    const key = itemKey(item);
    if (!state.responses[key]) {
      state.responses[key] = blankResponse(item);
    }
    return state.responses[key];
  }

  function addObjectiveRow(value = {}) {
    const template = $("#objectiveTemplate");
    const node = template.content.firstElementChild.cloneNode(true);
    fillObjectiveSelect(node.querySelector(".objectiveSelect"));
    fillSelect(node.querySelector(".actionSelect"), state.schema.active_objectives.item_schema.action.options || ["Promote", "Reduce"]);
    node.querySelector(".objectiveSelect").value = value.l2_id || value.objective_id || "";
    node.querySelector(".actionSelect").value = value.action || "";
    refreshObjectLevelSelect(node, value.object_level || "");
    node.querySelector(".objectiveSelect").addEventListener("change", () => {
      refreshObjectLevelSelect(node, node.querySelector(".objectLevelSelect").value);
      renderObjectiveHelp(node);
      saveFromForm();
    });
    node.querySelector(".removeObjectiveBtn").addEventListener("click", () => {
      node.remove();
      saveFromForm();
    });
    $("#objectivesBox").appendChild(node);
    renderObjectiveHelp(node);
    refreshObjectiveNumbers();
  }

  function refreshObjectiveNumbers() {
    document.querySelectorAll(".objectiveCard").forEach((card, idx) => {
      card.querySelector(".objectiveNumber").textContent = `Objective ${idx + 1}`;
    });
  }

  function renderItemList() {
    const list = $("#itemList");
    list.innerHTML = "";
    state.assignment.items.forEach((item, idx) => {
      const id = itemKey(item);
      const response = state.responses[id];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `itemButton${idx === state.currentIndex ? " active" : ""}`;
      btn.innerHTML = `<span>${id}</span><span class="badge ${response?.submitted ? "done" : ""}">${response?.submitted ? "submitted" : "open"}</span>`;
      btn.addEventListener("click", () => {
        saveFromForm();
        state.currentIndex = idx;
        renderCurrentItem();
      });
      list.appendChild(btn);
    });
  }

  function renderProgress() {
    const total = state.assignment.items.length;
    const done = state.assignment.items.filter((item) => state.responses[itemKey(item)]?.submitted).length;
    $("#progressText").textContent = `${done} / ${total} submitted`;
    $("#progressBar").style.width = total ? `${(done / total) * 100}%` : "0";
  }

  function renderStoryQualityContext(item) {
    const box = $("#storyQualityContext");
    const context = item.context || {};
    const rows = [
      ["Domain", context.domain || item.domain_context || ""],
      ["Scenario", context.scenario || item.scenario_context || ""],
      ["Requested format", context.requested_format || item.requested_genre || item.genre || ""]
    ].filter((row) => row[1]);
    box.innerHTML = "";
    rows.forEach(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const desc = document.createElement("dd");
      desc.textContent = value;
      box.appendChild(term);
      box.appendChild(desc);
    });
    box.classList.toggle("hidden", rows.length === 0);
  }

  function renderCurrentItem() {
    const item = currentItem();
    const response = currentResponse();
    $("#itemTitle").textContent = itemKey(item);
    $("#itemSubhead").textContent = "";
    $("#storyText").textContent = item.story_text;

    if (isFormulationAb()) {
      $("#singleStoryPanel").classList.remove("hidden");
      $("#responseForm").classList.add("hidden");
      $("#abResponseForm").classList.remove("hidden");
      $("#storyQualityForm").classList.add("hidden");
      renderCandidate($("#candidateA"), item.candidate_A || {}, item.candidate_B || {});
      renderCandidate($("#candidateB"), item.candidate_B || {}, item.candidate_A || {});
      document.querySelectorAll("[name=preferred_candidate]").forEach((input) => {
        input.checked = response.preferred_candidate === input.value;
      });
      renderItemList();
      renderProgress();
      return;
    }

    if (isStoryQualityAb()) {
      $("#singleStoryPanel").classList.add("hidden");
      $("#responseForm").classList.add("hidden");
      $("#abResponseForm").classList.add("hidden");
      $("#storyQualityForm").classList.remove("hidden");
      $("#storyQualityInstructions").textContent = item.instructions || "";
      renderStoryQualityContext(item);
      $("#storyA").textContent = item.story_A || "";
      $("#storyB").textContent = item.story_B || "";
      document.querySelectorAll("[name=preferred_story]").forEach((input) => {
        input.checked = response.preferred_story === input.value;
      });
      renderItemList();
      renderProgress();
      return;
    }

    $("#singleStoryPanel").classList.remove("hidden");
    $("#storyQualityForm").classList.add("hidden");
    $("#abResponseForm").classList.add("hidden");
    $("#responseForm").classList.remove("hidden");

    const form = $("#responseForm");
    form.direction.value = response.direction || "";
    form.weighting.value = response.weighting || "";
    form.time_model.value = response.time_model || "";
    form.node_meaning.value = response.node_meaning || "";
    form.edge_meaning.value = response.edge_meaning || "";

    document.querySelectorAll("[name=allowed_operations]").forEach((input) => {
      input.checked = (response.allowed_operations || []).includes(input.value);
    });

    $("#objectivesBox").innerHTML = "";
    const objectives = response.active_objectives || [];
    if (objectives.length) {
      objectives.forEach((obj) => addObjectiveRow(obj));
    } else {
      addObjectiveRow();
    }
    refreshObjectiveNumbers();
    renderItemList();
    renderProgress();
  }

  function collectObjectives() {
    return Array.from(document.querySelectorAll(".objectiveCard")).map((card) => {
      const obj = {};
      card.querySelectorAll("[data-field]").forEach((el) => {
        const field = el.dataset.field;
        obj[field] = el.value;
      });
      if (obj.l2_id) {
        obj.objective_id = obj.l2_id;
      }
      return obj;
    }).filter((obj) => obj.l2_id || obj.action || obj.object_level);
  }

  function saveFromForm() {
    if (!state.assignment) return;
    const item = currentItem();
    if (isFormulationAb()) {
      const response = currentResponse();
      const checked = document.querySelector("[name=preferred_candidate]:checked");
      response.preferred_candidate = checked ? checked.value : "";
      state.responses[itemKey(item)] = response;
      saveLocalResponses();
      return;
    }
    if (isStoryQualityAb()) {
      const response = currentResponse();
      const checked = document.querySelector("[name=preferred_story]:checked");
      response.preferred_story = checked ? checked.value : "";
      state.responses[itemKey(item)] = response;
      saveLocalResponses();
      return;
    }
    const form = $("#responseForm");
    const response = currentResponse();
    response.direction = form.direction.value;
    response.weighting = form.weighting.value;
    response.time_model = form.time_model.value;
    response.node_meaning = form.node_meaning.value;
    response.edge_meaning = form.edge_meaning.value;
    response.allowed_operations = Array.from(document.querySelectorAll("[name=allowed_operations]:checked")).map((x) => x.value);
    response.active_objectives = collectObjectives();
    state.responses[itemKey(item)] = response;
    saveLocalResponses();
  }

  function responsePayload(response) {
    if (response.story_quality_pair_id) {
      return {
        annotator_id: response.annotator_id || state.assignment.annotator_id,
        assignment_id: response.assignment_id || state.assignment.assignment_id,
        story_quality_pair_id: response.story_quality_pair_id || "",
        preferred_story: response.preferred_story || ""
      };
    }
    if (response.formulation_pair_id) {
      return {
        annotator_id: response.annotator_id || state.assignment.annotator_id,
        assignment_id: response.assignment_id || state.assignment.assignment_id,
        formulation_pair_id: response.formulation_pair_id || "",
        human_item_id: response.human_item_id || "",
        preferred_candidate: response.preferred_candidate || ""
      };
    }
    const activeObjectives = (response.active_objectives || []).map((obj) => ({
      l2_id: obj.l2_id || obj.objective_id || "",
      objective_id: obj.objective_id || obj.l2_id || "",
      action: obj.action || "",
      object_level: obj.object_level || ""
    })).filter((obj) => obj.objective_id || obj.action || obj.object_level);
    const identifiedObjectives = activeObjectives.map((obj) => ({
      objective_id: obj.objective_id || obj.l2_id || "",
      action: obj.action || "",
      object_level: obj.object_level || ""
    }));
    const allowedOperations = response.allowed_operations || [];
    return {
      annotator_id: response.annotator_id || state.assignment.annotator_id,
      assignment_id: response.assignment_id || state.assignment.assignment_id,
      human_item_id: response.human_item_id || "",
      direction: response.direction || "",
      weighting: response.weighting || "",
      time_model: response.time_model || "",
      node_meaning: response.node_meaning || "",
      edge_meaning: response.edge_meaning || "",
      allowed_operations: allowedOperations,
      active_objectives: activeObjectives,
      graph_model: {
        property_tags: [response.direction, response.weighting, response.time_model].filter(Boolean),
        node_meaning: splitMeaning(response.node_meaning),
        edge_meaning: splitMeaning(response.edge_meaning)
      },
      operations: allowedOperations,
      identified_objectives: identifiedObjectives
    };
  }

  function splitMeaning(value) {
    if (Array.isArray(value)) {
      return value.map((x) => String(x).trim()).filter(Boolean);
    }
    return String(value || "")
      .split(/\n|;/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  async function submitCurrentItem() {
    saveFromForm();
    const response = currentResponse();
    if (isFormulationAb() && !response.preferred_candidate) {
      setStatus("Choose Candidate A, Candidate B, or Tie before submitting");
      return;
    }
    if (isStoryQualityAb() && !response.preferred_story) {
      setStatus("Choose Story A, Story B, or Tie before submitting");
      return;
    }
    response.submitted = true;
    response.submitted_at = new Date().toISOString();
    saveLocalResponses();

    if (!state.supabase) {
      setStatus("Marked submitted locally; Supabase is not configured");
      renderCurrentItem();
      return;
    }

    const cfg = window.SURVEY_CONFIG || {};
    let table = "blind_recovery_responses";
    let payload = {
      token_hash: state.tokenHash,
      annotator_id: state.assignment.annotator_id,
      assignment_id: state.assignment.assignment_id,
      human_item_id: response.human_item_id,
      response_json: responsePayload(response),
      client_version: cfg.CLIENT_VERSION || "gfm-human-eval-web"
    };
    if (isStoryQualityAb()) {
      table = "story_quality_ab_responses";
      payload = {
        token_hash: state.tokenHash,
        annotator_id: state.assignment.annotator_id,
        assignment_id: state.assignment.assignment_id,
        story_quality_pair_id: response.story_quality_pair_id,
        response_json: responsePayload(response),
        client_version: cfg.CLIENT_VERSION || "gfm-human-eval-web"
      };
    } else if (isFormulationAb()) {
      table = "formulation_ab_responses";
      payload = {
          token_hash: state.tokenHash,
          annotator_id: state.assignment.annotator_id,
          assignment_id: state.assignment.assignment_id,
          formulation_pair_id: response.formulation_pair_id,
          human_item_id: response.human_item_id || "",
          response_json: responsePayload(response),
          client_version: cfg.CLIENT_VERSION || "gfm-human-eval-web"
        };
    }
    const { error } = await state.supabase.from(table).insert(payload);
    if (error) {
      response.submitted = false;
      saveLocalResponses();
      setStatus(`Supabase submit failed: ${error.message}`);
      return;
    }
    setStatus("Submitted to Supabase");
    renderCurrentItem();
  }

  function exportJsonl() {
    saveFromForm();
    const rows = state.assignment.items.map((item) => responsePayload(state.responses[itemKey(item)] || blankResponse(item)));
    const jsonl = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
    const blob = new Blob([jsonl], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `annotations_${state.assignment.annotator_id}_${state.assignment.assignment_id}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function wireEvents() {
    $("#addObjectiveBtn").addEventListener("click", () => {
      addObjectiveRow();
      saveFromForm();
    });
    $("#saveBtn").addEventListener("click", saveFromForm);
    $("#submitBtn").addEventListener("click", submitCurrentItem);
    $("#saveAbBtn").addEventListener("click", saveFromForm);
    $("#submitAbBtn").addEventListener("click", submitCurrentItem);
    $("#saveStoryQualityBtn").addEventListener("click", saveFromForm);
    $("#submitStoryQualityBtn").addEventListener("click", submitCurrentItem);
    $("#exportBtn").addEventListener("click", exportJsonl);
    $("#prevBtn").addEventListener("click", () => {
      saveFromForm();
      state.currentIndex = Math.max(0, state.currentIndex - 1);
      renderCurrentItem();
    });
    $("#nextBtn").addEventListener("click", () => {
      saveFromForm();
      state.currentIndex = Math.min(state.assignment.items.length - 1, state.currentIndex + 1);
      renderCurrentItem();
    });
    $("#responseForm").addEventListener("change", saveFromForm);
    $("#abResponseForm").addEventListener("change", saveFromForm);
    $("#storyQualityForm").addEventListener("change", saveFromForm);
  }

  async function boot() {
    try {
      state.token = getParam("token");
      if (!state.token) {
        showFatal("Missing assignment token. Open the personalized survey link you were given.");
        return;
      }
      initSupabase();
      state.tokenHash = await sha256(state.token);
      state.assignment = await fetchAssignment();
      state.schema = await fetchJson("data/form_schema.json");
      initStaticControls();
      loadLocalResponses();
      wireEvents();
      $("#assignmentMeta").textContent = `${state.assignment.annotator_id} · ${state.assignment.assignment_id} · ${state.assignment.items.length} assigned items`;
      if (isFormulationAb()) {
        document.querySelector("h1").textContent = "Graph Formulation A/B Review";
        document.querySelector(".tutorialPanel summary").textContent = "How to complete this task";
        document.querySelector(".tutorialBody").innerHTML = `
          <p>Read the story and compare Candidate A and Candidate B. Choose the formulation that is better supported by the story, or choose Tie if they are similarly supported.</p>
          <div class="tutorialGrid">
            <div>
              <h4>What to compare</h4>
              <ul>
                <li>Graph properties: direction, weighting, and static versus dynamic.</li>
                <li>Node and edge meanings in the story's domain language.</li>
                <li>Allowed operations implied by the story.</li>
                <li>Objective rows: objective, action, and object level.</li>
              </ul>
            </div>
            <div>
              <h4>How to decide</h4>
              <ul>
                <li>Use only the story text and the objective definitions shown in the candidates.</li>
                <li>Highlighted rows show where A and B differ; focus on whether those differences are supported by the story.</li>
                <li>Select Tie when both candidates are equally plausible or equally unsupported.</li>
                <li>Do not use external resources or LLM tools.</li>
              </ul>
            </div>
          </div>
        `;
      } else if (isStoryQualityAb()) {
        document.querySelector("h1").textContent = "Story Quality A/B Review";
        document.querySelector(".tutorialPanel summary").textContent = "How to complete this task";
        document.querySelector(".tutorialBody").innerHTML = `
          <p>Read the neutral context, then compare Story A and Story B. Both stories are intended to represent the same benchmark configuration; choose the story that works better as a benchmark item, or choose Tie if neither story is meaningfully better.</p>
          <div class="tutorialGrid">
            <div>
              <h4>What to compare</h4>
              <ul>
                <li>Naturalness and readability.</li>
                <li>Internal coherence and realistic domain framing.</li>
                <li>Fit to the requested format shown in the context panel.</li>
                <li>Clarity as a benchmark story without keyword-stuffed language.</li>
              </ul>
            </div>
            <div>
              <h4>What not to do</h4>
              <ul>
                <li>Do not try to solve the graph formulation.</li>
                <li>Do not use external resources or LLM tools.</li>
                <li>Do not infer anything from story order or item IDs.</li>
              </ul>
            </div>
          </div>
        `;
      }
      $("#app").classList.remove("hidden");
      setStatus(state.supabase ? "Ready; Supabase enabled" : "Ready; export fallback only");
      renderCurrentItem();
    } catch (error) {
      showFatal(error.message || String(error));
    }
  }

  boot();
})();
