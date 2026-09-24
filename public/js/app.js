// ---------- Auth & credits state ----------
let currentUser = null;
let selectedPlan = "weekly";
let hasOwnGeminiKey = false;
async function refreshAuthState() {
  try {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    currentUser = data.user;
  } catch {
    currentUser = null;
  }

  if (currentUser) {
    // Never let this optional lookup break the header. If the endpoint is
    // missing or returns HTML, the catch-all serves index.html with a 200
    // and .json() throws - which previously aborted refreshAuthState()
    // before renderAccountArea(), leaving logged-in users with an empty
    // top bar: no credits, no log out.
    try {
      const statusRes = await fetch("/api/account/gemini-key/status");
      const statusData = await statusRes.json();
      hasOwnGeminiKey = Boolean(statusData.connected);
    } catch {
      hasOwnGeminiKey = false;
    }
  }

  renderAccountArea();
}
function renderAccountArea() {
  const accountEl = document.getElementById("accountArea");
  const creditsEl = document.getElementById("creditsArea");
  if (currentUser) {
    creditsEl.innerHTML = `<span class="credits-badge">${currentUser.credits} credits</span>`;
    accountEl.innerHTML = `      <div class="account-chip">        <span>${currentUser.email}</span>        <button id="apiKeyBtn">${hasOwnGeminiKey ? "Gemini key ✓" : "Connect Gemini key"}</button>        <button id="upgradeChipBtn">Get credits</button>        <button id="logoutBtn">Log out</button>      </div>`;
    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      currentUser = null;
      renderAccountArea();
    });
    document.getElementById("upgradeChipBtn").addEventListener("click", () => {
      document.getElementById("upgradeModal").hidden = false;
    });
    document.getElementById("apiKeyBtn").addEventListener("click", () => {
      document.getElementById("apiKeyModal").hidden = false;
      document.getElementById("apiKeyStatus").textContent = hasOwnGeminiKey
        ? "A key is connected. Paste a new one to replace it, or disconnect below."
        : "Paste your own Gemini key so your real generations run on your account, not ours.";
      document.getElementById("disconnectKeyBtn").hidden = !hasOwnGeminiKey;
    });
  } else {
    creditsEl.innerHTML = "";
    accountEl.innerHTML = `<button class="account-btn" id="loginBtn">Log in / Sign up</button>`;
    document
      .getElementById("loginBtn")
      .addEventListener("click", () => openAuthModal("signup"));
  }
}
// ---------- Auth modal ----------
const authModal = document.getElementById("authModal");
const authForm = document.getElementById("authForm");
const authError = document.getElementById("authError");
const authSubmitBtn = document.getElementById("authSubmitBtn");
let authMode = "login";
function openAuthModal(mode) {
  authMode = mode;
  document
    .querySelectorAll("[data-auth-tab]")
    .forEach((t) => t.classList.toggle("active", t.dataset.authTab === mode));
  authSubmitBtn.textContent =
    mode === "login" ? "Log in" : "Create account — get 25 free credits";
  authError.hidden = true;
  authForm.reset();
  authModal.hidden = false;
}
document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
  tab.addEventListener("click", () => openAuthModal(tab.dataset.authTab));
});
document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    authModal.hidden = true;
    document.getElementById("upgradeModal").hidden = true;
  });
});
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  authError.hidden = true;
  try {
    const res = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong");
    currentUser = data;
    renderAccountArea();
    authModal.hidden = true;
  } catch (err) {
    authError.textContent = err.message;
    authError.hidden = false;
  }
});
// ---------- Plan picker & checkout ----------
document.querySelectorAll(".plan-option").forEach((opt) => {
  opt.addEventListener("click", () => {
    document
      .querySelectorAll(".plan-option")
      .forEach((o) => o.classList.remove("selected"));
    opt.classList.add("selected");
    selectedPlan = opt.dataset.plan;
  });
});
async function startCheckout() {
  if (!currentUser) {
    document.getElementById("upgradeModal").hidden = true;
    return openAuthModal("signup");
  }
  try {
    const res = await fetch("/api/billing/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: selectedPlan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not start checkout");
    window.location.href = data.url;
  } catch (err) {
    alert(err.message);
  }
}
document.getElementById("upgradeBtn").addEventListener("click", startCheckout);
function maybeShowUpgradeModal(apiResult) {
  if (apiResult && apiResult.requiresCredits) {
    document.getElementById("upgradeModal").hidden = false;
  }
}
// ---------- Gemini API key (BYOK) modal ----------
const apiKeyForm = document.getElementById("apiKeyForm");
if (apiKeyForm) {
  apiKeyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("apiKeyInput");
    const errorEl = document.getElementById("apiKeyError");
    errorEl.hidden = true;
    try {
      const res = await fetch("/api/account/gemini-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: input.value.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save key");
      hasOwnGeminiKey = true;
      input.value = "";
      renderAccountArea();
      refreshProviderStatus();
      document.getElementById("apiKeyModal").hidden = true;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });
  document
    .getElementById("disconnectKeyBtn")
    .addEventListener("click", async () => {
      await fetch("/api/account/gemini-key", { method: "DELETE" });
      hasOwnGeminiKey = false;
      renderAccountArea();
      refreshProviderStatus();
      document.getElementById("apiKeyModal").hidden = true;
    });
}
refreshAuthState();
// ---------- Tab switching ----------
const toolItems = document.querySelectorAll(".tool-item");
const panelViews = document.querySelectorAll(".panel-view");
toolItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    toolItems.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.tool;
    panelViews.forEach((v) => {
      v.hidden = v.dataset.view !== target;
    });
  });
});
// ---------- Provider status ----------
// Which provider each tool depends on, so the rail can show what is actually
// usable right now instead of letting people click into a placeholder.
const TOOL_PROVIDER = {
  "text-to-image": "image",
  "image-to-image": "image",
  "text-to-video": "video",
  "image-to-video": "video",
  songwriting: "songwriting",
  music: "music",
  "music-video": "video",
  "pixar-short-film": "video",
  "pixar-long-film": "video",
  voiceover: "voiceover",
};

const PROVIDER_HINT = {
  image: "needs a Gemini key",
  songwriting: "needs a Gemini key",
  video: "needs a Luma or Runway key",
  music: "needs an ElevenLabs key",
  voiceover: "needs an ElevenLabs key",
};

// Re-read after connecting or disconnecting a personal key: with BYOK the
// answer is per-account, not per-server.
async function refreshProviderStatus() {
  let status;
  try {
    const res = await fetch("/api/status");
    status = await res.json();
  } catch {
    return;
  }

  document.querySelectorAll("[data-demo-for]").forEach((badge) => {
    badge.hidden = Boolean(status[badge.dataset.demoFor]);
  });

  // Hide tools whose provider is not configured, rather than showing a
  // tool that can only ever return a stock placeholder. They reappear the
  // moment a key exists - including a personal key connected via BYOK.
  document.querySelectorAll(".tool-item").forEach((item) => {
    const provider = TOOL_PROVIDER[item.dataset.tool];
    const available = provider ? Boolean(status[provider]) : true;
    item.hidden = !available;
    item.title = available ? "" : `Unavailable - ${PROVIDER_HINT[provider]}`;
  });

  document.querySelectorAll(".panel-view").forEach((view) => {
    const provider = TOOL_PROVIDER[view.dataset.view];
    if (provider && !status[provider]) view.hidden = true;
  });

  // Renumber the visible tools so the rail always reads 1..n.
  let n = 0;
  document.querySelectorAll(".tool-item").forEach((item) => {
    if (item.hidden) return;
    n++;
    const num = item.querySelector(".num");
    if (num) num.textContent = String(n);
  });

  // The default tab may now be hidden; fall back to the first visible tool.
  const active = document.querySelector(".tool-item.active");
  if (!active || active.hidden) {
    const first = document.querySelector(".tool-item:not([hidden])");
    if (first) first.click();
  }

  // If everything is hidden, say so instead of showing an empty studio.
  const anyVisible = Boolean(
    document.querySelector(".tool-item:not([hidden])"),
  );
  const rail = document.getElementById("toolRail");
  let emptyMsg = document.getElementById("noToolsMessage");
  if (!anyVisible && !emptyMsg && rail) {
    emptyMsg = document.createElement("p");
    emptyMsg.id = "noToolsMessage";
    emptyMsg.className = "provider-note";
    emptyMsg.textContent =
      "No tools are available yet - the server has no provider keys configured. Connect your own Gemini key to enable the image and songwriting tools.";
    rail.appendChild(emptyMsg);
  } else if (anyVisible && emptyMsg) {
    emptyMsg.remove();
  }
}

refreshProviderStatus();
// ---------- Helpers ----------
function setLoading(outEl, btn, isLoading, label) {
  if (isLoading) {
    btn.disabled = true;
    btn.dataset.originalLabel = btn.textContent;
    btn.textContent = "Working…";
    outEl.classList.add("empty");
    outEl.innerHTML = "";
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.originalLabel || label;
  }
}
function renderCaption(outEl, text) {
  const cap = document.createElement("div");
  cap.className = "output-caption";
  cap.textContent = text;
  outEl.appendChild(cap);
}
function demoOrCreditsCaption(data, realLabel, keyHint) {
  if (!data.demo) return realLabel;
  return data.requiresCredits
    ? `Demo placeholder — need ${data.creditsNeeded} credits (you have ${currentUser ? currentUser.credits : 0})`
    : `Demo placeholder — ${keyHint}`;
}
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}
function syncCreditsFromResult(data) {
  if (currentUser && typeof data.creditsRemaining === "number") {
    currentUser.credits = data.creditsRemaining;
    renderAccountArea();
  }
}
// ---------- Text to Image ----------
document
  .querySelector('[data-action="text-to-image"]')
  .addEventListener("click", async (e) => {
    const btn = e.target,
      outEl = document.getElementById("out-text-to-image");
    const prompt = document.getElementById("ti-prompt").value.trim();
    if (!prompt) return alert("Describe an image first.");
    setLoading(outEl, btn, true);
    try {
      const data = await postJSON("/api/text-to-image", {
        prompt,
        style: document.getElementById("ti-style").value,
        size: document.getElementById("ti-size").value,
      });
      outEl.classList.remove("empty");
      const img = document.createElement("img");
      img.src = data.imageUrl;
      outEl.appendChild(img);
      renderCaption(
        outEl,
        demoOrCreditsCaption(data, "Generated", "add a Gemini key to go live"),
      );
      syncCreditsFromResult(data);
      maybeShowUpgradeModal(data);
    } catch (err) {
      outEl.innerHTML = `<p style="color:#FF6B6B">${err.message}</p>`;
    } finally {
      setLoading(outEl, btn, false, "Generate image");
    }
  });
// ---------- Image to Image ----------
document
  .querySelector('[data-action="image-to-image"]')
  .addEventListener("click", async (e) => {
    const btn = e.target,
      outEl = document.getElementById("out-image-to-image");
    const imageUrl = document.getElementById("ii-image").value.trim();
    const prompt = document.getElementById("ii-prompt").value.trim();
    if (!imageUrl || !prompt)
      return alert("Add a source image URL and a change to make.");
    setLoading(outEl, btn, true);
    try {
      const data = await postJSON("/api/image-to-image", { imageUrl, prompt });
      outEl.classList.remove("empty");
      const img = document.createElement("img");
      img.src = data.imageUrl;
      outEl.appendChild(img);
      renderCaption(
        outEl,
        demoOrCreditsCaption(data, "Generated", "add a Gemini key to go live"),
      );
      syncCreditsFromResult(data);
      maybeShowUpgradeModal(data);
    } catch (err) {
      outEl.innerHTML = `<p style="color:#FF6B6B">${err.message}</p>`;
    } finally {
      setLoading(outEl, btn, false, "Generate");
    }
  });
// ---------- Video result renderer (shared) ----------
function renderVideoResult(outEl, data) {
  outEl.classList.remove("empty");
  if (data.videoUrl) {
    const video = document.createElement("video");
    video.src = data.videoUrl;
    video.controls = true;
    outEl.appendChild(video);
    renderCaption(
      outEl,
      demoOrCreditsCaption(
        data,
        "Generated",
        "add RUNWAY_API_KEY or LUMA_API_KEY to go live",
      ),
    );
    syncCreditsFromResult(data);
    maybeShowUpgradeModal(data);
  } else if (data.pollUrl) {
    outEl.innerHTML = `<p>Queued — job ${data.jobId}. ${data.note || ""} Poll <code>${data.pollUrl}</code> for the finished result.</p>`;
    syncCreditsFromResult(data);
  } else {
    outEl.innerHTML = `<p style="color:#8A919C">No result returned.</p>`;
  }
}
// ---------- Text to Video ----------
document
  .querySelector('[data-action="text-to-video"]')
  .addEventListener("click", async (e) => {
    const btn = e.target,
      outEl = document.getElementById("out-text-to-video");
    const prompt = document.getElementById("tv-prompt").value.trim();
    if (!prompt) return alert("Describe a video first.");
    setLoading(outEl, btn, true);
    try {
      const data = await postJSON("/api/video/text-to-video", {
        prompt,
        duration: Number(document.getElementById("tv-duration").value),
        aspectRatio: document.getElementById("tv-aspect").value,
      });
      renderVideoResult(outEl, data);
    } catch (err) {
      outEl.innerHTML = `<p style="color:#FF6B6B">${err.message}</p>`;
    } finally {
      setLoading(outEl, btn, false, "Generate video");
    }
  });
// ---------- Image to Video ----------
document
  .querySelector('[data-action="image-to-video"]')
  .addEventListener("click", async (e) => {
    const btn = e.target,
      outEl = document.getElementById("out-image-to-video");
    const imageUrl = document.getElementById("iv-image").value.trim();
    if (!imageUrl) return alert("Paste an image URL first.");
    setLoading(outEl, btn, true);
    try {
      const data = await postJSON("/api/video/image-to-video", {
        imageUrl,
        prompt: document.getElementById("iv-prompt").value.trim(),
      });
      renderVideoResult(outEl, data);
    } catch (err) {
      outEl.innerHTML = `<p style="color:#FF6B6B">${err.message}</p>`;
    } finally {
      setLoading(outEl, btn, false, "Generate video");
    }
  });
// ---------- Songwriting ----------
document
  .querySelector('[data-action="songwriting"]')
  .addEventListener("click", async (e) => {
    const btn = e.target,
      outEl = document.getElementById("out-songwriting");
    const topic = document.getElementById("sw-topic").value.trim();
    if (!topic) return alert("What's the song about?");
    setLoading(outEl, btn, true);
    try {
      const data = await postJSON("/api/songwriting", {
        topic,
        genre: document.getElementById("sw-genre").value,
        mood: document.getElementById("sw-mood").value,
      });
      outEl.classList.remove("empty");
      const pre = document.createElement("pre");
      pre.textContent = data.lyrics;
      outEl.appendChild(pre);
      renderCaption(
        outEl,
        demoOrCreditsCaption(data, "Generated", "add a Gemini key to go live"),
      );
      syncCreditsFromResult(data);
      maybeShowUpgradeModal(data);
      // convenience: carry lyrics over to the Music and Music Video tabs
      document.getElementById("mu-lyrics").value = data.lyrics || "";
      document.getElementById("mv-lyrics").value = data.lyrics || "";
    } catch (err) {
      outEl.innerHTML = `<p style="color:#FF6B6B">${err.message}</p>`;
    } finally {
      setLoading(outEl, btn, false, "Write lyrics");
    }
  });
// ---------- Music ----------
document
  .querySelector('[data-action="music"]')
  .addEventListener("click", async (e) => {
    const btn = e.target,
      outEl = document.getElementById("out-music");
    const prompt = document.getElementById("mu-prompt").value.trim();
    if (!prompt) return alert("Describe the track first.");
    setLoading(outEl, btn, true);
    try {
      const data = await postJSON("/api/music", {
        prompt,
        lyrics: document.getElementById("mu-lyrics").value.trim(),
        genre: document.getElementById("mu-genre").value,
        durationSeconds: Number(document.getElementById("mu-duration").value),
        addVocalGuide: document.getElementById("mu-vocal-guide").checked,
      });
      outEl.classList.remove("empty");
      const audio = document.createElement("audio");
      audio.src = data.audioUrl;
      audio.controls = true;
      outEl.appendChild(audio);
      renderCaption(
        outEl,
        demoOrCreditsCaption(
          data,
          "Generated",
          "add ELEVENLABS_API_KEY to go live",
        ),
      );
      syncCreditsFromResult(data);
      maybeShowUpgradeModal(data);
      if (data.vocalGuide) {
        const vgWrap = document.createElement("div");
        vgWrap.style.marginTop = "14px";
        const vgLabel = document.createElement("p");
        vgLabel.style.fontSize = "13px";
        vgLabel.style.color = "#8A919C";
        vgLabel.textContent =
          data.vocalGuideNote || "Vocal guide (spoken-word):";
        vgWrap.appendChild(vgLabel);
        if (data.vocalGuide.vocalGuideAudioUrl) {
          const vgAudio = document.createElement("audio");
          vgAudio.src = data.vocalGuide.vocalGuideAudioUrl;
          vgAudio.controls = true;
          vgWrap.appendChild(vgAudio);
        }
        outEl.appendChild(vgWrap);
        if (data.vocalGuide.requiresCredits)
          maybeShowUpgradeModal({ requiresCredits: true });
      }
    } catch (err) {
      outEl.innerHTML = `<p style="color:#FF6B6B">${err.message}</p>`;
    } finally {
      setLoading(outEl, btn, false, "Generate music");
    }
  });
// ---------- Music Video ----------
document
  .querySelector('[data-action="music-video"]')
  .addEventListener("click", async (e) => {
    const btn = e.target,
      outEl = document.getElementById("out-music-video");
    const songPrompt = document.getElementById("mv-song").value.trim();
    const visualPrompt = document.getElementById("mv-visual").value.trim();
    if (!songPrompt || !visualPrompt)
      return alert("Fill in both the song topic and visual style.");
    setLoading(outEl, btn, true);
    try {
      const data = await postJSON("/api/music-video", {
        songPrompt,
        visualPrompt,
        lyrics: document.getElementById("mv-lyrics").value.trim(),
      });
      renderVideoResult(outEl, data);
    } catch (err) {
      outEl.innerHTML = `<p style="color:#FF6B6B">${err.message}</p>`;
    } finally {
      setLoading(outEl, btn, false, "Generate music video");
    }
  });
// ---------- Pixar Short Film ----------
document
  .querySelector('[data-action="pixar-short-film"]')
  .addEventListener("click", async (e) => {
    const btn = e.target,
      outEl = document.getElementById("out-pixar-short-film");
    const prompt = document.getElementById("ps-prompt").value.trim();
    if (!prompt) return alert("Describe the scene first.");
    setLoading(outEl, btn, true);
    try {
      const data = await postJSON("/api/pixar/short-film", {
        prompt,
        duration: Number(document.getElementById("ps-duration").value),
        narration: document.getElementById("ps-narration").value.trim(),
      });
      renderVideoResult(outEl, data);
      if (data.narration) {
        const nWrap = document.createElement("div");
        nWrap.style.marginTop = "14px";
        const nLabel = document.createElement("p");
        nLabel.style.fontSize = "13px";
        nLabel.style.color = "#8A919C";
        nLabel.textContent =
          "Narration track (separate file — combine manually):";
        nWrap.appendChild(nLabel);
        if (data.narration.narrationAudioUrl) {
          const nAudio = document.createElement("audio");
          nAudio.src = data.narration.narrationAudioUrl;
          nAudio.controls = true;
          nWrap.appendChild(nAudio);
        }
        outEl.appendChild(nWrap);
        if (data.narration.requiresCredits)
          maybeShowUpgradeModal({ requiresCredits: true });
      }
    } catch (err) {
      outEl.innerHTML = `<p style="color:#FF6B6B">${err.message}</p>`;
    } finally {
      setLoading(outEl, btn, false, "Generate short film");
    }
  });
// ---------- Pixar Long Film ----------
document
  .querySelector('[data-action="pixar-long-film"]')
  .addEventListener("click", async (e) => {
    const btn = e.target,
      outEl = document.getElementById("out-pixar-long-film");
    const title = document.getElementById("pl-title").value.trim();
    const scenesRaw = document.getElementById("pl-scenes").value.trim();
    const scenes = scenesRaw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (scenes.length === 0)
      return alert("Add at least one scene, one per line.");
    setLoading(outEl, btn, true);
    try {
      const data = await postJSON("/api/pixar/long-film", {
        title,
        scenes,
        narration: document.getElementById("pl-narration").value.trim(),
      });
      outEl.classList.remove("empty");
      const summary = document.createElement("p");
      summary.innerHTML = `<strong>${data.title}</strong> — ${data.scenesQueued} of ${data.totalScenes} scenes queued.`;
      outEl.appendChild(summary);
      data.scenes.forEach((scene, i) => {
        const row = document.createElement("div");
        row.style.marginTop = "14px";
        if (scene.videoUrl) {
          const video = document.createElement("video");
          video.src = scene.videoUrl;
          video.controls = true;
          video.style.maxWidth = "260px";
          row.appendChild(video);
        } else if (scene.pollUrl) {
          row.innerHTML = `<p>Scene ${i + 1} queued — job ${scene.jobId}. Poll <code>${scene.pollUrl}</code>.</p>`;
        }
        const caption = document.createElement("p");
        caption.style.color = "#8A919C";
        caption.style.fontSize = "13px";
        caption.textContent = `Scene ${i + 1}: ${scene.scenePrompt}${scene.demo ? (scene.requiresCredits ? ` — needs ${scene.creditsNeeded} credits` : " — demo placeholder") : ""}`;
        row.appendChild(caption);
        outEl.appendChild(row);
      });
      if (data.narration) {
        const nWrap = document.createElement("div");
        nWrap.style.marginTop = "14px";
        const nLabel = document.createElement("p");
        nLabel.style.fontSize = "13px";
        nLabel.style.color = "#8A919C";
        nLabel.textContent = "Whole-film narration track (separate file):";
        nWrap.appendChild(nLabel);
        if (data.narration.narrationAudioUrl) {
          const nAudio = document.createElement("audio");
          nAudio.src = data.narration.narrationAudioUrl;
          nAudio.controls = true;
          nWrap.appendChild(nAudio);
        }
        outEl.appendChild(nWrap);
        if (data.narration.requiresCredits)
          maybeShowUpgradeModal({ requiresCredits: true });
      }
      if (data.note) {
        const note = document.createElement("p");
        note.style.color = "#A78BFA";
        note.style.fontSize = "13px";
        note.style.marginTop = "14px";
        note.textContent = data.note;
        outEl.appendChild(note);
      }
      // Refresh the credit badge from whichever scene actually spent credits
      const lastReal = [...data.scenes]
        .reverse()
        .find((s) => typeof s.creditsRemaining === "number");
      if (lastReal) syncCreditsFromResult(lastReal);
      if (data.scenes.some((s) => s.requiresCredits))
        maybeShowUpgradeModal({ requiresCredits: true });
    } catch (err) {
      outEl.innerHTML = `<p style="color:#FF6B6B">${err.message}</p>`;
    } finally {
      setLoading(outEl, btn, false, "Generate all scenes");
    }
  });
// ---------- Voiceover ----------
document
  .querySelector('[data-action="voiceover"]')
  .addEventListener("click", async (e) => {
    const btn = e.target,
      outEl = document.getElementById("out-voiceover");
    const text = document.getElementById("vo-text").value.trim();
    if (!text) return alert("Write a script first.");
    setLoading(outEl, btn, true);
    try {
      const data = await postJSON("/api/voiceover", {
        text,
        voiceId: document.getElementById("vo-voice").value,
      });
      outEl.classList.remove("empty");
      const audio = document.createElement("audio");
      audio.src = data.audioUrl;
      audio.controls = true;
      outEl.appendChild(audio);
      renderCaption(
        outEl,
        demoOrCreditsCaption(
          data,
          "Generated",
          "add ELEVENLABS_API_KEY to go live",
        ),
      );
      syncCreditsFromResult(data);
      maybeShowUpgradeModal(data);
    } catch (err) {
      outEl.innerHTML = `<p style="color:#FF6B6B">${err.message}</p>`;
    } finally {
      setLoading(outEl, btn, false, "Generate voiceover");
    }
  });
