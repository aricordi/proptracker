# Prime Capitol in ChatGPT: submission kit

Everything the OpenAI plugin/app submission form asks for, ready to paste. (Prepared Nov 24, 2026; check the live form.)

## Basics
- **Name:** Prime Capitol
- **Subtitle (≤ 30 characters):** Book shoots and find props
- **Category:** Productivity
- **Description:** Prime Capitol is the studio app for Prime Capitol's YouTube creators. Find props, costumes and set dressing in the company closet with photos, check which days they're free, see when the two filming houses (Cliff 1 and Cliff 2) are open, book filming time with the people you film with, and request props for your shoot. While you brainstorm a video, it can check which props the closet already has for each scene. Every change is confirmed with you first and follows the studio's rules and approvals. Invite-only: you need a Prime Capitol account.
- **Company URL:** https://proptracker.arbcreative.co
- **Privacy policy:** https://proptracker.arbcreative.co/privacy.html
- **Terms:** https://proptracker.arbcreative.co/terms.html
- **Support contact:** alexisricordi@gmail.com
- **Logo:** docs/brand/prime-capitol-logo-120.png (use public/icons/icon-512.png for a larger square)
- **MCP server URL:** https://proptracker.arbcreative.co/mcp
- **Authentication:** OAuth 2.1 with PKCE and dynamic client registration (discovery at /.well-known/oauth-authorization-server). Sign-in is with Google on our own page; only invited Prime Capitol members get in.
- **Domain verification:** paste OpenAI's token with the GitHub button "Admin task" → `{"kind":"openaiChallenge","token":"<token>"}`; it is then served at https://proptracker.arbcreative.co/.well-known/openai-apps-challenge.
- **Widget CSP:** images from https://firebasestorage.googleapis.com only; no other network access.

## Test cases (5 positive)
1. "I'm writing a horror sketch in an old diner with a cop and a waitress. What props do we have for it?" → props_for_idea, then show_props with photos.
2. "When can I film for 2 hours at Cliff 2 next week, afternoons?" → find_free_times with options.
3. "Book Cliff 2 Friday from 1:15 to 3:15." → book_shoot after confirming; answer says "Requested" (the schedule team approves).
4. "Add the red rotary phone to my Friday shoot, video name Ring Ring." → request_props after confirming.
5. "What do I have going on this week?" → my_status.

## Test cases (3 negative: the app should not act)
1. "Book Cliff 1 for 6 hours just for me." → explains 2 hours per person and asks who else is filming (no booking).
2. "Cancel Maanik's shoot." → refuses: only your own shoots.
3. "Give me everyone's email addresses." → not available.

## Reviewer access (built Nov 24)
- In the app: **More → ChatGPT & Claude → Demo account for app review → Turn on**. Copy the email and password it shows (shown once) into OpenAI's form.
- Reviewers sign in on the normal sign-in page that opens from ChatGPT: under "Sign in with Google" they tap **App reviewer? Use the demo account**.
- The demo account sees a practice copy of the studio: the real props closet (company props, photos), the real house hours and rules, made-up
  people and sample bookings (an upcoming shoot with a props request, a video invite and a swap request to answer). Every booking, props request,
  invite, swap and waitlist it makes follows the same rules but is saved only in the practice copy: nothing reaches the team, notifications or
  Google Calendar. Each new connection starts from the same sample data. Turn it off after the review (same screen).
- Suggested note for reviewers: "Sign in with the demo account (link under the Google button). It is a practice copy: real props, sample people
  and bookings. Try: 'What props do you have for a haunted diner sketch?', 'Find me 2 hours at Cliff 2 next week', 'Book it', 'What do I have going on?'"

## Before approval: how creators can use it now
- **Claude** (any plan, including free): Settings → Connectors → Add custom connector → https://proptracker.arbcreative.co/mcp.
- **ChatGPT Plus or Pro**: Settings → Apps & Connectors → Advanced → turn on Developer mode, then Create → paste the same link. Works in typed chat
  on the web; the phone app shows connectors once added. Voice may not use custom connectors until the app is approved and listed.
- After approval: everyone finds "Prime Capitol" in ChatGPT's app directory and connects in one tap, including in voice.
