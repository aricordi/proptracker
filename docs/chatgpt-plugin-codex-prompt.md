# Paste this into Codex → Plugin Creator

(Attach the logo file `prime-capitol-logo-512.png` with it. Everything below the line is the message.)

---

Please build a ChatGPT plugin submission ZIP for an existing REMOTE MCP server, then run the prepare-plugin-submission
skill and fix every finding. Don't write any server code: the server is already live.

**Publisher:** ARB Creative (verified organization)

**Plugin name:** Prime Capitol
**Short description / subtitle (≤ 30 characters):** Book shoots and find props
**Category:** Productivity

**Description:**
Prime Capitol is the studio app for Prime Capitol's YouTube creators, built and run by ARB Creative. Find props, costumes
and set dressing in the company closet with photos, check which days they're free, see when the two filming houses
(Cliff 1 and Cliff 2) are open, book filming time with the people you film with, and request props for your shoot. While
you brainstorm a video, it can check which props the closet already has for each scene, and you can attach a picture of a
custom prop you want made. Every change is confirmed with you first and follows the studio's rules and approvals.
Invite-only: you need a Prime Capitol account.

**MCP server (one remote server):**
- URL: https://proptracker.arbcreative.co/mcp
- Transport: streamable HTTP
- Auth: OAuth 2.1 with PKCE and dynamic client registration. Discovery is automatic at
  https://proptracker.arbcreative.co/.well-known/oauth-authorization-server and
  https://proptracker.arbcreative.co/.well-known/oauth-protected-resource . No API key, no client secret.

**Links:**
- Website: https://proptracker.arbcreative.co
- Privacy policy: https://proptracker.arbcreative.co/privacy.html
- Terms of service: https://proptracker.arbcreative.co/terms.html
- Support page: https://proptracker.arbcreative.co/support.html (contact email support@arbcreative.co)

**Logo:** the attached prime-capitol-logo-512.png (white eagle on black, square, 512 px).

**Starter prompts (≤ 128 characters each):**
1. What do I have coming up this week?
2. I'm filming a haunted diner sketch. What props do we have for it?
3. Find me 2 hours at Cliff 2 next week with a friend.

**Onboarding skill (name it getting-started):** Explain in a few lines that Prime Capitol books filming time at two houses
(Cliff 1, Cliff 2) or offsite, and lends props from the company closet. Tell the model to call `get_context` first in every
conversation (it returns today's date, the person's upcoming shoots and requests, and the short rules), to confirm with the
person before any booking, change or cancellation, never to promise a date for custom props (the arts department follows up
separately), and that check-ins, photos and returns happen in the Prime Capitol app (use `app_link`).

**Review test cases (exactly 5 positive, 3 negative):**
Positive:
1. "I'm writing a horror sketch in an old diner with a cop and a waitress. What props do we have for it?" → props_for_idea, then show_props with photos.
2. "When can I film for 2 hours at Cliff 2 next week, afternoons?" → find_free_times with options.
3. "Book Cliff 2 Friday from 1:15 to 3:15." → book_shoot after confirming; the answer says the booking is requested (the schedule team approves).
4. "Add the red rotary phone to my Friday shoot, video name Ring Ring." → request_props after confirming.
5. "I want to film with Jordan and Kai tomorrow." → plan_shoot, offers 2–3 times, books the chosen one with book_shoot after confirming.
Negative (the plugin should not act):
1. "Book Cliff 1 for 6 hours just for me." → explains 2 hours per person and asks who else is filming; no booking.
2. "Cancel Maanik's shoot." → refuses: only your own shoots.
3. "Give me everyone's email addresses." → not available.

**Release notes:** First release: book filming time, find and request props, plan a shoot from a video idea.

**Do NOT put in the ZIP:** any login, password, test credentials or reviewer instructions (the reviewer demo login goes in
the portal's Review details form instead). No hooks.

**Demo recording URL:** leave a placeholder and tell me where it goes; I'll add the video link.

When done, give me the ZIP and list anything the validator still flags.
