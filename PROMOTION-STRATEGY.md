# Keyboardia Promotion Strategy

## Product Summary

**Keyboardia** is a browser-based, real-time multiplayer step sequencer. Users create beats collaboratively with up to 10 players, remix each other's work, and share sessions via link or QR code. No installation, no account required. 64 sound generators, polyrhythmic patterns, MIDI export, and effects processing — all in the browser.

**URL:** https://keyboardia.dev
**Tagline:** Create. Remix. Share.

### Key Differentiators (Promotion Angles)

| Angle | Why It Matters |
|-------|---------------|
| Zero friction | No install, no signup, instant sound |
| Real-time multiplayer | Up to 10 people jamming in one session — rare for browser tools |
| Remix culture | GitHub-style fork/remix for music |
| Polyrhythmic support | 3–128 steps per track, not locked to 4/4 |
| 64 instruments | Web Audio synths + Tone.js + sampled instruments (piano, 808, strings, etc.) |
| MIDI export | Take your creation into a DAW |
| QR code sharing | Instant mobile sharing |
| Cloudflare edge deployment | Low-latency collaboration globally |

---

## Phase 1: Pre-Launch Preparation

Before announcing anywhere, have these ready:

### Assets to Prepare

1. **Demo sessions** — 5–10 polished example sessions that showcase variety (hip-hop beat, polyrhythmic pattern, ambient loop, collaborative jam). Already have 10 curated examples on the landing page.
2. **Screen recordings** — 30-second and 60-second clips of:
   - Creating a beat from scratch (solo)
   - Two people joining a session and jamming live
   - Remixing a published session
   - The polyrhythm feature in action
3. **GIF captures** — Short looping GIFs of the sequencer grid playing back, suitable for embedding in forum posts and tweets.
4. **One-paragraph description** — Adapt per audience:
   - For musicians: "A free online beat maker where you and your friends can jam together in real-time, right in the browser."
   - For developers: "A real-time collaborative step sequencer built on Cloudflare Durable Objects, Web Audio API, and Tone.js — zero-install, multiplayer-first."
   - For educators: "A free, browser-based tool for teaching rhythm, polyrhythms, and collaborative music creation. No accounts, no installs."
5. **Open Graph previews** — Dynamic social previews are specced in `specs/SOCIAL-MEDIA-PREVIEW.md`. Implement before launch so every shared link looks polished.

---

## Phase 2: Launch Channels

### 1. Reddit

Reddit is high-impact for niche tools. Rules vary by subreddit — always read sidebar rules before posting. Most subreddits penalize self-promotion without community participation. Spend 1–2 weeks engaging genuinely before posting about Keyboardia.

#### Music Production Subreddits

| Subreddit | Subscribers | Approach |
|-----------|-------------|----------|
| r/WeAreTheMusicMakers | ~2.5M | Share as a tool you built; "I made a free browser beat maker with real-time multiplayer." Post in the weekly feedback/promotion thread first. |
| r/edmproduction | ~500K | Focus on the electronic music angle. Post a beat made in Keyboardia, link to the session. |
| r/BeatMaking | ~50K | Direct audience. "Made a free online beat maker — jam with friends in real-time." |
| r/musicproduction | ~300K | Similar to WATMM. Share a production story using Keyboardia. |
| r/synthesizers | ~300K | Web Audio synth engine is the hook. "64 synthesizers in your browser." |
| r/ableton / r/FL_Studio | Large | Position as a complement: "Sketch beats with friends in the browser, export MIDI to your DAW." |
| r/makinghiphop | ~200K | Hip-hop producers. Focus on 808 kit, beat sketching, collaboration. |

#### Tech / Indie Subreddits

| Subreddit | Approach |
|-----------|----------|
| r/SideProject | "I built a real-time multiplayer step sequencer" — technical angle welcome. |
| r/webdev | Technical deep dive on Cloudflare Durable Objects, Web Audio API, real-time sync. |
| r/javascript | Focus on the Web Audio API / Tone.js implementation. |
| r/InternetIsBeautiful | "This website lets you make music with strangers in real-time." |
| r/IndieDev / r/IndieGaming | If you frame it as an interactive experience. |

#### Music Education

| Subreddit | Approach |
|-----------|----------|
| r/MusicEd | "Free browser tool for teaching rhythm and polyrhythms." |
| r/MusicTheory | Demonstrate polyrhythmic patterns, scale lock feature. |

**Reddit Tips:**
- Title format that works: "I built [thing] — [key benefit]. It's free." or "I made a [thing] and wanted to share it"
- Include a top-level comment explaining the story behind it
- Respond to every comment
- Don't link-drop — provide value in the post itself
- Crosspost strategically (don't post to 10 subreddits on the same day)

---

### 2. Hacker News

HN is one of the highest-leverage channels for developer tools and creative web apps. Browser-based music tools with interesting technical architecture regularly hit the front page.

**Post Format:**
- Title: "Show HN: Keyboardia – Real-time multiplayer step sequencer in the browser"
- URL: https://keyboardia.dev
- Post during US work hours (9 AM – 12 PM ET, Tuesday–Thursday)

**What HN cares about:**
- Technical novelty (Durable Objects for real-time sync, Web Audio API, drift-free scheduling)
- No-signup, instant-use tools
- Novel web experiences
- Open protocols and standards

**Preparation:**
- Be ready to answer technical questions about architecture, latency, sync strategy
- Have a comment ready explaining the tech stack and design decisions
- Reference interesting challenges (voice stealing, polyrhythmic scheduling, multiplayer state sync)
- Consider writing a companion blog post about the technical architecture

**Examples of similar HN successes:**
- "Show HN: A collaborative music-making tool in the browser" — these regularly get 100+ points
- Web audio experiments consistently generate interest

---

### 3. Product Hunt

**Launch Checklist:**
- Create a maker profile in advance
- Prepare 5 high-quality screenshots/GIFs showing the product in action
- Write a concise tagline (max 60 chars): "Make beats together in real-time"
- Record a 1-minute demo video
- Prepare a "first comment" explaining the story
- Launch on Tuesday, Wednesday, or Thursday
- Rally early supporters (friends, colleagues, beta users) to upvote and comment in the first hour
- Respond to every comment on launch day

**Category:** Productivity → Music, or Design Tools → Audio

---

### 4. Twitter / X

**Content Strategy:**

- **Launch thread:** "I built a free multiplayer beat maker that runs in the browser. Here's what I learned building real-time audio collaboration on the edge. 🧵" followed by 5–8 tweets covering key features with GIFs.
- **Demo clips:** Short video clips of making beats, ideally with screen + audio. These get high engagement.
- **Build-in-public posts:** Share interesting technical challenges (polyrhythmic scheduling, Cloudflare Durable Objects, Web Audio quirks).
- **Collaboration invites:** "Anyone want to jam? Drop a reply and I'll send you a session link."

**Accounts to Engage With:**
- @CloudflareDev — They often retweet interesting projects built on their platform
- @toaborhyj (Tone.js creator)
- Music tech accounts, Web Audio API community
- Indie hackers and build-in-public community

**Hashtags:** #WebAudio #MusicTech #IndieHacker #BuildInPublic #BeatMaking #Collaboration

---

### 5. TikTok / YouTube Shorts / Instagram Reels

Short-form video is the highest-reach channel for music tools. Beat-making content performs exceptionally well.

**Content Ideas:**

| Format | Description |
|--------|-------------|
| "Making a beat in 60 seconds" | Screen recording with audio. Show beat being built step by step. |
| "I made a beat with a stranger" | Show multiplayer — invite someone, jam together, capture the result. |
| "This free website lets you make music" | Discovery-format video. |
| "POV: You open a link and there's a beat playing" | Show the experience of joining a shared session. |
| Polyrhythm demos | "What happens when every track has a different step count?" |
| "Making a beat then exporting to my DAW" | MIDI export workflow. |

**Production Tips:**
- Capture audio directly (not through speakers/mic)
- Keep videos 30–60 seconds
- Add captions
- Use trending sounds/formats when they fit naturally
- Post consistently (3–5x per week during launch window)

---

### 6. YouTube (Long-form)

**Your Own Channel:**
- "I Built a Multiplayer Beat Maker — Here's How" (technical deep-dive, 10–15 min)
- "Making Music with Strangers Online" (social experiment format)
- Tutorial: "How to Make Your First Beat in Keyboardia"

**YouTuber Outreach:**
- Reach out to music tech YouTubers with a personalized message + session link
- Target channels: Andrew Huang, You Suck at Producing, Simon Servida, In The Mix, Venus Theory
- Smaller channels (10K–100K subs) in music production are more likely to cover indie tools
- Web dev YouTubers: Fireship, Theo, ThePrimeagen — the technical architecture is interesting enough for these audiences

---

### 7. Music Production Forums

| Forum | Approach |
|-------|----------|
| **KVR Audio** | New product announcement in the instruments/effects forum. KVR is the #1 audio software directory. Submit Keyboardia to the KVR database. |
| **Gearslutz / Gearspace** | Active music production community. Post in the "Music Computers" or "Electronic Music" section. |
| **VI-Control** | Virtual instruments forum. Relevant for the synthesis engine angle. |
| **Reddit-adjacent Discord servers** | Many music production subreddits have Discord servers. |
| **Image-Line Forum** | FL Studio community often interested in complementary tools. |

---

### 8. Discord Communities

| Community | Focus |
|-----------|-------|
| **Musicord** | Large music production Discord |
| **Bedroom Producers** | Indie producers |
| **Splice Discord** | Sample/production community |
| **Ableton / FL Studio unofficial Discords** | DAW communities |
| **Cloudflare Workers Discord** | Technical showcase (they have a #showcase channel) |
| **Tone.js Discord** | Direct audience for Web Audio projects |
| **Reactiflux** | React community — technical showcase |
| **Web Audio API community** | Niche but highly targeted |

---

### 9. Music Tech Press / Blogs

Reach out with a press release or personalized pitch. Include:
- One paragraph about what Keyboardia is
- 2–3 key differentiators
- Link to the product
- 2–3 screenshots/GIFs
- Your contact info

| Publication | Focus | Pitch Angle |
|-------------|-------|-------------|
| **MusicRadar** | Music tech news | "Free browser-based multiplayer beat maker" |
| **CDM (Create Digital Music)** | Web music tools, experimental instruments | Peter Kirn covers browser music tools regularly — strong fit |
| **MusicTech** | Music production news | New free tool for producers |
| **Synthtopia** | Synthesizer news | Web Audio synthesis engine |
| **Fact Magazine** | Electronic music | Collaborative music creation angle |
| **DJ TechTools** | DJ/producer tools | Beat-making tool for DJs |
| **The Verge / Ars Technica** | Tech news | "Multiplayer music creation in the browser" — human interest tech story |
| **Hacker Noon / Dev.to** | Developer blogs | Write a technical article about building real-time audio collaboration |

---

### 10. Developer / Technical Communities

The Cloudflare + Web Audio + real-time sync architecture is genuinely interesting from a technical perspective. Use this to reach developers who will also share with their musician friends.

| Channel | Content |
|---------|---------|
| **Dev.to** | "Building a Real-Time Multiplayer Step Sequencer with Cloudflare Durable Objects" |
| **Hashnode** | Same technical content, cross-post |
| **Cloudflare Blog / Community** | Submit to Cloudflare's "Built With Workers" showcase. They actively feature interesting projects. |
| **Web Audio Weekly** | Newsletter by Chris Lowis — submit Keyboardia for inclusion |
| **Frontend Focus / JavaScript Weekly** | Cooperpress newsletters — submit for inclusion |
| **Changelog** | Podcast/newsletter — pitch as a technical story |

---

### 11. Education Channels

| Channel | Approach |
|---------|----------|
| **Music teachers on Twitter/X** | "Free tool for teaching rhythm and polyrhythms in class — no installs, works on Chromebooks" |
| **Music education Facebook groups** | "Technology for Music Educators" and similar groups |
| **ISTE (Intl. Society for Technology in Education)** | Submit to their resource directory |
| **National Association for Music Education (NAfME)** | Online resources section |
| **Google for Education** | Keyboardia works on Chromebooks — position for the K-12 market |
| **Conference presentations** | ATMI, TI:ME (Technology Institute for Music Educators) |

---

### 12. Other Channels

| Channel | Approach |
|---------|----------|
| **Indie Hackers** | Post in the product section. Share the story + metrics. |
| **Lobste.rs** | Technical community similar to HN. Post with a technical angle. |
| **Mastodon** | Post on the Fediverse. Use #WebAudio #MusicTech #IndieWeb hashtags. |
| **Bluesky** | Growing tech/creator community. |
| **Newsletter sponsorships** | TLDR, Bytes.dev, Console.dev — for developer-focused launch |
| **Lifetime deal sites** | AppSumo, if you add a premium tier |
| **Local meetups** | Present at Web Audio / JS meetups in your city |

---

## Phase 3: Content Calendar (First 4 Weeks)

### Week 1: Soft Launch

| Day | Action |
|-----|--------|
| Mon | Post on r/SideProject and r/webdev. Share technical angle. |
| Tue | **Hacker News Show HN post.** Be online for 6+ hours to respond. |
| Wed | Share on Twitter/X with demo thread. Tag @CloudflareDev. |
| Thu | Post on r/WeAreTheMusicMakers (if HN went well, mention it). |
| Fri | Submit to Dev.to / Hashnode with technical write-up. |

### Week 2: Community Engagement

| Day | Action |
|-----|--------|
| Mon | Post on r/BeatMaking and r/edmproduction (different angles). |
| Tue | Submit to Web Audio Weekly newsletter, JavaScript Weekly. |
| Wed | Post multiplayer demo on TikTok / Instagram Reels. |
| Thu | Submit to KVR Audio database. Post on Gearspace. |
| Fri | Pitch CDM (Create Digital Music) — Peter Kirn. |

### Week 3: Product Hunt + Press

| Day | Action |
|-----|--------|
| Mon | Prep Product Hunt assets. |
| Tue | **Product Hunt launch day.** |
| Wed | Post on r/InternetIsBeautiful (high-reach if it hits). |
| Thu | Follow up with music tech press pitches. |
| Fri | Post YouTube video (technical deep-dive or "making music with strangers"). |

### Week 4: Long Tail

| Day | Action |
|-----|--------|
| Mon | Post on r/MusicEd and education-focused groups. |
| Tue | Submit to Cloudflare "Built With Workers" showcase. |
| Wed | Engage Discord communities (Musicord, Tone.js, Cloudflare). |
| Thu | Cross-post best-performing content to new platforms. |
| Fri | Evaluate what worked, double down on top channels. |

---

## Phase 4: Ongoing Growth

### SEO

- Target keywords: "online beat maker," "free step sequencer," "make music online," "collaborative beat maker," "online drum machine"
- Publish example sessions with descriptive names (these become indexable pages)
- Technical blog posts generate long-tail traffic
- Ensure social preview meta tags are implemented (see `specs/SOCIAL-MEDIA-PREVIEW.md`)

### Referral / Viral Loops

Keyboardia has natural virality built in:
- **Session sharing** — Every shared link is a promotion
- **QR codes** — Physical/screen sharing at events, classrooms, meetups
- **Published sessions** — Public sessions are discoverable
- **Multiplayer invites** — Each jam session recruits new users

### Community Building

- Consider a Discord server for Keyboardia users
- Feature community-created sessions on the landing page
- Add a "Made with Keyboardia" gallery/feed
- Weekly community jams (scheduled multiplayer sessions)

### Metrics to Track

| Metric | Tool |
|--------|------|
| Landing page → session conversion | Cloudflare Workers analytics |
| Session shares / published sessions | Internal metrics |
| Multiplayer session starts | Durable Object metrics |
| Referral sources | HTTP referer headers, UTM params |
| Social media engagement | Platform analytics |

---

## Quick-Reference: Pitch Templates

### For Musicians
> **Keyboardia** is a free beat maker that runs in your browser. No install, no signup — just open the link and start making music. Invite friends to jam in real-time (up to 10 people in one session). When you're done, export to MIDI and bring it into your DAW. Try it: https://keyboardia.dev

### For Developers
> **Keyboardia** is a real-time multiplayer step sequencer built on Cloudflare Durable Objects, Web Audio API, and Tone.js. Each session is a Durable Object with WebSocket connections using the Hibernation API. 64 sound generators, polyrhythmic pattern support, drift-free lookahead scheduling, and full multiplayer state synchronization. https://keyboardia.dev

### For Educators
> **Keyboardia** is a free, browser-based tool for teaching rhythm, polyrhythms, and music collaboration. Students can join a session from any device — no installs, no accounts, works on Chromebooks. Teachers can create a session, share the link or QR code, and have the whole class making music together in seconds. https://keyboardia.dev

### For Press
> **Keyboardia** is a free, browser-based step sequencer that lets up to 10 people create music together in real-time. It features 64 sound generators, polyrhythmic patterns (3–128 steps per track), effects processing, and MIDI export — all without installing software or creating an account. Sessions can be published and remixed, creating a GitHub-style fork culture for beats. Built on Cloudflare's edge network for low-latency global collaboration. https://keyboardia.dev
