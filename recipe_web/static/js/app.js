// ── Device ID ─────────────────────────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem("device_id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("device_id", id);
  }
  return id;
}

// ── State ─────────────────────────────────────────────────────────────────────
let allRecipes    = [];
let allFeed       = [];
let currentId     = null;
let activeTags    = [];
let servings      = 4;
let filterTag     = "all";
let isPublic      = false;
let currentImageB64 = null;
let timerSecs     = 0;
let timerRunning  = false;
let timerInterval = null;
let timerCountdown = false;
let currentTab    = "mine";

const PRESET_TAGS = [
  "breakfast","lunch","dinner","dessert","snack",
  "vegetarian","vegan","gluten-free","quick","healthy",
  "spicy","comfort food","baking","soup","salad",
  "grilling","pasta","seafood","budget","meal prep",
];

const TAG_COLORS = {
  breakfast:"#E8A838", lunch:"#3DAA7D", dinner:"#5B6BD4",
  dessert:"#C94F82", snack:"#2E8FD4", vegetarian:"#5E9E1A",
  vegan:"#3DAA4F", "gluten-free":"#D4853A", quick:"#C43E1A",
  healthy:"#2E9E6A", spicy:"#C42A1A", "comfort food":"#9B4F1A",
  baking:"#C47A1A", soup:"#3A7AB8", salad:"#5E8E2A",
  grilling:"#B84A1A", pasta:"#C4841A", seafood:"#1A7AAA",
  budget:"#5E7A2A", "meal prep":"#4A5A9E",
};

function tagColor(t) { return TAG_COLORS[t.toLowerCase()] || "#6B7280"; }

// ── API ───────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const headers = { "Content-Type":"application/json", "X-Device-ID": getDeviceId() };
  const opts    = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res  = await fetch("/api" + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(localStorage.getItem("theme") || "dark");
  buildPresetPills();
  buildFilterPills();
  loadRecipes();
  loadFeed();
});

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.getElementById("panel-mine").style.display = tab === "mine" ? "" : "none";
  document.getElementById("panel-feed").style.display = tab === "feed" ? "" : "none";
  document.getElementById("tab-mine").classList.toggle("active", tab === "mine");
  document.getElementById("tab-feed").classList.toggle("active", tab === "feed");
  if (tab === "feed") loadFeed();
}

// ── My recipes ────────────────────────────────────────────────────────────────
async function loadRecipes() {
  try {
    allRecipes = await api("GET", "/recipes");
    renderList();
    if (allRecipes.length) loadRecipe(allRecipes[0].id);
  } catch(e) { toast("Error loading: " + e.message); }
}

function buildFilterPills() {
  const wrap = document.getElementById("filter-pills");
  wrap.innerHTML = "";
  const filters = [["All","all"],["★ Favs","fav"],
    ...PRESET_TAGS.slice(0,8).map(t => [cap(t), t])];
  filters.forEach(([label, val]) => {
    const b = document.createElement("button");
    b.className   = "filter-pill" + (val === filterTag ? " active" : "");
    b.textContent = label;
    b.onclick     = () => { filterTag = val; buildFilterPills(); renderList(); };
    wrap.appendChild(b);
  });
}

function renderList() {
  const ul    = document.getElementById("recipe-list");
  const query = document.getElementById("search-input").value.trim().toLowerCase();
  ul.innerHTML = "";
  const filtered = allRecipes.filter(r => {
    if (filterTag === "fav" && !r.favorite) return false;
    if (filterTag !== "all" && filterTag !== "fav" &&
        !(r.tags||[]).map(t=>t.toLowerCase()).includes(filterTag)) return false;
    if (query && !r.name.toLowerCase().includes(query) &&
        !(r.tags||[]).some(t=>t.toLowerCase().includes(query))) return false;
    return true;
  });
  if (!filtered.length) {
    ul.innerHTML = '<li class="empty-state">No recipes found</li>';
    return;
  }
  filtered.forEach(r => {
    const li = document.createElement("li");
    li.className = "recipe-item" + (r.id === currentId ? " active" : "");
    li.onclick   = () => loadRecipe(r.id);
    const tags   = (r.tags||[]).slice(0,3).map(t =>
      `<span class="item-tag" style="background:${tagColor(t)}">${esc(t)}</span>`).join("");
    const img    = r.image_url
      ? `<img src="${esc(r.image_url)}" style="width:100%;height:70px;object-fit:cover;border-radius:7px;margin-bottom:5px"/>`
      : "";
    li.innerHTML = `
      <div class="item-body">
        ${img}
        <div class="item-name">${esc(r.name.slice(0,28))}${r.favorite?" ★":""}${r.public?" 🌍":""}</div>
        ${r.cook_time?`<div class="item-meta">⏱ ${r.cook_time}m</div>`:""}
        ${tags?`<div class="item-tags">${tags}</div>`:""}
      </div>`;
    ul.appendChild(li);
  });
}

function filterList() { renderList(); }

function loadRecipe(id) {
  const r = allRecipes.find(x => x.id === id);
  if (!r) return;
  currentId       = id;
  servings        = r.servings || 4;
  isPublic        = r.public   || false;
  currentImageB64 = null;

  document.getElementById("recipe-name").textContent      = r.name        || "";
  document.getElementById("ingredients-box").value        = r.ingredients || "";
  document.getElementById("recipe-box").value             = r.recipe      || "";
  document.getElementById("notes-box").value              = r.notes       || "";
  document.getElementById("prep-time").value              = r.prep_time   || "";
  document.getElementById("cook-time").value              = r.cook_time   || "";
  document.getElementById("servings-display").textContent = servings;

  // Image
  const preview = document.getElementById("image-preview");
  const removeBtn = document.getElementById("remove-image-btn");
  if (r.image_url) {
    preview.innerHTML = `<img src="${esc(r.image_url)}" alt="Recipe photo"/>`;
    removeBtn.style.display = "inline";
  } else {
    preview.innerHTML = `<span class="image-placeholder">📷 Click to add a photo</span>`;
    removeBtn.style.display = "none";
  }

  // Favourite
  const fb = document.getElementById("fav-btn");
  fb.textContent = r.favorite ? "★" : "☆";
  fb.classList.toggle("active", !!r.favorite);

  // Public
  const pb = document.getElementById("public-btn");
  pb.classList.toggle("active", !!r.public);
  pb.textContent = r.public ? "🌍 Shared" : "🌍 Share";

  activeTags = [...(r.tags||[])];
  buildPresetPills();
  renderActiveTags();
  renderList();
}

// ── Image handling ────────────────────────────────────────────────────────────
function handleImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    currentImageB64 = e.target.result; // full data URL
    const preview = document.getElementById("image-preview");
    preview.innerHTML = `<img src="${currentImageB64}" alt="Preview"/>`;
    document.getElementById("remove-image-btn").style.display = "inline";
  };
  reader.readAsDataURL(file);
}

function removeImage() {
  currentImageB64 = "__REMOVE__";
  document.getElementById("image-preview").innerHTML =
    `<span class="image-placeholder">📷 Click to add a photo</span>`;
  document.getElementById("remove-image-btn").style.display = "none";
}

// ── Public toggle ─────────────────────────────────────────────────────────────
function togglePublic() {
  isPublic = !isPublic;
  const pb = document.getElementById("public-btn");
  pb.classList.toggle("active", isPublic);
  pb.textContent = isPublic ? "🌍 Shared" : "🌍 Share";
}

// ── Save / Delete / Create ────────────────────────────────────────────────────
async function saveRecipe() {
  if (currentId === null) { toast("No recipe selected"); return; }
  try {
    const payload = {
      name:        document.getElementById("recipe-name").textContent.trim(),
      ingredients: document.getElementById("ingredients-box").value,
      recipe:      document.getElementById("recipe-box").value,
      notes:       document.getElementById("notes-box").value,
      prep_time:   document.getElementById("prep-time").value,
      cook_time:   document.getElementById("cook-time").value,
      favorite:    document.getElementById("fav-btn").classList.contains("active"),
      tags:        [...activeTags],
      servings,
      public:      isPublic,
    };
    if (currentImageB64 && currentImageB64 !== "__REMOVE__") {
      payload.image_b64 = currentImageB64;
    } else if (currentImageB64 === "__REMOVE__") {
      payload.image_url = "";
    }
    const updated = await api("PUT", `/recipes/${currentId}`, payload);
    const idx = allRecipes.findIndex(r => r.id === currentId);
    if (idx !== -1) allRecipes[idx] = updated;
    currentImageB64 = null;
    renderList();
    flashSave();
    toast("✓ Saved" + (isPublic ? " & shared to community!" : ""));
  } catch(e) { toast("Error: " + e.message); }
}

async function deleteRecipe() {
  if (currentId === null) return;
  const r = allRecipes.find(x => x.id === currentId);
  if (r?.favorite) { toast("Unstar it before deleting"); return; }
  if (!confirm(`Delete "${r?.name}"?`)) return;
  try {
    await api("DELETE", `/recipes/${currentId}`);
    allRecipes = allRecipes.filter(x => x.id !== currentId);
    currentId  = null;
    clearEditor();
    if (allRecipes.length) loadRecipe(allRecipes[0].id);
    renderList();
    toast("Recipe deleted");
  } catch(e) { toast("Error: " + e.message); }
}

async function createNew() {
  try {
    const r = await api("POST", "/recipes", { name: "New Recipe" });
    allRecipes.unshift(r);
    loadRecipe(r.id);
    renderList();
    const nameEl = document.getElementById("recipe-name");
    nameEl.focus();
    const range = document.createRange();
    range.selectNodeContents(nameEl);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  } catch(e) { toast("Error: " + e.message); }
}

function clearEditor() {
  document.getElementById("recipe-name").textContent = "";
  ["ingredients-box","recipe-box","notes-box","prep-time","cook-time"]
    .forEach(id => { document.getElementById(id).value = ""; });
  document.getElementById("image-preview").innerHTML =
    `<span class="image-placeholder">📷 Click to add a photo</span>`;
  document.getElementById("remove-image-btn").style.display = "none";
  currentImageB64 = null;
  isPublic = false;
  document.getElementById("public-btn").classList.remove("active");
  document.getElementById("public-btn").textContent = "🌍 Share";
  activeTags = [];
  buildPresetPills();
  renderActiveTags();
}

function flashSave() {
  const el = document.querySelector(".name-underline");
  el.style.background = "#34d399";
  setTimeout(() => { el.style.background = "var(--accent)"; }, 700);
}

function toggleFav() {
  const fb  = document.getElementById("fav-btn");
  const now = !fb.classList.contains("active");
  fb.classList.toggle("active", now);
  fb.textContent = now ? "★" : "☆";
}

function changeServings(delta) {
  servings = Math.max(1, servings + delta);
  document.getElementById("servings-display").textContent = servings;
}

// ── Tags ──────────────────────────────────────────────────────────────────────
function buildPresetPills() {
  const wrap = document.getElementById("preset-pills");
  wrap.innerHTML = "";
  PRESET_TAGS.forEach(tag => {
    const active = activeTags.includes(tag);
    const b = document.createElement("button");
    b.className   = "preset-pill" + (active ? " active" : "");
    b.textContent = tag;
    if (active) b.style.background = tagColor(tag);
    b.onclick = () => {
      if (activeTags.includes(tag)) activeTags = activeTags.filter(t=>t!==tag);
      else activeTags.push(tag);
      buildPresetPills(); renderActiveTags();
    };
    wrap.appendChild(b);
  });
}

function addCustomTag() {
  const input = document.getElementById("custom-tag-input");
  const val   = input.value.trim().toLowerCase();
  if (!val) return;
  val.split(",").map(t=>t.trim()).filter(Boolean).forEach(t => {
    if (!activeTags.includes(t)) activeTags.push(t);
  });
  input.value = "";
  buildPresetPills(); renderActiveTags();
}

function renderActiveTags() {
  const wrap = document.getElementById("active-tags");
  wrap.innerHTML = "";
  activeTags.forEach(tag => {
    const div = document.createElement("div");
    div.className        = "active-tag";
    div.style.background = tagColor(tag);
    div.innerHTML = `<span>${esc(tag)}</span>
      <button onclick="removeTag('${esc(tag)}')" title="Remove">×</button>`;
    wrap.appendChild(div);
  });
}

function removeTag(tag) {
  activeTags = activeTags.filter(t => t !== tag);
  buildPresetPills(); renderActiveTags();
}

// ── Community feed ────────────────────────────────────────────────────────────
async function loadFeed() {
  try {
    allFeed = await api("GET", "/feed");
    renderFeed();
  } catch(e) { console.error("Feed error:", e); }
}

function filterFeed() {
  renderFeed();
}

function renderFeed() {
  const ul    = document.getElementById("feed-list");
  const query = document.getElementById("feed-search").value.trim().toLowerCase();
  ul.innerHTML = "";
  const did = getDeviceId();

  const filtered = allFeed.filter(r =>
    !query || r.name.toLowerCase().includes(query) ||
    (r.tags||[]).some(t => t.toLowerCase().includes(query))
  );

  if (!filtered.length) {
    ul.innerHTML = '<li class="empty-state">No community recipes yet</li>';
    return;
  }

  filtered.forEach(r => {
    const li    = document.createElement("li");
    li.className = "feed-item";
    const liked  = (r.likes||[]).includes(did);
    const tags   = (r.tags||[]).slice(0,3).map(t =>
      `<span class="item-tag" style="background:${tagColor(t)}">${esc(t)}</span>`).join("");
    const img    = r.image_url
      ? `<img class="feed-item-img" src="${esc(r.image_url)}" alt="${esc(r.name)}"/>`
      : "";

    li.innerHTML = `
      ${img}
      <div class="feed-item-name">${esc(r.name)}</div>
      <div class="feed-item-meta">${r.cook_time ? `⏱ ${r.cook_time}m` : ""}</div>
      ${tags ? `<div class="item-tags" style="margin-top:4px">${tags}</div>` : ""}
      <div class="feed-item-footer">
        <button class="like-btn ${liked?"liked":""}" onclick="event.stopPropagation(); likeRecipe('${esc(r.pub_id)}', this)">
          ❤️ ${(r.likes||[]).length}
        </button>
        <button class="save-feed-btn" onclick="event.stopPropagation(); saveFromFeed('${esc(r.pub_id)}')">
          ＋ Save
        </button>
      </div>`;

    li.onclick = () => openFeedModal(r);
    ul.appendChild(li);
  });
}

async function likeRecipe(pubId, btn) {
  try {
    const result = await api("POST", `/feed/${pubId}/like`);
    btn.classList.toggle("liked", result.liked);
    btn.innerHTML = `❤️ ${result.likes}`;
    // update local state
    const r = allFeed.find(x => x.pub_id === pubId);
    if (r) {
      const did = getDeviceId();
      if (result.liked) r.likes = [...(r.likes||[]), did];
      else r.likes = (r.likes||[]).filter(l => l !== did);
    }
  } catch(e) { toast("Error: " + e.message); }
}

async function saveFromFeed(pubId) {
  try {
    const r = await api("POST", `/feed/${pubId}/save`);
    allRecipes.unshift(r);
    loadRecipe(r.id);
    switchTab("mine");
    toast("✓ Recipe saved to your collection!");
  } catch(e) { toast("Error: " + e.message); }
}

function openFeedModal(r) {
  document.getElementById("feed-modal-title").textContent = r.name;
  const body = document.getElementById("feed-modal-body");
  const did  = getDeviceId();
  const liked = (r.likes||[]).includes(did);
  const img   = r.image_url
    ? `<img class="feed-modal-img" src="${esc(r.image_url)}" alt="${esc(r.name)}"/>`
    : "";
  body.innerHTML = `
    ${img}
    <div class="feed-modal-section">
      <div class="feed-modal-label">INGREDIENTS</div>
      <div class="feed-modal-text">${esc(r.ingredients||"")}</div>
    </div>
    <div class="feed-modal-section">
      <div class="feed-modal-label">INSTRUCTIONS</div>
      <div class="feed-modal-text">${esc(r.recipe||"")}</div>
    </div>
    ${r.notes ? `<div class="feed-modal-section">
      <div class="feed-modal-label">NOTES</div>
      <div class="feed-modal-text">${esc(r.notes)}</div>
    </div>` : ""}
    <div class="feed-modal-footer">
      <button class="like-btn ${liked?"liked":""}" id="modal-like-btn"
        onclick="likeFromModal('${esc(r.pub_id)}')">
        ❤️ ${(r.likes||[]).length}
      </button>
      <button class="save-feed-btn" onclick="saveFromFeed('${esc(r.pub_id)}'); closeModal('feed-modal')">
        ＋ Save to my recipes
      </button>
    </div>`;
  document.getElementById("feed-modal").classList.add("open");
}

async function likeFromModal(pubId) {
  try {
    const result = await api("POST", `/feed/${pubId}/like`);
    const btn = document.getElementById("modal-like-btn");
    if (btn) {
      btn.classList.toggle("liked", result.liked);
      btn.innerHTML = `❤️ ${result.likes}`;
    }
    const r = allFeed.find(x => x.pub_id === pubId);
    if (r) {
      const did = getDeviceId();
      if (result.liked) r.likes = [...(r.likes||[]), did];
      else r.likes = (r.likes||[]).filter(l => l !== did);
    }
    renderFeed();
  } catch(e) { toast("Error: " + e.message); }
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function toggleTimer() {
  if (timerRunning) { timerRunning = false; clearInterval(timerInterval); }
  else {
    timerRunning  = true;
    timerInterval = setInterval(() => {
      if (timerCountdown) {
        timerSecs = Math.max(0, timerSecs - 1);
        if (timerSecs === 0) {
          clearInterval(timerInterval); timerRunning = false;
          setTimerDisplay("DONE ✓","timer-done");
          toast("⏱ Cooking time is up!"); return;
        }
        setTimerDisplay(fmtTime(timerSecs), timerSecs < 60 ? "timer-urgent" : "");
      } else { timerSecs++; setTimerDisplay(fmtTime(timerSecs),""); }
    }, 1000);
  }
}

function resetTimer() {
  timerRunning = false; timerCountdown = false; timerSecs = 0;
  clearInterval(timerInterval); setTimerDisplay("00:00","");
}

function setTimerFromCook() {
  const val = parseInt(document.getElementById("cook-time").value);
  if (isNaN(val)||val<=0) { toast("Enter a cook time first"); return; }
  resetTimer(); timerSecs = val * 60; timerCountdown = true;
  setTimerDisplay(fmtTime(timerSecs),""); toggleTimer();
}

function fmtTime(s) {
  return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
}
function setTimerDisplay(text, cls) {
  const el = document.getElementById("timer-display");
  el.textContent = text; el.className = "timer-display "+(cls||"");
}

// ── Upload ────────────────────────────────────────────────────────────────────
function triggerUpload() { document.getElementById("upload-input").click(); }

async function handleUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = "";
  try {
    const text = await file.text();
    if (file.name.endsWith(".json")) {
      const data   = JSON.parse(text);
      const result = await api("POST", "/recipes/import", data);
      allRecipes   = await api("GET", "/recipes");
      renderList(); toast(`✓ Imported ${result.imported} recipe(s)`);
    } else {
      const lines = text.split("\n").map(l=>l.trim()).filter(Boolean);
      const r = await api("POST", "/recipes", {
        name: lines[0]||file.name.replace(".txt",""),
        ingredients:"", recipe: lines.slice(1).join("\n")
      });
      allRecipes.unshift(r); loadRecipe(r.id); renderList();
      toast(`✓ Imported "${r.name}"`);
    }
  } catch(e) { toast("Import error: "+e.message); }
}

// ── Online search ─────────────────────────────────────────────────────────────
function openOnlineModal() {
  document.getElementById("online-modal").classList.add("open");
  searchOnline();
}

async function searchOnline() {
  const q      = document.getElementById("online-search-input").value.trim();
  const status = document.getElementById("online-status");
  const list   = document.getElementById("online-results");
  status.textContent = "Searching…"; list.innerHTML = "";
  try {
    const url  = q
      ? `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(q)}`
      : "https://www.themealdb.com/api/json/v1/1/random.php";
    const res  = await fetch(url);
    const data = await res.json();
    const meals = data.meals||[];
    if (!meals.length) { status.textContent = "No results found."; return; }
    status.textContent = `${meals.length} recipe(s) found`;
    meals.slice(0,12).forEach(meal => {
      let ings = "";
      for (let i=1;i<=20;i++) {
        const m=(meal[`strMeasure${i}`]||"").trim();
        const n=(meal[`strIngredient${i}`]||"").trim();
        if (!n) break; ings+=`${m} ${n}\n`;
      }
      const li = document.createElement("li");
      li.className = "result-item";
      li.innerHTML = `<span class="result-name">${esc(meal.strMeal.slice(0,55))}</span>
        <button class="btn btn-new" style="font-size:12px;padding:5px 12px">＋ Add</button>`;
      li.querySelector("button").onclick = async () => {
        try {
          const r = await api("POST","/recipes",{name:meal.strMeal,ingredients:ings.trim(),recipe:meal.strInstructions||""});
          allRecipes.unshift(r); loadRecipe(r.id); renderList();
          closeModal("online-modal"); toast(`✓ "${meal.strMeal}" added`);
        } catch(e) { toast("Error: "+e.message); }
      };
      list.appendChild(li);
    });
  } catch(e) { status.textContent = "Error: "+e.message; }
}

// ── Account ───────────────────────────────────────────────────────────────────
function openAccountModal() {
  document.getElementById("acc-theme").value = localStorage.getItem("theme")||"dark";
  document.getElementById("account-modal").classList.add("open");
}

function saveAccount() {
  const theme = document.getElementById("acc-theme").value;
  localStorage.setItem("theme", theme);
  applyTheme(theme);
  document.getElementById("acc-status").textContent = "✓ Saved";
  setTimeout(()=>{ document.getElementById("acc-status").textContent=""; }, 2000);
}

function applyTheme(theme) { document.body.classList.toggle("light", theme==="light"); }

function exportRecipes() {
  const blob = new Blob([JSON.stringify(allRecipes,null,2)],{type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "recipes.json"; a.click();
}

// ── Sidebar / Modal / Toast ───────────────────────────────────────────────────
function toggleSidebar() { document.getElementById("sidebar").classList.toggle("collapsed"); }
function closeModal(id)  { document.getElementById(id).classList.remove("open"); }

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.classList.remove("show"), 2400);
}

function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function cap(s) { return s.charAt(0).toUpperCase()+s.slice(1); }
