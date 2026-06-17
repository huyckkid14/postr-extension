const ALARM_NAME = "postr-watch";
const DEFAULT_INTERVAL_MINUTES = 60;
const MAX_REMEMBERED_POST_IDS = 80;
const YOUTUBE_ORIGIN = "https://www.youtube.com";

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await chrome.action.setBadgeBackgroundColor({ color: "#b3261e" });
  await updateUnreadBadge();
  await ensureAlarm(settings.intervalMinutes);
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  await chrome.action.setBadgeBackgroundColor({ color: "#b3261e" });
  await updateUnreadBadge();
  await ensureAlarm(settings.intervalMinutes);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await checkAllChannels();
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const data = await chrome.storage.local.get(["notificationTargets"]);
  const targets = data.notificationTargets || {};
  const url = targets[notificationId];

  if (url) {
    await chrome.tabs.create({ url });
    delete targets[notificationId];
    await chrome.storage.local.set({ notificationTargets: targets });
  }

  await chrome.notifications.clear(notificationId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "POSTR_CHECK_NOW") {
    checkAllChannels()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "POSTR_CHECK_CHANNEL") {
    checkOneChannel(message.channel, { forceNotify: message.forceNotify === true })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "POSTR_RESCHEDULE") {
    const minutes = normalizeInterval(message.intervalMinutes);
    ensureAlarm(minutes)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "POSTR_MARK_READ") {
    markRead(message.unreadId)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "POSTR_MARK_ALL_READ") {
    markAllRead()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "POSTR_REFRESH_BADGE") {
    updateUnreadBadge()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function checkAllChannels() {
  const startedAt = Date.now();
  const data = await chrome.storage.local.get(["watchedChannels"]);
  const watchedChannels = data.watchedChannels || [];
  const results = [];

  for (const channel of watchedChannels) {
    const result = await checkOneChannel(channel);
    results.push(result);
  }

  await chrome.storage.local.set({
    lastRunAt: startedAt,
    lastRunFinishedAt: Date.now()
  });

  return {
    checked: results.length,
    notified: results.reduce((count, result) => count + (result.newCount || 0), 0),
    results
  };
}

async function checkOneChannel(channel, options = {}) {
  if (!channel?.id || !channel?.postsUrl) {
    return {
      channelId: channel?.id || null,
      status: "error",
      error: "Channel is missing an id or posts URL."
    };
  }

  const checkedAt = Date.now();
  const lastSeenPosts = await getLastSeenPosts();

  try {
    const posts = await getRecentPosts(channel.postsUrl);
    const newestPost = posts[0] || null;

    if (!newestPost) {
      await rememberChannelStatus(channel.id, {
        lastCheckedAt: checkedAt,
        lastError: "No posts found on the page."
      });

      return {
        channelId: channel.id,
        status: "empty"
      };
    }

    const previousRecord = lastSeenPosts[channel.id] || {};
    const knownPostIds = getKnownPostIds(previousRecord, posts);
    const newPosts = getUnseenPosts(posts, previousRecord, knownPostIds);

    lastSeenPosts[channel.id] = {
      postId: newestPost.id,
      text: newestPost.text,
      url: newestPost.url,
      seenAt: checkedAt,
      recentPostIds: mergeRememberedPostIds(posts, knownPostIds)
    };

    await chrome.storage.local.set({ lastSeenPosts });
    await rememberChannelStatus(channel.id, {
      lastCheckedAt: checkedAt,
      lastError: null
    });

    if (newPosts.length > 0) {
      for (const post of newPosts.reverse()) {
        await addUnreadPost(channel, post, checkedAt);
        await notifyNewPost(channel, post);
      }

      return {
        channelId: channel.id,
        status: "new",
        newestPost,
        newCount: newPosts.length
      };
    }

    if (options.forceNotify) {
      await notifyNewPost(channel, newestPost);
      return {
        channelId: channel.id,
        status: "test",
        newestPost,
        newCount: 0
      };
    }

    return {
      channelId: channel.id,
      status: "unchanged",
      newestPost,
      newCount: 0
    };
  } catch (error) {
    await rememberChannelStatus(channel.id, {
      lastCheckedAt: checkedAt,
      lastError: error.message
    });

    return {
      channelId: channel.id,
      status: "error",
      error: error.message
    };
  }
}

async function getNewestPost(postsUrl) {
  const posts = await getRecentPosts(postsUrl);
  return posts[0] || null;
}

async function getRecentPosts(postsUrl) {
  const normalizedUrl = normalizePostsUrl(postsUrl);

  const response = await fetch(normalizedUrl, {
    credentials: "omit",
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`YouTube returned ${response.status} for ${normalizedUrl}`);
  }

  const html = await response.text();
  const ytInitialData = extractYtInitialData(html);

  if (!ytInitialData) {
    throw new Error("Could not find ytInitialData in the YouTube page.");
  }

  const posts = findPostRenderers(ytInitialData);
  return posts;
}

function getUnseenPosts(posts, previousRecord, knownPostIds = []) {
  if (!previousRecord.postId) return posts;

  const knownIds = new Set(knownPostIds);
  const unseenPosts = posts.filter((post) => !knownIds.has(post.id));

  if (Array.isArray(previousRecord.recentPostIds) && previousRecord.recentPostIds.length > 0) {
    return unseenPosts;
  }

  const previousIndex = posts.findIndex((post) => post.id === previousRecord.postId);
  if (previousIndex >= 0) return posts.slice(0, previousIndex);

  // Legacy records only know one old ID. If that ID is no longer visible,
  // notify only for the current newest item, then future checks have memory.
  return unseenPosts.slice(0, 1);
}

function getKnownPostIds(previousRecord, posts) {
  if (Array.isArray(previousRecord.recentPostIds) && previousRecord.recentPostIds.length > 0) {
    return normalizeKnownPostIds(previousRecord);
  }

  if (!previousRecord.postId) return [];

  const previousIndex = posts.findIndex((post) => post.id === previousRecord.postId);
  if (previousIndex >= 0) {
    return posts.slice(previousIndex).map((post) => post.id);
  }

  return [previousRecord.postId];
}

function normalizeKnownPostIds(previousRecord) {
  const knownIds = Array.isArray(previousRecord.recentPostIds)
    ? [...previousRecord.recentPostIds]
    : [];

  if (previousRecord.postId && !knownIds.includes(previousRecord.postId)) {
    knownIds.push(previousRecord.postId);
  }

  return knownIds;
}

function mergeRememberedPostIds(posts, previousKnownIds = []) {
  const merged = [];
  const seen = new Set();

  for (const post of posts) {
    if (!post.id || seen.has(post.id)) continue;
    seen.add(post.id);
    merged.push(post.id);
  }

  for (const postId of previousKnownIds) {
    if (!postId || seen.has(postId)) continue;
    seen.add(postId);
    merged.push(postId);
  }

  return merged.slice(0, MAX_REMEMBERED_POST_IDS);
}

function extractYtInitialData(html) {
  const markers = [
    "var ytInitialData = ",
    "window[\"ytInitialData\"] = ",
    "ytInitialData = "
  ];

  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) continue;

    const jsonStart = html.indexOf("{", markerIndex + marker.length);
    if (jsonStart === -1) continue;

    const jsonText = readBalancedJsonObject(html, jsonStart);
    if (!jsonText) continue;

    try {
      return JSON.parse(jsonText);
    } catch (_error) {
      continue;
    }
  }

  return null;
}

function readBalancedJsonObject(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function findPostRenderers(root) {
  const results = [];
  const seenObjects = new WeakSet();

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (seenObjects.has(node)) return;
    seenObjects.add(node);

    if (node.backstagePostThreadRenderer) {
      const parsed = parseBackstagePost(node.backstagePostThreadRenderer);
      if (parsed) results.push(parsed);
    }

    if (node.postRenderer) {
      const parsed = parsePostRenderer(node.postRenderer);
      if (parsed) results.push(parsed);
    }

    for (const value of Object.values(node)) {
      walk(value);
    }
  }

  walk(root);

  const seenPostIds = new Set();
  return results.filter((post) => {
    if (!post.id || seenPostIds.has(post.id)) return false;
    seenPostIds.add(post.id);
    return true;
  });
}

function parseBackstagePost(renderer) {
  const rawPost =
    renderer.post?.backstagePostRenderer ||
    renderer.post ||
    renderer.originalPost?.backstagePostRenderer ||
    renderer.backstagePostRenderer ||
    renderer;

  const id =
    rawPost.postId ||
    rawPost.postEntityKey ||
    rawPost.entityKey ||
    rawPost.commentEndpoint?.commentId ||
    renderer.postId ||
    renderer.postEntityKey;

  const text =
    textFromContent(rawPost.contentText) ||
    textFromContent(rawPost.content) ||
    textFromContent(rawPost.pollStatus) ||
    textFromContent(rawPost.attachment?.pollRenderer?.questionText) ||
    "New YouTube post";

  const url = absoluteYouTubeUrl(
    rawPost.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url ||
    rawPost.endpoint?.commandMetadata?.webCommandMetadata?.url ||
    renderer.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url
  );

  if (!id) return null;

  return {
    id,
    text: compactPreview(text),
    url
  };
}

function parsePostRenderer(renderer) {
  const id = renderer.postId || renderer.postEntityKey || renderer.entityKey;

  const text =
    textFromContent(renderer.contentText) ||
    textFromContent(renderer.title) ||
    "New YouTube post";

  const url = absoluteYouTubeUrl(
    renderer.endpoint?.commandMetadata?.webCommandMetadata?.url ||
    renderer.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url
  );

  if (!id) return null;

  return {
    id,
    text: compactPreview(text),
    url
  };
}

function textFromContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content.trim();
  if (content.simpleText) return content.simpleText.trim();
  if (Array.isArray(content.runs)) {
    return content.runs.map((run) => run.text || "").join("").trim();
  }
  return "";
}

function compactPreview(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (compact.length <= 140) return compact;
  return `${compact.slice(0, 137).trim()}...`;
}

function absoluteYouTubeUrl(path) {
  if (!path) return null;
  try {
    return new URL(path, YOUTUBE_ORIGIN).toString();
  } catch (_error) {
    return null;
  }
}

function normalizePostsUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Posts URL is empty.");

  const withProtocol = raw.startsWith("http") ? raw : `${YOUTUBE_ORIGIN}/${raw.replace(/^\/+/, "")}`;
  const url = new URL(withProtocol);

  if (!url.hostname.endsWith("youtube.com")) {
    throw new Error("Only YouTube channel post URLs are supported.");
  }

  if (!url.pathname.endsWith("/posts")) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/posts`;
  }

  url.search = "";
  url.hash = "";
  return url.toString();
}

async function notifyNewPost(channel, post) {
  const notificationId = `postr-${channel.id}-${Date.now()}`;
  const targetUrl = post.url || channel.postsUrl;
  const data = await chrome.storage.local.get(["notificationTargets"]);
  const notificationTargets = data.notificationTargets || {};
  notificationTargets[notificationId] = targetUrl;

  await chrome.storage.local.set({ notificationTargets });
  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: `${channel.name || "A watched channel"} posted`,
    message: post.text || "New YouTube post available."
  });
}

async function addUnreadPost(channel, post, foundAt) {
  const data = await chrome.storage.local.get(["unreadPosts"]);
  const unreadPosts = data.unreadPosts || {};
  const unreadId = `${channel.id}:${post.id}`;

  unreadPosts[unreadId] = {
    id: unreadId,
    channelId: channel.id,
    channelName: channel.name || "YouTube Channel",
    postId: post.id,
    text: post.text || "New YouTube post",
    url: post.url || channel.postsUrl,
    foundAt
  };

  await chrome.storage.local.set({ unreadPosts });
  await updateUnreadBadge(unreadPosts);
}

async function markRead(unreadId) {
  if (!unreadId) throw new Error("Missing unread item id.");

  const data = await chrome.storage.local.get(["unreadPosts"]);
  const unreadPosts = data.unreadPosts || {};
  delete unreadPosts[unreadId];

  await chrome.storage.local.set({ unreadPosts });
  await updateUnreadBadge(unreadPosts);

  return {
    unreadCount: Object.keys(unreadPosts).length
  };
}

async function markAllRead() {
  await chrome.storage.local.set({ unreadPosts: {} });
  await updateUnreadBadge({});

  return {
    unreadCount: 0
  };
}

async function updateUnreadBadge(currentUnreadPosts = null) {
  const unreadPosts = currentUnreadPosts || (await chrome.storage.local.get(["unreadPosts"])).unreadPosts || {};
  const unreadCount = Object.keys(unreadPosts).length;

  await chrome.action.setBadgeText({
    text: unreadCount > 0 ? String(Math.min(unreadCount, 99)) : ""
  });
}

async function getSettings() {
  const data = await chrome.storage.local.get(["settings"]);
  return {
    intervalMinutes: normalizeInterval(data.settings?.intervalMinutes)
  };
}

function normalizeInterval(minutes) {
  const parsed = Number(minutes);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MINUTES;
  return Math.max(15, Math.round(parsed));
}

async function ensureAlarm(intervalMinutes = DEFAULT_INTERVAL_MINUTES) {
  const minutes = normalizeInterval(intervalMinutes);
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: minutes
  });
}

async function getLastSeenPosts() {
  const data = await chrome.storage.local.get(["lastSeenPosts"]);
  return data.lastSeenPosts || {};
}

async function rememberChannelStatus(channelId, status) {
  const data = await chrome.storage.local.get(["channelStatuses"]);
  const channelStatuses = data.channelStatuses || {};

  channelStatuses[channelId] = {
    ...(channelStatuses[channelId] || {}),
    ...status
  };

  await chrome.storage.local.set({ channelStatuses });
}
