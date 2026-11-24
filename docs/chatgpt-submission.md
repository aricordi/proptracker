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

## Reviewer access (decision needed)
OpenAI requires a login and password for a fully working demo account. Prime Capitol signs in with Google only and runs on the
company's live data. Options: (a) publish privately inside a ChatGPT Business workspace instead (no public review); (b) create a
dedicated Google account for reviewers, invite it as a creator, and give OpenAI its Google login (they then see real first names
and the real schedule); (c) build a separate reviewer sign-in on the practice site (needs a second app submission URL).
