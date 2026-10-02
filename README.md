# @appscreenshotstudio/mcp

MCP server for generating App Store screenshots via [AppScreenshotStudio](https://appscreenshotstudio.com).

Let your AI agent (Claude Code, Cursor, Windsurf) generate, edit, and export App Store screenshots as a native tool.

## Setup

### 1. Get an API key

Create one at [appscreenshotstudio.com/settings](https://appscreenshotstudio.com/settings) under **API Keys**.

### 2. Install

**Claude Code:**

```bash
claude mcp add appscreenshotstudio -- npx -y @appscreenshotstudio/mcp
```

Then add to your shell profile (`.bashrc`, `.zshrc`, etc.):

```bash
export APPSCREENSHOTSTUDIO_API_KEY="sk_live_your_key_here"
```

**Cursor / Windsurf / Other MCP clients:**

Add to your MCP config (`.cursor/mcp.json`, `settings.json`, etc.):

```json
{
  "mcpServers": {
    "appscreenshotstudio": {
      "command": "npx",
      "args": ["-y", "@appscreenshotstudio/mcp"],
      "env": {
        "APPSCREENSHOTSTUDIO_API_KEY": "sk_live_your_key_here"
      }
    }
  }
}
```

## Tools

### `prepare-screenshot-brief`

Get a research checklist and strategy guide before generating. Returns file patterns to search for across tech stacks, story flow recommendations per app category, headline tips, and the `codebase_context` schema to fill in.

**Free: no API call or credits.**

### `generate-screenshots`

Create a complete set of App Store screenshots. The agent researches your codebase first, then passes rich context for accurate, app-specific designs.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `app_name` | string | Yes | App name |
| `app_description` | string | Yes | What the app does (1-3 sentences) |
| `features` | string[] | No | Key features, ordered by importance (max 10) |
| `brand_colors` | object | No | `{ primary, secondary?, accent? }` as hex |
| `mood` | string | No | "energetic", "calm", "minimal", "bold", etc. |
| `device_id` | string | No | Target device (default: `iphone-6.9`) |
| `count` | number | No | Number of cards, 3-10 (default: 5) |
| `story_flow` | string | No | Narrative structure (default: `auto`) |
| `codebase_context` | object | No | App context from codebase research (see below) |
| `images` | array | No | Local image files to attach (see [`images`](#images) below) |

**Costs 5 credits.**

#### `codebase_context`

Pass this for dramatically better screenshots. The context is persisted on the project and used in all subsequent chats.

| Field | Description |
|---|---|
| `readme_summary` | App overview from README or docs |
| `key_screens` | Main screens/views (e.g. "Dashboard", "Settings") |
| `color_tokens` | Brand colors from theme files (e.g. `{ "primary": "#7C3AED" }`) |
| `target_audience` | Who the app is for |
| `app_category` | fitness, finance, social, productivity, etc. |
| `competitive_edge` | What makes it unique |
| `app_store_description` | Existing store listing if found |
| `tech_stack` | React Native, SwiftUI, Flutter, etc. |
| `ui_style` | "dark mode with neon accents", "clean minimal", etc. |
| `primary_user_flow` | Main user journey through the app |

#### `images`

Attach local image files as `{ file_path, kind }`. Max 5 per call. The `kind` decides where the image goes, and getting it wrong is the one mistake with a visible cost:

| `kind` | What it is | Where it goes |
|---|---|---|
| `screenshot` (default) | Your real app UI, straight from a simulator or device | Inside the generated device frames, in attachment order |
| `mascot` | Your app's character or logo creature | Decoratively around the phones (peeking from behind the hook card, beside the closing card). Use a transparent PNG |
| `reference` | A look to **match**: a competitor's App Store listing, a design the user pointed you at, any image that already shows a phone with a headline above it | Nowhere. It is read for palette, type weight, headline length and composition, and never placed in a frame |
| `background` | The user's own photo: an arena, a product shot, a brand photo, a still from their video | **Behind** the cards. One photo becomes one panorama across the first three cards (or the cards your message names, e.g. "across all of them"); several become one per card, in attachment order. Free: the photo is cut to fit, nothing is generated |

The images in one call must stay under about 4MB encoded. The tool does not resize, and a photo straight off a camera is often bigger, so shrink it first (a 3840px long edge at JPEG quality 85 is plenty). An oversized call is refused before anything is sent, with no credits spent.

**Do not send a competitor's store screenshots as `screenshot`.** They are finished marketing cards, so putting one inside a device frame nests a phone inside a phone and ships someone else's artwork into your listing. If the user says "make it look like this app" and hands you that app's listing, it is `reference`. Their own raw captures are `screenshot`. One call can carry both, and the reference ones are simply skipped when the frames get filled.

If you send a reference without tagging it, the server classifies it from the image and holds it out anyway, and says so in the reply. Tagging it is the deterministic path.

```jsonc
{
  "app_name": "Kestrel",
  "images": [
    { "file_path": "/Users/me/competitor-listing-1.png", "kind": "reference" },
    { "file_path": "/Users/me/Desktop/today.png",        "kind": "screenshot" },
    { "file_path": "/Users/me/Desktop/calendar.png",     "kind": "screenshot" }
  ]
}
```

### `edit-screenshots`

Make changes to an existing project with natural language. Optionally target specific cards.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project_id` | string | Yes | From a previous `generate-screenshots` call |
| `message` | string | Yes | What to change |
| `card_indices` | number[] | No | Target specific cards by index (0-based). Omit to edit all. |
| `codebase_context` | object | No | App context to enrich the edit (same schema as above) |
| `images` | array | No | Same shape as above. Screenshots fill the device frames of regenerated cards; a reference only informs the design |

**Costs 5 credits.**

### `upload-screenshots`

Upload local app screenshots (from Simulator, emulator, or screen captures) into the device mockups of an existing project. Reads files from your local filesystem and places them into the device frames.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project_id` | string | Yes | From a previous `generate-screenshots` call |
| `screenshots` | array | Yes | Array of `{ file_path, card_index }`: maps local files to cards |

Each item in `screenshots`:

| Field | Type | Description |
|---|---|---|
| `file_path` | string | Absolute path to a local PNG, JPG, or WEBP file |
| `card_index` | number | Which card to place this screenshot on (0-based) |

**Free.**

### `render-screenshots`

Export to high-resolution PNGs. Returns download URLs.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project_id` | string | Yes | Project to render |

**No credit cost, and it needs an active paid plan.** Rendering is unlocked by
the first payment, so on a trial this returns 402 `PAYMENT_REQUIRED`. That
applies to the inline previews an agent shows mid-loop as well as to the final
export.

### `get-project`

Retrieve a project's current state: cards, elements, backgrounds, and metadata.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project_id` | string | Yes | Project ID to retrieve |

**Free.**

### `generate-background`

Generate an AI background for a specific card. Uses project metadata (brand colors, mood, theme) for contextual results.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project_id` | string | Yes | Project containing the card |
| `card_index` | number | Yes | Which card (0-based) |
| `prompt` | string | Yes | Description of the background |

**Costs 6 credits.**

### `generate-panoramic-background`

Generate one wide image and slice it across multiple cards so they read as a continuous scene in the App Store gallery. Use after a panoramic chat edit ("pano the background across cards 1-3") to fulfill the pending panoramic, or pass an explicit `prompt` / `pexels_query`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project_id` | string | Yes | Project containing the cards |
| `prompt` | string | No | AI scene description (Gemini). Costs 6 credits. |
| `pexels_query` | string | No | Stock photo search query (Pexels). Free. |
| `card_indices` | number[] | No | Cards sharing the panoramic (0-based, min 2). Default: first 3. |

Omit both `prompt` and `pexels_query` to fulfill a panoramic already set up by `generate-screenshots` / `edit-screenshots`.

**Costs 6 credits (AI prompt) or free (Pexels query).**

### `list-devices`

Show all supported device specs. No API call needed.

**Free.**

## Claude Code Skill

The MCP server auto-installs a Claude Code skill on first startup. The skill teaches Claude a structured research-first workflow for better screenshot results. You can also install it manually:

```bash
npx @appscreenshotstudio/mcp install-skill
```

Once installed, use `/appscreenshotstudio` in Claude Code or just ask "generate App Store screenshots for my app".

## Supported Devices

| ID | Name | Size | Required |
|---|---|---|---|
| `iphone-6.9` | iPhone 16 Pro Max | 1260x2736 | App Store |
| `iphone-6.3` | iPhone 17 Pro | 1206x2622 | Optional |
| `ipad-13` | iPad Pro 13" | 2064x2752 | App Store |
| `android-phone` | Android Phone | 1080x2340 | Play Store |
| `pixel-11-pro` | Google Pixel 11 Pro | 1280x2856 | Play Store |
| `galaxy-s26-ultra` | Samsung Galaxy S26 Ultra | 1440x3120 | Play Store |
| `android-tablet-10` | Android Tablet 7" | 1200x1920 | Play Store |
| `android-tablet-large` | Android Tablet 10" | 1600x2560 | Play Store |
| `apple-watch-ultra` | Apple Watch Ultra 2 | 410x502 | App Store |

## Design Features

The AI generates professional screenshots using:

- **94 shape types** (17 core + 77 decorative across 13 categories): nature (leaf, flower, tree), weather (cloud, sun, snowflake), celebration (sparkle, trophy, crown, confetti), social (chat-bubble, music-note), tech (rocket, code-bracket), health (dumbbell, flame), food (coffee-cup, pizza), travel (airplane, compass), finance (dollar-sign, piggy-bank), education (graduation-cap, lightbulb), pets (paw-print, cat-face), emoji (smiley, fire-emoji), abstract (swirl, infinity, gem)
- **Rich text**: per-word color, bold, italic, underline, highlight pills (colored backgrounds behind words), gradient fills, text stroke outlines, emoji
- **Compound trust signals**: statRow, laurelStat, starRating, quote, pressBanner, credential, guarantee. Auto-positioned per layout, and opt-in: supply the real figure or the card ships clean
- **Background textures**: diagonal-stripe, crosshatch, checkerboard, zigzag, hairline-grid, dot-grid, waves, grain, radial-rays, concentric-circles. Ask for one explicitly; they are subtle by design and run continuously across the set.
- **Frame color**: recolor the device frame: `natural` (default), `black`, `white`, `gold`. Requires Growth plan or higher.
- **Panoramics**: slice one wide image across cards (chat tags the cards, then `generate-panoramic-background` creates and slices the image) or stretch a foreground element across adjacent cards (`apply_element_span`). Gallery gutters are accounted for.
- **9 device perspectives**: flat, left-15, left-30, right-15, right-30, isometric, top-down, landscape-left, landscape-right
- **10 layouts**: `text-top-device-bottom`, `text-top-device-tilted`, `device-hero`, `social-proof`, `review-clip`, `screen-hero`, `lifestyle-hero`, `stats-hero`, `metric-badge`, `annotated-feature`. The AI also varies the device angle, `deviceScale`, `deviceSide`, `textPosition`, and `textAlign` per card so a set never looks like duplicates.

## Workflow

1. **Research**: Agent calls `prepare-screenshot-brief`, then searches your codebase for app name, features, colors, screens, and audience
2. **Generate**: Agent calls `generate-screenshots` with `codebase_context` for app-specific designs
3. **Iterate**: Agent calls `edit-screenshots` to refine (codebase context carries over automatically)
4. **Upload**: Agent calls `upload-screenshots` with local file paths to fill device mockups
5. **Export**: Agent calls `render-screenshots` (needs a paid plan) or click "Download All" in the web app

## Security

- API key stays on your machine (environment variable)
- All API calls over HTTPS
- stdio transport: no network ports opened
- Revoke keys anytime in Settings

## Privacy Policy

Full policy: [appscreenshotstudio.com/privacy](https://appscreenshotstudio.com/privacy). What that means for this MCP server specifically:

**What is collected.** Only the arguments you pass to a tool. That means the app context you or your agent supply (app name, description, features, brand colors, mood, and any `codebase_context` fields), the natural-language messages you send to `edit-screenshots`, background prompts, and any image files you explicitly attach through `images` or `upload-screenshots`.

**What is not collected.** The server reads only the file paths you hand it. It does not scan, index, or upload your repository, and it opens no network ports. Your API key is read from an environment variable and stays on your machine; it is sent only as an auth header to appscreenshotstudio.com.

**Where it goes.** One host: `https://appscreenshotstudio.com`. There is no telemetry endpoint and no third-party analytics in this package.

**Third-party processing.** Designs and edits are generated by an LLM, AI backgrounds by Google Gemini, and stock backgrounds are fetched from Pexels when you pass `pexels_query`. Files are stored via our storage provider. See the full policy for the current list.

**Retention.** Projects persist in your account until you delete them. Rendered PNG download URLs expire after 7 days.

**Contact.** [contact@bookillustrationai.com](mailto:contact@bookillustrationai.com)

## Links

- [Screenshot API + MCP overview](https://appscreenshotstudio.com/api)
- [Full docs](https://appscreenshotstudio.com/docs/mcp)
- [REST API reference](https://appscreenshotstudio.com/docs/api)
- [Pricing](https://appscreenshotstudio.com/pricing)
