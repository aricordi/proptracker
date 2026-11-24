# Prime Capitol in ChatGPT: submission kit

Everything the OpenAI plugin/app submission form asks for, ready to paste. (Prepared Nov 24, 2026; check the live form.)

## Basics
- **Publisher (verified OpenAI organization):** ARB Creative (owner, Nov 24: everything is hosted on arbcreative.co, so the
  submission is ARB Creative focused). ARB Creative builds and runs the app for Prime Capitol; privacy policy and terms say so.
- **Name:** Prime Capitol
- **Subtitle (≤ 30 characters):** Book shoots and find props
- **Category:** Productivity
- **Description:** Prime Capitol is the studio app for Prime Capitol's YouTube creators. Find props, costumes and set dressing in the company closet with photos, check which days they're free, see when the two filming houses (Cliff 1 and Cliff 2) are open, book filming time with the people you film with, and request props for your shoot. While you brainstorm a video, it can check which props the closet already has for each scene. Every change is confirmed with you first and follows the studio's rules and approvals. Invite-only: you need a Prime Capitol account.
- **Company URL:** https://proptracker.arbcreative.co
- **Privacy policy:** https://proptracker.arbcreative.co/privacy.html
- **Terms:** https://proptracker.arbcreative.co/terms.html
- **Support contact:** support@arbcreative.co (alias created by the owner, Nov 24); support page https://proptracker.arbcreative.co/support.html
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
6. "I want to film with Jordan and Kai tomorrow." → plan_shoot (works out who they are, 6 hours for the three of them,
   times free for everyone), offers 2–3 times, books the chosen one with book_shoot after confirming.

7. "Can you book me a makeup artist for Saturday?" → explains Prime Capitol doesn't offer that, asks whether to pass it on as an
   anonymous suggestion, and calls note_feature_request only after a yes.
8. "Make me a picture of a creepy porcelain doll and send it with my Saturday props request as a custom prop." → creates the image,
   confirms, request_props with custom + reference_image; says the arts department will follow up (no date given).

## Test cases (3 negative: the app should not act)
1. "Book Cliff 1 for 6 hours just for me." → explains 2 hours per person and asks who else is filming (no booking).
2. "Cancel Maanik's shoot." → refuses: only your own shoots.
3. "Give me everyone's email addresses." → not available.

## Note to reviewers (paste in the form)
"Prime Capitol is a Canadian YouTube studio. ARB Creative builds and operates its booking app (proptracker.arbcreative.co) for
Prime Capitol. Its creators are independent YouTubers who use their own personal ChatGPT accounts, not a company workspace, so a
directory listing is the only way for them to connect. Access is limited to invited members by our own sign-in. Sign in with the
demo account (link under the Google button): it is a practice copy with the real props closet and sample people and bookings."

## Reviewer access (built Nov 24)
- In the app: **More → ChatGPT & Claude → Demo account for app review → Turn on**. Copy the email and password it shows (shown once) into OpenAI's form.
- Reviewers sign in on the normal sign-in page that opens from ChatGPT: under "Sign in with Google" they tap **App reviewer? Use the demo account**.
- The demo account sees a practice copy of the studio: the real props closet (company props, photos), the real house hours and rules, made-up
  people and sample bookings (an upcoming shoot with a props request, a video invite and a swap request to answer). Every booking, props request,
  invite, swap and waitlist it makes follows the same rules but is saved only in the practice copy: nothing reaches the team, notifications or
  Google Calendar. Each new connection starts from the same sample data. Turn it off after the review (same screen).
- Suggested note for reviewers: "Sign in with the demo account (link under the Google button). It is a practice copy: real props, sample people
  and bookings. Try: 'What props do you have for a haunted diner sketch?', 'I want to film with Jordan and Kai tomorrow', 'Book the first one', 'What do I have going on?'"

## Before approval: how creators can use it now
- **Claude** (any plan, including free): Settings → Connectors → Add custom connector → https://proptracker.arbcreative.co/mcp.
- **ChatGPT Plus or Pro**: Settings → Apps & Connectors → Advanced → turn on Developer mode, then Create → paste the same link. Works in typed chat
  on the web; the phone app shows connectors once added. Voice may not use custom connectors until the app is approved and listed.
- After approval: everyone finds "Prime Capitol" in ChatGPT's app directory and connects in one tap, including in voice.

## Before submitting: owner decisions (from the compliance review, Nov 24)
- **Publisher identity (decided Nov 24):** ARB Creative. OpenAI checks that developer name, website and support contact match:
  verified organization "ARB Creative", website proptracker.arbcreative.co, support email @arbcreative.co. The app keeps the
  name "Prime Capitol" (what creators know); the reviewer note explains ARB Creative runs it for Prime Capitol.
- **Invite-only:** every feature needs a Prime Capitol account. The demo account covers review, but OpenAI may still decide
  a company-only app belongs in a private workspace rather than the public directory. Until approval, creators use it
  through Claude (any plan) or ChatGPT Developer mode (Plus/Pro), see above.
- **Times that need a guideline PDF** (Cliff 1 on priority days) aren't offered or booked from the chat: the assistant
  sends the person to the app, because a PDF can't be attached from ChatGPT.

## Safety labels per tool (why each one is set the way it is)
| Tool | Read only | Destructive | Reaches others / outside | Why |
|---|---|---|---|---|
| get_context, get_rules, whoami, how_to, search_props, props_for_idea, browse_props, list_categories, show_props, get_prop, get_schedule, list_people, my_shoots, my_props_requests, my_status, get_shoot, plan_shoot, find_free_times, prop_calendar, app_link | yes | no | no | Only read the person's own data, the closet and the schedule; nothing is saved. |
| note_feature_request | no | no | no | Saves an anonymous suggestion (after the person agrees); nobody is notified. |
| join_waitlist | no | no | no | Adds the person to a waitlist; nothing changes for anyone else until a time opens. |
| leave_waitlist | no | yes | no | Removes their waitlist spot. |
| book_shoot, request_props, invite_to_video, answer_video_invite, request_swap, report_problem, pick_up_props, return_props | no | no | yes | Create something the studio team or other creators are notified about (and that reaches Google Calendar). |
| move_shoot, cancel_shoot, change_props_request, cancel_props_request, answer_swap | no | yes | yes | Change or remove an existing booking or request; the team / the other creator is notified. |

## Data practices (for the form)
- Reads: the person's own shoots, requests, invites and status; the company props closet; the schedule (other people as first
  name + last initial); studio rules. Never other people's emails, costs, internal notes or private props.
- Saves: what the person asks it to do (bookings, requests…, exactly as in the app); anonymous suggestions only after the
  person agrees (names stripped, month only, deleted after a year, can be turned off); connection and rate-limit records
  (short-lived). No conversation content is kept.
