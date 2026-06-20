# POSTR - Post Subscription Tracker | YouTube Post Tracker

POSTR, short for **Post Subscription Tracker**, is a Chrome extension that watches YouTube channel `/posts` pages and alerts you when watched channels publish posts.

It is built for YouTube community-style posts, not videos.

## What POSTR Can Do

- Watch YouTube channel Posts pages like `https://www.youtube.com/@YouTube/posts`.
- Add channels manually from the extension popup.
- Add channels directly from a YouTube channel page with the **Subscribe for POSTR** button.
- Check watched channels on a repeating schedule.
- Check all watched channels immediately with the popup refresh button.
- Save new posts into an unread inbox.
- Show the unread count as a badge on the extension icon.
- Send Chrome notifications for new posts.
- Let you mark individual posts as read.
- Let you mark all unread posts as read.
- Avoid re-notifying old posts when a newer post gets deleted.
- Detect multiple visible new posts from the same channel when they appear between checks.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `/Users/huyckkid14/Downloads/POSTR`.

After editing files, reload POSTR from `chrome://extensions` so Chrome uses the latest code.

Or, go to https://chromewebstore.google.com/detail/postr-post-subscription-t/lnillkkncmfedlniijhekdfbkneckned and directly download it from the Chrome Web Store.

## Popup Buttons and Controls

### Refresh Button

The circular arrow button in the popup checks all watched channels immediately.

It does the same kind of check as the scheduled watcher. If it finds posts that POSTR has not seen before, it adds them to unread, updates the badge, and sends notifications.

### Add Channel

Adds a YouTube Posts URL to the watch list.

Good examples:

- `https://www.youtube.com/@YouTube/posts`
- `https://www.youtube.com/channel/CHANNEL_ID/posts`

If you paste a channel URL without `/posts`, POSTR tries to convert it to the matching `/posts` URL.

### Check Every

Controls how often Chrome wakes POSTR to check watched channels.

Chrome Manifest V3 service workers do not run forever in the background, so POSTR uses `chrome.alarms` to wake up on this schedule.

### Bell Button

The bell button beside a watched channel sends a test notification using that channel's current newest post.

This is only a test. It does not create an unread item unless the watcher detects a real unseen post.

### Trash Button

Removes the channel from POSTR.

It also clears unread posts and saved post memory for that channel.

### Mark Read Checkmark

The checkmark beside an unread post marks that one post as read.

This removes it from the unread list and lowers the extension badge count.

### Mark All Read

Clears every unread post.

This also clears the extension badge count.

## YouTube Page Button

On YouTube channel pages, POSTR injects a **Subscribe for POSTR** button at the end of the channel action row near YouTube's own Subscribe and Community buttons.

Clicking it:

1. Finds the channel's Posts page.
2. Adds that channel to POSTR's watch list.
3. Changes the button to **✓ Added to POSTR**.
4. Runs a check for that channel.

## When Notifications Send

POSTR sends a notification when it finds a visible post ID that has not been seen before.

Notifications send when:

- A watched channel makes its first post after previously having no posts.
- A watched channel publishes one new post.
- A watched channel publishes multiple visible new posts between checks.
- You manually click **Check now** and unseen posts are found.

For each new post, POSTR also:

- adds the post to the unread list
- updates the extension badge count
- remembers the post ID so it does not notify for it again

## When Notifications Do Not Send

POSTR does not notify when:

- The watched channel has no posts.
- The newest visible posts have already been seen.
- You open the popup without checking.
- You mark posts as read.
- You remove a channel.
- You use the bell test button, unless Chrome itself shows the test notification.
- A newer post gets deleted and an older already-seen post becomes the newest visible post.

## First Check Behavior

If a channel has visible posts and POSTR has no saved memory for that channel yet, POSTR treats those visible posts as new.

That means the first successful check can notify and add current posts to unread.

If a channel has no posts, POSTR saves no post ID. When that channel later makes its first post, POSTR treats that first post as new and sends a notification.

## Badge Behavior

The extension icon badge shows the number of unread posts.

- New unseen posts increase the badge.
- Marking one post read decreases the badge.
- **Mark all read** clears the badge.
- Removing a channel clears unread posts from that channel and updates the badge.

The badge is not a count of watched channels. It is only unread posts.

## How POSTR Detects Posts

YouTube does not expose community posts as a clean official YouTube Data API resource.

POSTR fetches each watched channel's `/posts` page and reads YouTube's embedded `ytInitialData` JSON. It looks for post renderers inside that data, stores recent post IDs, and compares them on later checks.

This makes POSTR useful as an MVP, but it also means the parser can break if YouTube changes its page data structure.

## Known Limits

- POSTR only sees posts that are present in the fetched `/posts` page data.
- If YouTube changes its internal renderer names, parsing may need an update.
- Chrome or your operating system may block notifications until notification permission is enabled.
- Very old posts that are no longer visible on the Posts page may not be detected.
- POSTR does not import all YouTube subscriptions yet.
