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
    return values.map((x) => String(x).trim()).filter(Boolean).slice(0, limit).join("; ");
  }

  function renderObjectiveHelp(card) {
    const select = card.querySelector(".objectiveSelect");
    const help = card.querySelector(".objectiveHelp");
    const row = objectiveById(select.value);
    if (!row) {
      help.textContent = "Select an objective to see its definition, story cues, applicable object levels, and boundary rules.";
      return;
    }
    const cues = row.story_cues || {};
    const lines = [
      `${row.id} ${row.name}`,
      row.definition || "",
      row.applicable_objects?.length ? `Applicable objects: ${row.applicable_objects.join(", ")}` : "",
      compactList(cues.positive) ? `Positive cues: ${compactList(cues.positive)}` : "",
      compactList(cues.negative) ? `Negative cues: ${compactList(cues.negative)}` : "",
      compactList(cues.avoid_phrases, 3) ? `Avoid confusing with: ${compactList(cues.avoid_phrases, 3)}` : "",
      compactList(row.boundary_rules, 3) ? `Boundary rules: ${compactList(row.boundary_rules, 3)}` : ""
    ].filter(Boolean);
    help.textContent = lines.join("\n");
  }

  function fillObjectiveSelect(select) {
    select.innerHTML = "";
    select.appendChild(option("", "Select"));
    objectiveOptions().forEach((row) => select.appendChild(option(row.id, row.label)));
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
    fillSelect(document.querySelector("[name=direction]"), ["Directed", "Undirected", "Unclear"]);
    fillSelect(document.querySelector("[name=weighting]"), ["Weighted", "Unweighted", "Unclear"]);
    const timeOptions = state.schema.time_model?.options || ["Static", "Dynamic", "Unclear"];
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
    return {
      annotator_id: state.assignment.annotator_id,
      assignment_id: state.assignment.assignment_id,
      human_item_id: item.human_item_id,
      direction: "",
      weighting: "",
      time_model: "",
      node_meaning: "",
      edge_meaning: "",
      trace: "",
      graph_model_confidence: "",
      allowed_operations: [],
      active_objectives: [],
      alternative_formulation_exists: "",
      alternative_formulation_description: "",
      overall_confidence: "",
      notes: "",
      submitted: false,
      submitted_at: ""
    };
  }

  function currentItem() {
    return state.assignment.items[state.currentIndex];
  }

  function currentResponse() {
    const item = currentItem();
    if (!state.responses[item.human_item_id]) {
      state.responses[item.human_item_id] = blankResponse(item);
    }
    return state.responses[item.human_item_id];
  }

  function addObjectiveRow(value = {}) {
    const template = $("#objectiveTemplate");
    const node = template.content.firstElementChild.cloneNode(true);
    fillObjectiveSelect(node.querySelector(".objectiveSelect"));
    fillSelect(node.querySelector(".actionSelect"), state.schema.active_objectives.item_schema.action.options || ["Promote", "Reduce", "Unclear"]);
    fillSelect(node.querySelector(".objectLevelSelect"), state.schema.active_objectives.item_schema.object_level.options || []);
    node.querySelectorAll("[data-field]").forEach((el) => {
      const field = el.dataset.field;
      if (field === "evidence_spans") {
        el.value = Array.isArray(value[field]) ? value[field].join("\n") : (value[field] || "");
      } else {
        el.value = value[field] || "";
      }
    });
    node.querySelector(".objectiveSelect").addEventListener("change", () => renderObjectiveHelp(node));
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
      const response = state.responses[item.human_item_id];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `itemButton${idx === state.currentIndex ? " active" : ""}`;
      btn.innerHTML = `<span>${item.human_item_id}</span><span class="badge ${response?.submitted ? "done" : ""}">${response?.submitted ? "submitted" : "open"}</span>`;
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
    const done = state.assignment.items.filter((item) => state.responses[item.human_item_id]?.submitted).length;
    $("#progressText").textContent = `${done} / ${total} submitted`;
    $("#progressBar").style.width = total ? `${(done / total) * 100}%` : "0";
  }

  function renderCurrentItem() {
    const item = currentItem();
    const response = currentResponse();
    $("#itemTitle").textContent = item.human_item_id;
    $("#itemSubhead").textContent = "";
    $("#storyText").textContent = item.story_text;

    const form = $("#responseForm");
    form.direction.value = response.direction || "";
    form.weighting.value = response.weighting || "";
    form.time_model.value = response.time_model || "";
    form.node_meaning.value = response.node_meaning || "";
    form.edge_meaning.value = response.edge_meaning || "";
    form.trace.value = response.trace || response.graph_model_evidence || "";
    form.graph_model_confidence.value = response.graph_model_confidence || "";
    form.alternative_formulation_exists.value = response.alternative_formulation_exists || "";
    form.alternative_formulation_description.value = response.alternative_formulation_description || "";
    form.overall_confidence.value = response.overall_confidence || "";
    form.notes.value = response.notes || "";

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
        if (field === "evidence_spans") {
          obj[field] = el.value.split("\n").map((x) => x.trim()).filter(Boolean);
        } else {
          obj[field] = el.value;
        }
      });
      if (obj.l2_id) {
        obj.objective_id = obj.l2_id;
      }
      return obj;
    }).filter((obj) => obj.l2_id || obj.action || obj.object_level || obj.evidence_spans.length);
  }

  function saveFromForm() {
    if (!state.assignment) return;
    const item = currentItem();
    const form = $("#responseForm");
    const response = currentResponse();
    response.direction = form.direction.value;
    response.weighting = form.weighting.value;
    response.time_model = form.time_model.value;
    response.node_meaning = form.node_meaning.value;
    response.edge_meaning = form.edge_meaning.value;
    response.trace = form.trace.value;
    response.graph_model_confidence = form.graph_model_confidence.value;
    response.allowed_operations = Array.from(document.querySelectorAll("[name=allowed_operations]:checked")).map((x) => x.value);
    response.active_objectives = collectObjectives();
    response.alternative_formulation_exists = form.alternative_formulation_exists.value;
    response.alternative_formulation_description = form.alternative_formulation_description.value;
    response.overall_confidence = form.overall_confidence.value;
    response.notes = form.notes.value;
    state.responses[item.human_item_id] = response;
    saveLocalResponses();
  }

  function responsePayload(response) {
    const copy = { ...response };
    delete copy.submitted;
    delete copy.submitted_at;
    copy.graph_model = {
      property_tags: [copy.direction, copy.weighting, copy.time_model].filter((value) => value && value !== "Unclear"),
      node_meaning: splitMeaning(copy.node_meaning),
      edge_meaning: splitMeaning(copy.edge_meaning)
    };
    copy.operations = copy.allowed_operations || [];
    copy.identified_objectives = (copy.active_objectives || []).map((obj) => ({
      objective_id: obj.objective_id || obj.l2_id || "",
      action: obj.action || "",
      object_level: obj.object_level || ""
    })).filter((obj) => obj.objective_id || obj.action || obj.object_level);
    copy.trace = copy.trace || copy.graph_model_evidence || "";
    return copy;
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
    response.submitted = true;
    response.submitted_at = new Date().toISOString();
    saveLocalResponses();

    if (!state.supabase) {
      setStatus("Marked submitted locally; Supabase is not configured");
      renderCurrentItem();
      return;
    }

    const cfg = window.SURVEY_CONFIG || {};
    const payload = {
      token_hash: state.tokenHash,
      annotator_id: state.assignment.annotator_id,
      assignment_id: state.assignment.assignment_id,
      human_item_id: response.human_item_id,
      response_json: responsePayload(response),
      client_version: cfg.CLIENT_VERSION || "gfm-human-eval-web"
    };
    const { error } = await state.supabase.from("blind_recovery_responses").insert(payload);
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
    const rows = state.assignment.items.map((item) => responsePayload(state.responses[item.human_item_id] || blankResponse(item)));
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
      $("#app").classList.remove("hidden");
      setStatus(state.supabase ? "Ready; Supabase enabled" : "Ready; export fallback only");
      renderCurrentItem();
    } catch (error) {
      showFatal(error.message || String(error));
    }
  }

  boot();
})();
