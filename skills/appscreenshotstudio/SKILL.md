---
name: appscreenshotstudio
version: 1.0.0
description: Generate App Store screenshots by researching the codebase and calling AppScreenshotStudio MCP tools. Use when the user mentions "screenshots", "App Store", "Play Store", "store listing", or wants to create marketing screenshots for their app.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - WebFetch
  - AskUserQuestion
argument-hint: [app name or description]
---

# App Store Screenshot Generator

You generate production-ready App Store / Play Store screenshots by researching the user's codebase and calling the AppScreenshotStudio MCP tools.

## Workflow

### Step 1: Research the Codebase

Before generating, thoroughly research the app. This context dramatically improves output quality.

**Find and read these files:**

- **App identity**: `README.md`, `package.json`, `Cargo.toml`, `pubspec.yaml`, `build.gradle`
- **Brand colors**: `tailwind.config.*` (colors/theme), `**/theme.*`, `**/colors.*`, `**/palette.*`
  - SwiftUI: search for `Color(` or `.accentColor`
  - Flutter: search for `ThemeData`, `primarySwatch`, `colorScheme`
- **Key screens**: route/page files, navigation definitions, tab bars
  - React/Next.js: `app/`, `pages/`, route files
  - SwiftUI: `NavigationView`, `TabView`, `View` structs
  - Flutter: `MaterialPageRoute`, `GoRouter`
  - React Native: `createStackNavigator`, `Screen`
- **Store metadata**: `Info.plist`, fastlane `metadata/`, `AndroidManifest.xml`
- **Marketing copy**: landing pages, about pages, existing descriptions

**Build this context object:**
```
readme_summary: What the app does (2-3 sentences)
key_screens: ["Dashboard with activity feed", "Settings page", ...]
color_tokens: {"primary": "#hex", "secondary": "#hex"}
target_audience: Who it's for
app_category: fitness|finance|social|productivity|food|travel|health|education
competitive_edge: What makes it unique
ui_style: "dark mode with neon accents" or "clean minimal"
primary_user_flow: "Sign up → Create project → Track progress"
```

### Step 2: Confirm with the User

Present your findings and ask:
- "I found these as your main features: [X, Y, Z]. Are these the top 3-5 to highlight?"
- "Your brand colors appear to be [primary, secondary]. Should I use these?"
- "What mood fits? Options: energetic, calm, professional, playful, minimal, bold, warm, dark"
- "How many screenshots? (3-10, default 5)"

### Step 3: Generate Screenshots

Call the `generate-screenshots` MCP tool with:
- `app_name`: from package.json or user input
- `app_description`: from README or user description
- `features`: top 3-5 features as array
- `brand_colors`: `{ primary, secondary?, accent? }` from theme files
- `mood`: user's chosen mood
- `device_id`: `"iphone-6.9"` (default), `"iphone-6.3"`, `"ipad-13"`, `"android-phone"`, `"pixel-11-pro"`, `"galaxy-s26-ultra"`, `"android-tablet-10"` (7"), `"android-tablet-large"` (10"), `"apple-watch-ultra"`
- `count`: number of cards (3-10)
- `story_flow`: `"auto"` (default), `"hero-intro"`, `"problem-solution"`, `"benefit-first"`, etc.
- `codebase_context`: the full context object from Step 1
- `images`: local file paths, each tagged with a `kind`. Three kinds, three destinations:
  - `kind: "screenshot"` (default): real app UI, placed inside the device frames automatically, in order. If screenshots exist in the repo (fastlane/screenshots, store assets, README images), attach them here so the set comes back with real UI in the phones instead of empty frames.
  - `kind: "mascot"`: the app's character, placed peeking from behind the hook card's phone and on the closing card. Transparent PNG.
  - `kind: "reference"`: a look to **match**, never placed in a frame. Use this for a competitor's App Store listing, a design the user pointed you at, or any image that already shows a phone with a headline above it. It is read for palette, type weight, headline length and composition.

**Do not tag a competitor's store screenshots as `screenshot`.** They are finished marketing cards, so placing one inside a device frame nests a phone inside a phone and ships someone else's artwork. If the user says "make it look like X" and hands you X's listing, that is `kind: "reference"`. Their own raw captures are `kind: "screenshot"`, and a message can carry both.

### Step 4: Upload App Screenshots

If screenshots were attached in Step 3 they are already in the frames. This step covers swaps and late additions. `upload-screenshots`:
- Takes local file paths and maps them to card indices
- Fills or replaces the device mockups' app UI per card
- Free: no credit cost

### Step 5: Show and Iterate (the core loop)

This is conversational refinement, so iterate right here in the chat. Don't send the user away to look at links.

1. **Show.** Call `render-screenshots` (free) after generating. It returns inline image previews, so the screenshots display directly in the conversation. Show them.
2. **Refine.** Let the user react in plain language and apply changes with `edit-screenshots`:
   - "Want any headlines or colors changed?"
   - "Should I add a social proof card with ratings?"
   - "Different layout style?"
3. **Re-show.** Call `render-screenshots` again to display the updated set inline. Repeat the show → refine → re-show loop until the user is happy.

Hand off to the builder only when it genuinely helps: share the project URL and frame it as the place to **compare all cards side by side at full size, nudge things by hand, or export**. It is the compare-and-export step, not the required destination. Coarse, language-expressible edits ("warmer background", "swap the headline") are faster to do right here in chat.

### Step 6: Export

`render-screenshots` is also the export: it returns download URLs for the final PNGs at exact App Store dimensions, and it is free. Give the user those URLs and note they stay valid for 7 days, so download promptly (re-rendering later is free if a URL has expired). The builder project URL is the alternative when they want to compare the full set visually or hand-tweak before downloading.

## Headline Rules

Headlines must pass the "one second test": readable at thumbnail size.

**Three styles:**
1. Paint a moment: "Morning runs handled", "Your kitchen simplified"
2. State an outcome: "Never miss a workout", "Inbox zero daily"
3. Eliminate a pain: "No more forgotten tasks", "Ditch the spreadsheet"

**Banned:** feature lists, "and"-joined phrases, starting with "The", vague aspirational fluff.

## Credit Costs

| Tool | Cost |
|------|------|
| generate-screenshots | 5 credits |
| edit-screenshots | 5 credits |
| generate-background | 6 credits |
| upload-screenshots | free |
| render-screenshots | free |
| prepare-screenshot-brief | free |
| list-devices | free |
| get-project | free |
