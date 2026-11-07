// Hesaba bağlı çalışma alanları. Ana akış main.js tarafından yönetilir.
let workspaceView = "archive";
let workspaceVersion = 0;
let workspaceUser = null;
let userControls = [];
let cloudDraft = null;
let draftReady = false;
let draftConflict = false;
let cloudDraftTimer;
let draftQueue = Promise.resolve();
let workspaceLoadVersion = 0;
let archiveOffset = 0;
let archiveRows = [];
let archiveVersion = 0;
let archiveBusy = false;
let archiveHasMore = false;

const workspace = document.createElement("section");
workspace.id = "featureWorkspace";
workspace.className = "feature-workspace";
workspace.hidden = true;
workspace.innerHTML = `<div class="workspace-heading"><h2 id="workspaceTitle"></h2><button type="button" data-workspace-close>Duvara dön</button></div>
  <nav class="workspace-tabs" aria-label="Çalışma alanı">
  <button type="button" data-workspace="archive">Arşiv</button>
  <button type="button" data-workspace="collections">Koleksiyonlarım</button>
  <button type="button" data-workspace="draft">Taslağım</button>
  <button type="button" data-workspace="planner">Teslim planım</button>
  <button type="button" data-workspace="controls">Gizlediğim kişiler</button></nav>
  <p id="workspaceStatus" role="status"></p><div id="workspaceContent"></div>`;
document.querySelector("main").prepend(workspace);
const workspaceNames = {
  archive: "Arşivde ara",
  collections: "Kaynak koleksiyonlarım",
  draft: "Hesabımdaki taslak",
  planner: "Teslim planlayıcısı",
  controls: "Engelleme ve sessize alma",
};

function workspaceStatus(message) {
  document.getElementById("workspaceStatus").textContent = message;
}
function requireWorkspaceUser() {
  if (workspaceUser && currentUser) return true;
  toast("Bu alan için giriş yap.");
  showAuth();
  return false;
}
function closeWorkspace() {
  workspace.hidden = true;
  workspaceVersion++;
}
async function showWorkspace(view) {
  if (!Object.hasOwn(workspaceNames, view)) return;
  if (view !== "archive" && !requireWorkspaceUser()) return;
  switchNav("duvar");
  closePanels();
  toggleMoreMenu(false);
  document.getElementById("section-duvar").style.display = "none";
  workspace.hidden = false;
  workspaceView = view;
  document.getElementById("workspaceTitle").textContent = workspaceNames[view];
  workspace
    .querySelectorAll("[data-workspace]")
    .forEach((button) =>
      button.setAttribute(
        "aria-current",
        button.dataset.workspace === view ? "page" : "false",
      ),
    );
  const version = ++workspaceVersion;
  document.getElementById("workspaceContent").innerHTML = "";
  workspaceStatus("Yükleniyor…");
  try {
    if (view === "archive") renderArchiveForm();
    else if (view === "collections") await renderCollections(version);
    else if (view === "draft") renderCloudDraft();
    else if (view === "planner") await renderPlanner(version);
    else renderControls();
    if (version === workspaceVersion) workspaceStatus("");
  } catch (error) {
    if (version === workspaceVersion)
      workspaceStatus(
        "Bu alan yüklenemedi. Sekmeye yeniden dokunarak tekrar deneyebilirsin.",
      );
    console.warn("Çalışma alanı", error.code || error.message);
  }
}

function renderArchiveForm() {
  document.getElementById("workspaceContent").innerHTML =
    `<form id="archiveForm" class="workspace-form">
    <label>Metin veya görünen ad<input name="query" type="search" maxlength="120" placeholder="Ölçek, maket, jüri…"></label>
    <div class="form-columns"><label>Tür<select name="type"><option value="">Tümü</option><option value="soru">Soru</option><option value="kaynak">Kaynak</option><option value="proje">Proje eleştirisi</option><option value="dert">Dert</option></select></label>
    <label>Başlangıç<input name="after" type="date"></label><label>Bitiş<input name="before" type="date"></label></div>
    <button type="submit">Arşivde ara</button></form><div id="archiveResults" class="workspace-list"></div><button id="archiveMore" type="button" hidden>Daha eski sonuçlar</button>`;
  document.getElementById("archiveForm").addEventListener("submit", (event) => {
    event.preventDefault();
    searchArchive(true);
  });
  document
    .getElementById("archiveMore")
    .addEventListener("click", () => searchArchive(false));
  searchArchive(true);
}
async function searchArchive(reset) {
  const form = document.getElementById("archiveForm");
  if (!form || (!reset && archiveBusy)) return;
  const fields = form.elements;
  if (
    fields.after.value &&
    fields.before.value &&
    fields.after.value > fields.before.value
  ) {
    workspaceStatus("Bitiş tarihi başlangıçtan önce olamaz.");
    return;
  }
  if (reset) {
    archiveOffset = 0;
    archiveRows = [];
  }
  const version = ++archiveVersion;
  const page = workspaceVersion;
  archiveBusy = true;
  workspaceStatus("Arşiv aranıyor…");
  document.getElementById("archiveMore").disabled = true;
  try {
    const { data, error } = await sb.rpc("duvar_archive", {
      p_query: fields.query.value.trim(),
      p_type: fields.type.value || null,
      p_after: fields.after.value || null,
      p_before: fields.before.value || null,
      p_offset: archiveOffset,
    });
    if (error) throw error;
    if (version !== archiveVersion || page !== workspaceVersion) return;
    archiveRows.push(...(data || []));
    archiveOffset += (data || []).length;
    archiveHasMore = data?.length === 40;
    await loadAvatarUrls((data || []).map((p) => p.author));
    if (version !== archiveVersion || page !== workspaceVersion) return;
    document.getElementById("archiveResults").innerHTML = archiveRows.length
      ? archiveRows
          .map(
            (p) =>
              `<article class="workspace-card"><div class="workspace-card-meta">${esc(visibleName(p.author))} · ${esc(new Date(p.created_at).toLocaleDateString("tr-TR"))}${p.resolved ? " · Çözüldü" : ""}</div><p>${esc(p.text)}</p><button type="button" data-open-archive="${Number(p.id)}">Gönderiyi ve yanıtları aç</button></article>`,
          )
          .join("")
      : "<p>Bu aramada sonuç bulunamadı.</p>";
    document.getElementById("archiveMore").hidden = !archiveHasMore;
    workspaceStatus(archiveRows.length + " sonuç gösteriliyor.");
  } catch {
    if (version === archiveVersion && page === workspaceVersion)
      workspaceStatus(
        "Arama yüklenemedi. Yeniden ara veya daha eski sonuçları tekrar yükle.",
      );
  } finally {
    if (version === archiveVersion) {
      archiveBusy = false;
      const more = document.getElementById("archiveMore");
      if (more) more.disabled = false;
    }
  }
}
async function openArchivePost(id) {
  const viewer = currentUser;
  const { data, error } = await sb
    .from("posts")
    .select("*,yorumlar!yorumlar_post_id_fkey(id,nick,text)")
    .eq("id", id)
    .eq("aktif", true)
    .maybeSingle();
  if (error || !data) {
    toast("Gönderi artık erişilebilir değil.");
    return;
  }
  const hydrated = await hydratePosts([data], viewer);
  if (viewer !== currentUser) return;
  const row = hydrated.posts[0];
  archiveFocusedPostId = id;
  if (hydrated.dislikedPosts.has(id)) dislikedPosts.add(id);
  else dislikedPosts.delete(id);
  posts = posts.filter((p) => p.id !== id);
  posts.unshift(row);
  postsLoaded = true;
  document.getElementById("searchInput").value = "";
  activeTag = null;
  setView("all");
  switchNav("duvar");
  visibleCount = Math.max(visibleCount, posts.length);
  render();
  const card = document.querySelector(`.post[data-pid="${id}"]`);
  card?.classList.add("highlighted");
  document.getElementById("c-" + id)?.classList.add("open");
  card?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function chooseSolution(postId, commentId, resolved = true) {
  const { error } = await sb.rpc("duvar_solution", {
    p_post: postId,
    p_comment: commentId,
    p_resolved: resolved,
  });
  if (error) {
    toast("Çözüm kaydedilemedi. Soru sahibi olduğundan emin ol.");
    return;
  }
  toast(resolved ? "Soru çözüldü olarak işaretlendi." : "Soru yeniden açıldı.");
  await loadPosts();
}
function renderProjectDetails(post) {
  const details = post.project_details;
  if (!details) return "";
  return `<dl class="project-details"><div><dt>Proje aşaması</dt><dd>${esc(details.stage)}</dd></div><div><dt>İstenen geri bildirim</dt><dd>${esc(details.focus)}</dd></div></dl>`;
}
function syncProjectForm() {
  document.getElementById("projectFields").hidden = selectedType !== "proje";
}
function projectPayload() {
  if (selectedType !== "proje") return null;
  return {
    stage: document.getElementById("projectStage").value.trim(),
    focus: document.getElementById("projectFocus").value.trim(),
  };
}

function hiddenAuthor(nick) {
  return userControls.some((control) => control.target_nick === nick);
}
async function setUserControl(nick, mode) {
  if (!requireWorkspaceUser()) return;
  if (nick === currentUser) return;
  const viewer = workspaceUser;
  const { error } = await sb
    .from("duvar_controls")
    .upsert(
      { owner_id: viewer, target_nick: nick, mode },
      { onConflict: "owner_id,target_nick" },
    );
  if (error) {
    toast("Tercihin kaydedilemedi.");
    return;
  }
  if (viewer !== workspaceUser) return;
  userControls = userControls.filter((control) => control.target_nick !== nick);
  userControls.push({ target_nick: nick, mode });
  closeUProfile();
  render();
  toast(
    mode === "block" ? "Kullanıcı engellendi." : "Kullanıcı sessize alındı.",
  );
}
function renderControls() {
  document.getElementById("workspaceContent").innerHTML =
    `<p>Sessize aldığın kişilerin gönderi ve yorumları akışında gizlenir. Engelleme ayrıca iki yöndeki yeni yorum, mesaj ve bildirimleri durdurur. Herkese açık içerikler arama motorlarında ve diğer hesaplarda görülebilir.</p><div class="workspace-list">${userControls.length ? userControls.map((control) => `<article class="workspace-card"><p>${esc(visibleName(control.target_nick))} · ${control.mode === "block" ? "Engellendi" : "Sessize alındı"}</p><button type="button" data-remove-control="${esc(control.target_nick)}">Kaldır</button></article>`).join("") : "<p>Henüz gizlediğin kişi yok.</p>"}</div>`;
}
async function removeControl(nick) {
  const viewer = workspaceUser;
  const { error } = await sb
    .from("duvar_controls")
    .delete()
    .eq("owner_id", viewer)
    .eq("target_nick", nick);
  if (error) {
    workspaceStatus("Tercih kaldırılamadı.");
    return;
  }
  if (viewer !== workspaceUser) return;
  userControls = userControls.filter((control) => control.target_nick !== nick);
  renderControls();
  render();
}

async function renderCollections(version) {
  const { data, error } = await sb
    .from("duvar_collections")
    .select("id,name")
    .order("created_at");
  if (error) throw error;
  if (version !== workspaceVersion) return;
  document.getElementById("workspaceContent").innerHTML =
    `<form id="collectionForm" class="workspace-form"><label>Yeni koleksiyon<input name="name" required maxlength="60" placeholder="İlk jüri, maket, ArchiCAD…"></label><button>Oluştur</button></form><div class="workspace-list">${data.length ? data.map((c) => `<article class="workspace-card"><h3>${esc(c.name)}</h3><button type="button" data-collection="${c.id}">Kaynakları aç</button><button type="button" data-delete-collection="${c.id}">Koleksiyonu sil</button><div id="collection-${c.id}"></div></article>`).join("") : "<p>Gönderilerin menüsündeki “Koleksiyona ekle” seçeneğiyle kaynak biriktirebilirsin.</p>"}</div>`;
  document
    .getElementById("collectionForm")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      button.disabled = true;
      const { error } = await sb
        .from("duvar_collections")
        .insert({ name: form.elements.name.value.trim() });
      if (error) {
        workspaceStatus(
          error.code === "23505"
            ? "Bu isimde bir koleksiyon var."
            : "Koleksiyon oluşturulamadı.",
        );
        button.disabled = false;
        return;
      }
      if (version === workspaceVersion) showWorkspace("collections");
    });
}
async function openCollection(id) {
  const version = workspaceVersion;
  const { data, error } = await sb
    .from("duvar_collection_items")
    .select("post_id,posts(id,text,author)")
    .eq("collection_id", id)
    .order("created_at", { ascending: false });
  const container = document.getElementById("collection-" + id);
  if (!container || version !== workspaceVersion) return;
  if (error) {
    workspaceStatus("Koleksiyon yüklenemedi.");
    return;
  }
  container.innerHTML = data.length
    ? data
        .map(
          (item) =>
            `<div class="collection-item"><p>${esc(item.posts?.text || "Gönderi kaldırıldı.")}</p><button type="button" data-open-archive="${Number(item.post_id)}">Aç</button><button type="button" data-remove-item="${id}" data-post="${Number(item.post_id)}">Koleksiyondan çıkar</button></div>`,
        )
        .join("")
    : "<p>Bu koleksiyonda henüz gönderi yok.</p>";
}
async function addToCollection(postId) {
  if (!requireWorkspaceUser()) return;
  await showWorkspace("collections");
  const { data, error } = await sb
    .from("duvar_collections")
    .select("id,name")
    .order("created_at");
  if (error) {
    workspaceStatus("Koleksiyonlar yüklenemedi.");
    return;
  }
  const chooser = document.createElement("form");
  chooser.className = "workspace-form";
  chooser.innerHTML = `<label>Gönderinin ekleneceği koleksiyon<select name="collection" required><option value="">Seç…</option>${data.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label><p>Yeni bir koleksiyon oluşturduysan gönderi menüsünden tekrar açabilirsin.</p><button ${data.length ? "" : "disabled"}>Gönderiyi ekle</button>`;
  document.getElementById("workspaceContent").prepend(chooser);
  chooser.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = chooser.querySelector("button");
    button.disabled = true;
    const { error } = await sb
      .from("duvar_collection_items")
      .upsert(
        { collection_id: chooser.elements.collection.value, post_id: postId },
        { onConflict: "collection_id,post_id" },
      );
    if (error) {
      workspaceStatus("Gönderi eklenemedi.");
      button.disabled = false;
      return;
    }
    chooser.remove();
    workspaceStatus("Gönderi koleksiyona eklendi.");
  });
}

async function loadWorkspaceUser() {
  const version = ++workspaceLoadVersion;
  workspaceUser = null;
  draftReady = false;
  cloudDraft = null;
  userControls = [];
  const nick = currentUser;
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (currentUser !== nick || version !== workspaceLoadVersion) return;
  if (!user || !nick) {
    clearWorkspaceUser();
    return;
  }
  workspaceUser = user.id;
  const { data, error } = await sb
    .from("duvar_controls")
    .select("target_nick,mode")
    .eq("owner_id", user.id);
  if (workspaceUser !== user.id || currentUser !== nick) return;
  if (!error) userControls = data || [];
  const result = await sb
    .from("duvar_drafts")
    .select("*")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (workspaceUser !== user.id || currentUser !== nick) return;
  if (!result.error) {
    cloudDraft = result.data || null;
    draftReady = true;
    const local = document.getElementById("mainInput").value;
    draftConflict = Boolean(cloudDraft?.body && cloudDraft.body !== local);
    document.getElementById("cloudDraftNotice").hidden = !draftConflict;
  }
  await loadAvatarUrls(userControls.map((c) => c.target_nick));
  render();
}
function clearWorkspaceUser() {
  workspaceLoadVersion++;
  workspaceUser = null;
  userControls = [];
  cloudDraft = null;
  draftReady = false;
  draftConflict = false;
  clearTimeout(cloudDraftTimer);
  closeWorkspace();
  document.getElementById("cloudDraftNotice").hidden = true;
  document.getElementById("mainInput").value = "";
  selectedType = null;
  syncProjectForm();
  syncWriteType();
  updateCharCount();
}
function scheduleCloudDraft() {
  clearTimeout(cloudDraftTimer);
  if (!workspaceUser || !draftReady || draftConflict) return;
  const snapshot = {
    body: document.getElementById("mainInput").value,
    type: selectedType,
    project: projectPayload(),
  };
  const user = workspaceUser;
  cloudDraftTimer = setTimeout(() => {
    draftQueue = draftQueue
      .catch(() => {})
      .then(() => saveCloudDraft(snapshot, user));
  }, 1200);
}
async function saveCloudDraft(snapshot, user = workspaceUser, force = false) {
  if (
    !user ||
    user !== workspaceUser ||
    !draftReady ||
    (draftConflict && !force)
  )
    return;
  const { data, error } = await sb
    .rpc("duvar_save_draft", {
      p_body: snapshot.body,
      p_type: snapshot.type,
      p_project: snapshot.project,
      p_version: cloudDraft?.version || 0,
    })
    .single();
  if (user !== workspaceUser) return;
  if (error) {
    if (error.code === "40001") draftConflict = true;
    document.getElementById("cloudDraftNotice").hidden = false;
    toast(
      error.code === "40001"
        ? "Taslak başka cihazda değişti. Taslağım alanından seçim yap."
        : "Taslak hesaba kaydedilemedi. Cihazdaki metnin duruyor.",
    );
    return;
  }
  cloudDraft = data;
  draftConflict = false;
  document.getElementById("cloudDraftNotice").hidden = true;
}
async function clearPublishedDraft(body) {
  clearTimeout(cloudDraftTimer);
  await draftQueue.catch(() => {});
  if (cloudDraft?.body === body)
    await saveCloudDraft({ body: "", type: null, project: null });
}
function renderCloudDraft() {
  document.getElementById("workspaceContent").innerHTML =
    `<p>Metin ve paylaşım türü hesabına kaydedilir. Eklediğin dosyalar paylaşılana kadar bu cihazda kalır. İki cihazdaki taslak farklıysa hangisini kullanacağını seçebilirsin.</p><div class="workspace-card"><h3>Bu cihazdaki metin</h3><p>${esc(document.getElementById("mainInput").value) || "Taslak boş."}</p><button type="button" id="saveDeviceDraft">Cihazdakini hesabıma kaydet</button></div><div class="workspace-card"><h3>Hesaptaki metin</h3><p>${esc(cloudDraft?.body || "Taslak boş.")}</p><button type="button" id="loadAccountDraft">Hesaptakini yazma alanına yükle</button></div><button type="button" id="refreshAccountDraft">Hesaptaki son taslağı getir</button>`;
  document.getElementById("saveDeviceDraft").onclick = async () => {
    if (draftConflict) {
      workspaceStatus(
        "Önce hesaptaki son taslağı getir, ardından seçimini yap.",
      );
      return;
    }
    await saveCloudDraft(
      {
        body: document.getElementById("mainInput").value,
        type: selectedType,
        project: projectPayload(),
      },
      workspaceUser,
      true,
    );
    renderCloudDraft();
  };
  document.getElementById("loadAccountDraft").onclick = () => {
    document.getElementById("mainInput").value = cloudDraft?.body || "";
    selectedType = cloudDraft?.post_type || null;
    document.getElementById("projectStage").value =
      cloudDraft?.project_details?.stage || "";
    document.getElementById("projectFocus").value =
      cloudDraft?.project_details?.focus || "";
    draftConflict = false;
    document.getElementById("cloudDraftNotice").hidden = true;
    syncWriteType();
    syncProjectForm();
    updateCharCount();
    switchNav("duvar");
    saveDraft();
  };
  document.getElementById("refreshAccountDraft").onclick = async () => {
    const viewer = workspaceUser;
    const { data, error } = await sb
      .from("duvar_drafts")
      .select("*")
      .eq("owner_id", viewer)
      .maybeSingle();
    if (error) {
      workspaceStatus("Son taslak alınamadı.");
      return;
    }
    if (viewer !== workspaceUser) return;
    cloudDraft = data;
    draftReady = true;
    draftConflict = false;
    renderCloudDraft();
  };
}

async function renderPlanner(version) {
  const { data, error } = await sb
    .from("duvar_plans")
    .select("id,title,due_date,duvar_plan_tasks(id,label,done,created_at)")
    .order("due_date");
  if (error) throw error;
  if (version !== workspaceVersion) return;
  document.getElementById("workspaceContent").innerHTML =
    `<form id="planForm" class="workspace-form"><div class="form-columns"><label>Teslim başlığı<input name="title" required maxlength="100" placeholder="Stüdyo final teslimi"></label><label>Teslim tarihi<input name="due" type="date" required></label></div><button>Plan oluştur</button></form><p>Planlar ve işaretlediğin işler hesabına özeldir. Başlangıç listesi ekleyebilir, kendi görevlerini yazabilirsin.</p><div class="workspace-list">${
      data.length
        ? data
            .map((plan) => {
              const tasks = plan.duvar_plan_tasks.sort(
                (a, b) =>
                  a.position - b.position ||
                  a.created_at.localeCompare(b.created_at) ||
                  a.id.localeCompare(b.id),
              );
              const completed = tasks.filter((t) => t.done).length;
              const days = Math.round(
                (new Date(plan.due_date + "T00:00:00") -
                  new Date().setHours(0, 0, 0, 0)) /
                  86400000,
              );
              return `<article class="workspace-card"><h3>${esc(plan.title)}</h3><p>${esc(new Date(plan.due_date + "T12:00:00").toLocaleDateString("tr-TR"))} · ${days < 0 ? "Tarih geçti" : days === 0 ? "Bugün" : days + " gün kaldı"} · ${completed}/${tasks.length} tamamlandı</p><progress max="${tasks.length || 1}" value="${completed}" aria-label="Tamamlanan işler"></progress><ul class="task-list">${tasks.map((task) => `<li><label><input type="checkbox" data-task="${task.id}" ${task.done ? "checked" : ""}>${esc(task.label)}</label><button type="button" data-delete-task="${task.id}" aria-label="Görevi kaldır">Kaldır</button></li>`).join("")}</ul><form class="workspace-form" data-task-form="${plan.id}"><label>Yeni görev<input name="label" required maxlength="160"></label><button>Görev ekle</button></form><button type="button" data-plan-template="${plan.id}">Teslim kontrol listesi ekle</button><button type="button" data-delete-plan="${plan.id}">Planı sil</button><p><a href="/#araclar/olcek">Ölçek aracı</a> · <a href="/#araclar/juri">Jüri hazırlığı</a></p></article>`;
            })
            .join("")
        : "<p>İlk teslimini ekleyerek başla.</p>"
    }</div>`;
  document.getElementById("planForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    form.querySelector("button").disabled = true;
    const { error } = await sb
      .from("duvar_plans")
      .insert({
        title: form.elements.title.value.trim(),
        due_date: form.elements.due.value,
      });
    if (error) {
      workspaceStatus("Plan oluşturulamadı.");
      form.querySelector("button").disabled = false;
      return;
    }
    if (version === workspaceVersion) showWorkspace("planner");
  };
  workspace.querySelectorAll("[data-task-form]").forEach(
    (form) =>
      (form.onsubmit = async (event) => {
        event.preventDefault();
        form.querySelector("button").disabled = true;
        const { error } = await sb
          .from("duvar_plan_tasks")
          .insert({
            plan_id: form.dataset.taskForm,
            label: form.elements.label.value.trim(),
          });
        if (error) {
          workspaceStatus("Görev eklenemedi.");
          form.querySelector("button").disabled = false;
          return;
        }
        if (version === workspaceVersion) showWorkspace("planner");
      }),
  );
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  try {
    if (button.dataset.workspace) {
      showWorkspace(button.dataset.workspace);
      return;
    }
    if (button.hasAttribute("data-workspace-close")) {
      switchNav("duvar");
      return;
    }
    if (button.dataset.openArchive) {
      openArchivePost(Number(button.dataset.openArchive));
      return;
    }
    if (button.dataset.collection) {
      openCollection(button.dataset.collection);
      return;
    }
    if (button.dataset.removeControl) {
      removeControl(button.dataset.removeControl);
      return;
    }
    const version = workspaceVersion;
    button.disabled = true;
    let result;
    if (button.dataset.deleteCollection) {
      if (
        !confirm(
          "Koleksiyon ve içindeki kayıtlar kaldırılsın mı? Gönderiler duvarda kalır.",
        )
      )
        return;
      result = await sb
        .from("duvar_collections")
        .delete()
        .eq("id", button.dataset.deleteCollection);
    } else if (button.dataset.removeItem) {
      result = await sb
        .from("duvar_collection_items")
        .delete()
        .eq("collection_id", button.dataset.removeItem)
        .eq("post_id", Number(button.dataset.post));
    } else if (button.dataset.deletePlan) {
      if (!confirm("Bu teslim planı ve görevleri kaldırılsın mı?")) return;
      result = await sb
        .from("duvar_plans")
        .delete()
        .eq("id", button.dataset.deletePlan);
    } else if (button.dataset.deleteTask) {
      result = await sb
        .from("duvar_plan_tasks")
        .delete()
        .eq("id", button.dataset.deleteTask);
    } else if (button.dataset.planTemplate) {
      result = await sb.from("duvar_plan_tasks").upsert(
        [
          "Konsept ve proje anlatısını kontrol et",
          "Plan, kesit ve görünüşleri kontrol et",
          "Ölçekleri ve pafta yazılarını kontrol et",
          "Dosyaları yedekle ve çıktı provası al",
          "Sunumu prova et",
        ].map((label, position) => ({
          plan_id: button.dataset.planTemplate,
          label,
          position,
        })),
        { onConflict: "plan_id,label", ignoreDuplicates: true },
      );
    } else return;
    if (result.error) {
      workspaceStatus("Değişiklik kaydedilemedi. Tekrar dene.");
      return;
    }
    if (version === workspaceVersion) showWorkspace(workspaceView);
  } catch {
    workspaceStatus("İşlem tamamlanamadı. Tekrar dene.");
  } finally {
    button.disabled = false;
  }
});
document.addEventListener("change", async (event) => {
  const input = event.target.closest("[data-task]");
  if (!input) return;
  const done = input.checked;
  input.disabled = true;
  const version = workspaceVersion;
  const { error } = await sb
    .from("duvar_plan_tasks")
    .update({ done })
    .eq("id", input.dataset.task);
  if (error) {
    input.checked = !done;
    input.disabled = false;
    workspaceStatus("Görev kaydedilemedi.");
    return;
  }
  if (version === workspaceVersion) showWorkspace("planner");
});
sb.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    clearWorkspaceUser();
    render();
  }
});
document
  .getElementById("projectStage")
  .addEventListener("change", scheduleCloudDraft);
document
  .getElementById("projectFocus")
  .addEventListener("input", scheduleCloudDraft);
if (currentUser)
  loadWorkspaceUser().catch(() =>
    toast("Hesaba bağlı alanlar yüklenemedi. Sayfayı yenileyebilirsin."),
  );

// Hata kaydına kullanıcı metni, e-posta, bağlantı parametreleri veya hata mesajı yazılmaz.
let lastErrorReport = 0;
function recordClientError(kind, filename, line) {
  if (!workspaceUser || Date.now() - lastErrorReport < 60000) return;
  lastErrorReport = Date.now();
  let source = "other";
  try {
    const name = new URL(filename || "", location.origin).pathname
      .split("/")
      .pop();
    if (["main.js", "features.js", "utils.js"].includes(name)) source = name;
  } catch {}
  sb.rpc("duvar_record_client_error", {
    p_kind: kind,
    p_source: source,
    p_line: Math.max(0, Math.min(100000, Number(line) || 0)),
  })
    .then(() => {})
    .catch(() => {});
}
window.addEventListener("error", (event) =>
  recordClientError("script", event.filename, event.lineno),
);
window.addEventListener("unhandledrejection", () =>
  recordClientError("promise", "", 0),
);
