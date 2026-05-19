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

  function itemKey(item) {
    return item.formulation_pair_id || item.human_item_id || item.pair_id || item.triage_id || "";
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

  function listText(value) {
    if (Array.isArray(value)) {
      return value.map((x) => String(x).trim()).filter(Boolean).join("; ");
    }
    return String(value || "").trim();
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

  function renderCandidate(container, candidate) {
    container.innerHTML = "";
    const gm = candidate?.graph_model || {};
    const properties = document.createElement("div");
    properties.className = "candidateProperties";
    [
      ["Direction", gm.direction],
      ["Weighting", gm.weighting],
      ["Time model", gm.time_model],
      ["Node meaning", listText(gm.node_meaning)],
      ["Edge meaning", listText(gm.edge_meaning)]
    ].forEach(([label, value]) => {
      const row = document.createElement("div");
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

    const operations = listText(candidate?.operations || []);
    appendCandidateSection(container, "Operations", operations ? document.createTextNode(operations) : null);

    const objectives = Array.isArray(candidate?.objectives) ? candidate.objectives : [];
    if (objectives.length) {
      const box = document.createElement("div");
      box.className = "candidateObjectives";
      objectives.forEach((obj) => {
        const row = document.createElement("div");
        row.className = "candidateObjectiveRow";
        const label = document.createElement("span");
        label.textContent = objectiveLabel(obj.l2_id || obj.objective_id);
        const detail = document.createElement("span");
        detail.textContent = [obj.action, obj.object_level].filter(Boolean).join(" / ");
        row.appendChild(label);
        row.appendChild(detail);
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

  function renderCurrentItem() {
    const item = currentItem();
    const response = currentResponse();
    $("#itemTitle").textContent = itemKey(item);
    $("#itemSubhead").textContent = "";
    $("#storyText").textContent = item.story_text;

    if (isFormulationAb()) {
      $("#responseForm").classList.add("hidden");
      $("#abResponseForm").classList.remove("hidden");
      renderCandidate($("#candidateA"), item.candidate_A || {});
      renderCandidate($("#candidateB"), item.candidate_B || {});
      document.querySelectorAll("[name=preferred_candidate]").forEach((input) => {
        input.checked = response.preferred_candidate === input.value;
      });
      renderItemList();
      renderProgress();
      return;
    }

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
    response.submitted = true;
    response.submitted_at = new Date().toISOString();
    saveLocalResponses();

    if (!state.supabase) {
      setStatus("Marked submitted locally; Supabase is not configured");
      renderCurrentItem();
      return;
    }

    const cfg = window.SURVEY_CONFIG || {};
    const table = isFormulationAb() ? "formulation_ab_responses" : "blind_recovery_responses";
    const payload = isFormulationAb()
      ? {
          token_hash: state.tokenHash,
          annotator_id: state.assignment.annotator_id,
          assignment_id: state.assignment.assignment_id,
          formulation_pair_id: response.formulation_pair_id,
          human_item_id: response.human_item_id || "",
          response_json: responsePayload(response),
          client_version: cfg.CLIENT_VERSION || "gfm-human-eval-web"
        }
      : {
          token_hash: state.tokenHash,
          annotator_id: state.assignment.annotator_id,
          assignment_id: state.assignment.assignment_id,
          human_item_id: response.human_item_id,
          response_json: responsePayload(response),
          client_version: cfg.CLIENT_VERSION || "gfm-human-eval-web"
        };
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
        document.querySelector(".tutorialBody > p").textContent = "Read the story and compare Candidate A and Candidate B. Choose the formulation that is better supported by the story, or choose Tie if they are similarly supported.";
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
