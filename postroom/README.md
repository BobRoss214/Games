# Postroom

Write one post, preview it on each social network, then send it now or schedule it.

## Run

```bash
cd postroom && python3 -m http.server 8000
```

Then open `http://localhost:8000`. No build step and no libraries.

## What works

- Write a post: image (drop, paste, or choose), text, hashtags.
- Preview for Facebook, Instagram, X, LinkedIn, Threads, Bluesky, Pinterest, TikTok. Click the text in a preview to change it for that network only.
- Limits are checked for each network (length, image needed, hashtag count).
- Tick the accounts to send to. Send now or pick a date and time.
- Posts page: scheduled queue (change, post now, cancel) and history (search, filter, use again).
- Accounts page: connect and disconnect networks.

## Demo mode (important)

Nothing is sent to the real networks yet. Data is kept in this browser (`localStorage`).
Real posting needs a server that holds each network's API keys and runs the schedule.
The one place to change in the front end is the `Publisher` object at the top of `app.js`.
The connect step must become the network's OAuth sign-in (never ask for a social password).
