const POSTR_BUTTON_CLASS = "postr-subscribe-button";
const POSTR_ACTION_CLASS = "postr-action";
const ACTIONS_SELECTOR = "yt-flexible-actions-view-model.ytFlexibleActionsViewModelHost";

let currentChannelKey = "";
let renderTimer = null;

scheduleRender();
window.addEventListener("yt-navigate-finish", scheduleRender);
window.addEventListener("popstate", scheduleRender);

const observer = new MutationObserver(scheduleRender);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPostrButton, 250);
}

async function renderPostrButton() {
  const channel = getCurrentChannel();
  const actionsHost = findActionsHost();

  if (!actionsHost || !channel) {
    removeInjectedButtons();
    currentChannelKey = "";
    return;
  }

  const nextKey = `${channel.postsUrl}:${location.pathname}`;
  if (nextKey === currentChannelKey && actionsHost.querySelector(`.${POSTR_BUTTON_CLASS}`)) return;
  currentChannelKey = nextKey;

  removeInjectedButtons();

  const action = document.createElement("div");
  action.className = `ytFlexibleActionsViewModelAction ${POSTR_ACTION_CLASS}`;

  const button = document.createElement("button");
  button.className = POSTR_BUTTON_CLASS;
  button.type = "button";
  button.textContent = "Subscribe for POSTR";
  button.setAttribute("aria-label", `Subscribe ${channel.name} for POSTR notifications`);

  action.append(button);
  actionsHost.append(action);

  const alreadyWatching = await isAlreadyWatching(channel.postsUrl);
  setButtonState(button, alreadyWatching ? "added" : "ready");

  button.addEventListener("click", async () => {
    setButtonState(button, "working");

    try {
      const result = await addChannel(channel);
      setButtonState(button, "added");

      if (result.added) {
        chrome.runtime.sendMessage({
          type: "POSTR_CHECK_CHANNEL",
          channel: result.channel,
          forceNotify: false
        });
      }
    } catch (error) {
      console.error("POSTR add failed", error);
      setButtonState(button, "error");
    }
  });
}

function findActionsHost() {
  const hosts = [...document.querySelectorAll(ACTIONS_SELECTOR)];
  return hosts.find((host) => host.querySelector("yt-subscribe-button-view-model")) || hosts[0] || null;
}

function removeInjectedButtons() {
  document.querySelectorAll(`.${POSTR_ACTION_CLASS}`).forEach((node) => node.remove());
}

function getCurrentChannel() {
  const postsUrl = getPostsUrl();
  if (!postsUrl) return null;

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `postr-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: getChannelName(),
    postsUrl,
    createdAt: Date.now(),
    source: "youtube-button"
  };
}

function getPostsUrl() {
  const communityLink = document.querySelector(
    'yt-flexible-actions-view-model a[href*="/community"], a[aria-label="Community"][href]'
  );

  if (communityLink) {
    return normalizePostsUrl(communityLink.getAttribute("href"));
  }

  const pathname = location.pathname;
  const handleMatch = pathname.match(/^\/(@[^/]+)/);
  if (handleMatch) return normalizePostsUrl(`/${handleMatch[1]}/posts`);

  const channelMatch = pathname.match(/^\/channel\/([^/]+)/);
  if (channelMatch) return normalizePostsUrl(`/channel/${channelMatch[1]}/posts`);

  return "";
}

function normalizePostsUrl(input) {
  try {
    const raw = String(input || "").trim();
    const withProtocol = raw.startsWith("http")
      ? raw
      : `https://www.youtube.com/${raw.replace(/^\/+/, "")}`;
    const url = new URL(withProtocol);

    if (!url.hostname.endsWith("youtube.com")) return "";

    url.pathname = url.pathname
      .replace(/\/community\/?$/, "/posts")
      .replace(/\/featured\/?$/, "/posts")
      .replace(/\/videos\/?$/, "/posts")
      .replace(/\/shorts\/?$/, "/posts")
      .replace(/\/streams\/?$/, "/posts")
      .replace(/\/about\/?$/, "/posts")
      .replace(/\/+$/, "");

    if (!url.pathname.endsWith("/posts")) {
      url.pathname = `${url.pathname}/posts`;
    }

    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

function getChannelName() {
  const headerName =
    document.querySelector("yt-page-header-view-model h1")?.textContent ||
    document.querySelector("ytd-channel-name yt-formatted-string")?.textContent ||
    document.querySelector("h1")?.textContent ||
    document.title.replace(/ - YouTube$/, "");

  return String(headerName || "YouTube Channel").replace(/\s+/g, " ").trim();
}

async function isAlreadyWatching(postsUrl) {
  const data = await chrome.storage.local.get(["watchedChannels"]);
  return (data.watchedChannels || []).some((channel) => channel.postsUrl === postsUrl);
}

async function addChannel(channel) {
  const data = await chrome.storage.local.get(["watchedChannels"]);
  const watchedChannels = data.watchedChannels || [];
  const existing = watchedChannels.find((item) => item.postsUrl === channel.postsUrl);

  if (existing) {
    return {
      added: false,
      channel: existing
    };
  }

  watchedChannels.push(channel);
  await chrome.storage.local.set({ watchedChannels });

  return {
    added: true,
    channel
  };
}

function setButtonState(button, state) {
  button.dataset.state = state;

  if (state === "working") {
    button.disabled = true;
    button.textContent = "Adding...";
    return;
  }

  if (state === "added") {
    button.disabled = true;
    button.textContent = "✓ Added to POSTR";
    return;
  }

  if (state === "error") {
    button.disabled = false;
    button.textContent = "Try POSTR again";
    return;
  }

  button.disabled = false;
  button.textContent = "Subscribe for POSTR";
}
