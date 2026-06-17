const DEFAULT_SETTINGS = {
  intervalMinutes: 60
};

const channelForm = document.querySelector("#channelForm");
const channelNameInput = document.querySelector("#channelName");
const postsUrlInput = document.querySelector("#postsUrl");
const intervalSelect = document.querySelector("#intervalSelect");
const checkNowButton = document.querySelector("#checkNowButton");
const channelList = document.querySelector("#channelList");
const channelTemplate = document.querySelector("#channelTemplate");
const unreadList = document.querySelector("#unreadList");
const unreadTemplate = document.querySelector("#unreadTemplate");
const emptyState = document.querySelector("#emptyState");
const emptyUnreadState = document.querySelector("#emptyUnreadState");
const channelCount = document.querySelector("#channelCount");
const unreadCount = document.querySelector("#unreadCount");
const runStatus = document.querySelector("#runStatus");
const lastRun = document.querySelector("#lastRun");
const markAllReadButton = document.querySelector("#markAllReadButton");
const overviewUnread = document.querySelector("#overviewUnread");
const overviewChannels = document.querySelector("#overviewChannels");
const overviewInterval = document.querySelector("#overviewInterval");

document.addEventListener("DOMContentLoaded", init);
channelForm.addEventListener("submit", addChannel);
intervalSelect.addEventListener("change", updateInterval);
checkNowButton.addEventListener("click", checkNow);
markAllReadButton.addEventListener("click", markAllRead);

async function init() {
  const state = await loadState();
  intervalSelect.value = String(state.settings.intervalMinutes);
  render(state);
}

async function loadState() {
  const data = await chrome.storage.local.get([
    "watchedChannels",
    "lastSeenPosts",
    "unreadPosts",
    "channelStatuses",
    "settings",
    "lastRunAt",
    "lastRunFinishedAt"
  ]);

  return {
    watchedChannels: data.watchedChannels || [],
    lastSeenPosts: data.lastSeenPosts || {},
    unreadPosts: data.unreadPosts || {},
    channelStatuses: data.channelStatuses || {},
    settings: {
      ...DEFAULT_SETTINGS,
      ...(data.settings || {})
    },
    lastRunAt: data.lastRunAt || null,
    lastRunFinishedAt: data.lastRunFinishedAt || null
  };
}

async function addChannel(event) {
  event.preventDefault();
  const rawUrl = postsUrlInput.value.trim();
  const postsUrl = normalizePostsUrl(rawUrl);

  if (!postsUrl) {
    setStatus("Use a YouTube channel Posts URL.");
    postsUrlInput.focus();
    return;
  }

  const data = await chrome.storage.local.get(["watchedChannels"]);
  const watchedChannels = data.watchedChannels || [];

  if (watchedChannels.some((channel) => channel.postsUrl === postsUrl)) {
    setStatus("Already watching that channel.");
    return;
  }

  const fallbackName = nameFromUrl(postsUrl);
  const channel = {
    id: crypto.randomUUID(),
    name: channelNameInput.value.trim() || fallbackName,
    postsUrl,
    createdAt: Date.now()
  };

  watchedChannels.push(channel);
  await chrome.storage.local.set({ watchedChannels });
  channelForm.reset();
  setStatus("Channel added. Check now to add current posts.");
  render(await loadState());
}

async function updateInterval() {
  const intervalMinutes = Number(intervalSelect.value);
  const data = await chrome.storage.local.get(["settings"]);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(data.settings || {}),
    intervalMinutes
  };

  await chrome.storage.local.set({ settings });
  await sendRuntimeMessage({
    type: "POSTR_RESCHEDULE",
    intervalMinutes
  });

  setStatus(`Checking every ${formatInterval(intervalMinutes)}.`);
}

async function checkNow() {
  setStatus("Checking now...");
  checkNowButton.disabled = true;

  const response = await sendRuntimeMessage({ type: "POSTR_CHECK_NOW" });

  checkNowButton.disabled = false;

  if (!response?.ok) {
    setStatus(response?.error || "Check failed.");
    return;
  }

  const { checked, notified } = response.result;
  setStatus(`Checked ${checked} channel${checked === 1 ? "" : "s"}. ${notified} new.`);
  render(await loadState());
}

async function removeChannel(channelId) {
  const data = await chrome.storage.local.get([
    "watchedChannels",
    "lastSeenPosts",
    "unreadPosts",
    "channelStatuses"
  ]);

  const watchedChannels = (data.watchedChannels || []).filter((channel) => channel.id !== channelId);
  const lastSeenPosts = data.lastSeenPosts || {};
  const unreadPosts = data.unreadPosts || {};
  const channelStatuses = data.channelStatuses || {};

  delete lastSeenPosts[channelId];
  delete channelStatuses[channelId];

  for (const unreadId of Object.keys(unreadPosts)) {
    if (unreadPosts[unreadId]?.channelId === channelId) {
      delete unreadPosts[unreadId];
    }
  }

  await chrome.storage.local.set({
    watchedChannels,
    lastSeenPosts,
    unreadPosts,
    channelStatuses
  });
  await sendRuntimeMessage({ type: "POSTR_REFRESH_BADGE" });

  setStatus("Channel removed.");
  render(await loadState());
}

async function testChannel(channel) {
  setStatus("Sending test notification...");
  const response = await sendRuntimeMessage({
    type: "POSTR_CHECK_CHANNEL",
    channel,
    forceNotify: true
  });

  if (!response?.ok) {
    setStatus(response?.error || "Test failed.");
    return;
  }

  if (response.result.status === "empty") {
    setStatus("No post found to notify about.");
    return;
  }

  setStatus("Test notification sent.");
  render(await loadState());
}

async function markRead(unreadId) {
  const response = await sendRuntimeMessage({
    type: "POSTR_MARK_READ",
    unreadId
  });

  if (!response?.ok) {
    setStatus(response?.error || "Could not mark read.");
    return;
  }

  setStatus("Marked read.");
  render(await loadState());
}

async function markAllRead() {
  const response = await sendRuntimeMessage({ type: "POSTR_MARK_ALL_READ" });

  if (!response?.ok) {
    setStatus(response?.error || "Could not mark all read.");
    return;
  }

  setStatus("All caught up.");
  render(await loadState());
}

function render(state) {
  const channels = state.watchedChannels;
  const unreadItems = Object.values(state.unreadPosts)
    .sort((a, b) => (b.foundAt || 0) - (a.foundAt || 0));

  channelList.textContent = "";
  unreadList.textContent = "";
  channelCount.textContent = String(channels.length);
  unreadCount.textContent = String(unreadItems.length);
  overviewUnread.textContent = String(unreadItems.length);
  overviewChannels.textContent = String(channels.length);
  overviewInterval.textContent = shortInterval(state.settings.intervalMinutes);

  emptyState.classList.toggle("is-hidden", channels.length > 0);
  emptyUnreadState.classList.toggle("is-hidden", unreadItems.length > 0);
  markAllReadButton.disabled = unreadItems.length === 0;

  for (const unread of unreadItems) {
    const item = unreadTemplate.content.firstElementChild.cloneNode(true);
    const channelLink = item.querySelector(".unread-channel");
    const text = item.querySelector(".unread-text");
    const time = item.querySelector(".unread-time");
    const markReadButton = item.querySelector(".mark-read-button");

    channelLink.textContent = unread.channelName || "YouTube Channel";
    channelLink.href = unread.url;
    text.textContent = unread.text || "New YouTube post";
    time.textContent = `Found ${formatTime(unread.foundAt)}`;
    markReadButton.addEventListener("click", () => markRead(unread.id));

    unreadList.append(item);
  }

  for (const channel of channels) {
    const item = channelTemplate.content.firstElementChild.cloneNode(true);
    const nameLink = item.querySelector(".channel-name");
    const meta = item.querySelector(".channel-meta");
    const last = item.querySelector(".channel-last");
    const removeButton = item.querySelector(".remove-button");
    const testButton = item.querySelector(".test-button");
    const lastSeen = state.lastSeenPosts[channel.id];
    const status = state.channelStatuses[channel.id];

    nameLink.textContent = channel.name;
    nameLink.href = channel.postsUrl;
    meta.textContent = channel.postsUrl;

    if (status?.lastError) {
      last.textContent = `Last check: ${formatTime(status.lastCheckedAt)} - ${status.lastError}`;
    } else if (lastSeen?.postId) {
      last.textContent = `Last post: ${lastSeen.text || lastSeen.postId}`;
    } else {
      last.textContent = "No posts checked yet.";
    }

    removeButton.addEventListener("click", () => removeChannel(channel.id));
    testButton.addEventListener("click", () => testChannel(channel));

    channelList.append(item);
  }

  lastRun.textContent = state.lastRunFinishedAt
    ? `Last checked ${formatTime(state.lastRunFinishedAt)}`
    : "Never checked";
}

function normalizePostsUrl(input) {
  try {
    const raw = String(input || "").trim();
    const withProtocol = raw.startsWith("http")
      ? raw
      : `https://www.youtube.com/${raw.replace(/^\/+/, "")}`;
    const url = new URL(withProtocol);

    if (!url.hostname.endsWith("youtube.com")) return "";

    if (!url.pathname.endsWith("/posts")) {
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/posts`;
    }

    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

function nameFromUrl(postsUrl) {
  const url = new URL(postsUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[0] || "YouTube Channel";
}

function formatTime(timestamp) {
  if (!timestamp) return "never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatInterval(minutes) {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function shortInterval(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${hours}h`;
}

function setStatus(message) {
  runStatus.textContent = message;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message
        });
        return;
      }

      resolve(response);
    });
  });
}
