# Prompt: make the ChatGPT demo video with Claude Code (on your own computer)

Run this in Claude Code on YOUR computer (the Claude desktop app → Code, or the terminal), not in a cloud session: it needs
your logged-in ChatGPT in a real browser. Everything below the line is the message to paste.

---

Make a 60–120 second demo video of my ChatGPT plugin "Prime Capitol" for OpenAI's app review. It must be a REAL recording of
the real plugin working in ChatGPT: never mock up or fake the ChatGPT screen, and never edit what the plugin answered.
Polish (titles, captions, zooms, speed-ups) is fine.

Setup (stop and ask me whenever you need me):
1. Install what you need: Node + Playwright (Chromium) and ffmpeg. Tell me what you're installing first.
2. Open a visible Chromium window with a PERSISTENT profile folder (e.g. ~/prime-demo-profile) at 1920×1080, and go to
   https://chatgpt.com. Then STOP and let me log in myself. Never ask me for my ChatGPT password or type it.
3. With me, make sure the Prime Capitol plugin is connected: Settings → Apps (or Plugins) → Developer mode → Create →
   server URL https://proptracker.arbcreative.co/mcp. When the Prime Capitol sign-in page opens, I'll tap "App reviewer? Use
   the demo account" and type the demo login myself. The demo account is a practice copy (real props, made-up people), so
   no real creator data appears on screen.
4. Start a NEW chat with Prime Capitol turned on for it. Hide anything personal (my name, other chats in the sidebar:
   collapse the sidebar).

Record (Playwright video recording, or ffmpeg screen capture if that works better on my computer; 1920×1080, 30 fps).
Type each message with a natural typing speed, then wait for the full answer before the next one. Scenes:
1. "What do I have coming up this week?" (the plugin shows the demo person's shoots)
2. "I'm writing a horror sketch in an old diner with a cop and a waitress. What props do we have for it?" (props with photos)
3. "When can I film for 2 hours at Cliff 2 next week, afternoons?" (free times)
4. "Book the first one." → when ChatGPT asks to confirm, answer "Yes" (it should say the booking is requested; the team approves)
5. "Add the red rotary phone to that shoot, video name Ring Ring." → confirm (or pick any prop the closet shows)
6. "Cancel Maanik's shoot." (it should refuse: only your own shoots)
If a scene fails or answers oddly, tell me and re-record that scene in a fresh chat instead of hiding it.

Edit with ffmpeg into one MP4 (H.264, 1080p, under 100 MB):
- 3-second title card at the start: black background, white text "Prime Capitol for ChatGPT", small gold (#C9A961) line
  "Book shoots and find props · by ARB Creative".
- A short gold caption at the bottom of each scene saying what it shows ("Find props for a video idea", "Find a free time",
  "Book it (with your OK)", "Request a prop", "Only your own shoots").
- Speed up the waiting parts (2–4×), keep typing and answers readable at normal speed; gentle zoom on the props photos and the
  booking confirmation is nice but optional.
- 3-second end card: "Invite-only for Prime Capitol creators · support@arbcreative.co".
- No music needed (or very quiet royalty-free if you have one without licensing issues).
Save it as ~/Desktop/prime-capitol-chatgpt-demo.mp4, open it so I can watch, and tell me the length.

Then tell me how to upload it to YouTube as UNLISTED so I can paste the link in OpenAI's form. Don't upload anything
yourself.
