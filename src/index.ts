#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// ─── CLI: install-skill ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args[0] === 'install-skill') {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const src = join(__dirname, '..', 'skills', 'appscreenshotstudio', 'SKILL.md');
  const destDir = join(homedir(), '.claude', 'skills', 'appscreenshotstudio');
  const dest = join(destDir, 'SKILL.md');

  if (!existsSync(src)) {
    console.error('Error: SKILL.md not found in package. Try reinstalling @appscreenshotstudio/mcp.');
    process.exit(1);
  }

  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
  console.log('Skill installed to ~/.claude/skills/appscreenshotstudio/SKILL.md');
  console.log('');
  console.log('You can now use /appscreenshotstudio in Claude Code to generate screenshots.');
  console.log('Make sure the MCP server is also configured in your Claude Code settings.');
  process.exit(0);
}

const API_BASE = process.env.APPSCREENSHOTSTUDIO_URL || 'https://appscreenshotstudio.com';
const API_KEY = process.env.APPSCREENSHOTSTUDIO_API_KEY;

// ─── Devices (mirrors lib/device-specs.ts) ─────────────────────────────────────
// ⚠️ Keep in sync: lib/device-specs.ts, mcp-server/README.md, docs/api page, docs/mcp page,
//    mcp-server/skills/appscreenshotstudio/SKILL.md (ships in the npm package, so it drifts unseen),
//    public/api-docs.md (served raw at /api-docs.md, linked from nowhere, so it drifts unseen too)
//    Enforced by `npm run test:device-specs`, which reads all six files.

// Hand-copied from lib/device-specs.ts because this package ships standalone.
// `required` means required to PUBLISH, and it is emitted to agents as
// "required for store submission", so a wrong flag here is a wrong instruction
// rather than a cosmetic slip. Keep it in step with the source file.
const DEVICES = [
  { id: 'iphone-6.9', name: 'iPhone 16 Pro Max', width: 1260, height: 2736, category: 'iphone', required: true },
  { id: 'iphone-6.3', name: 'iPhone 17 Pro', width: 1206, height: 2622, category: 'iphone', required: false },
  { id: 'ipad-13', name: 'iPad Pro 13"', width: 2064, height: 2752, category: 'ipad', required: true },
  { id: 'android-phone', name: 'Android Phone', width: 1080, height: 2340, category: 'android-phone', required: true },
  { id: 'pixel-11-pro', name: 'Google Pixel 11 Pro', width: 1280, height: 2856, category: 'android-phone', required: false },
  { id: 'galaxy-s26-ultra', name: 'Samsung Galaxy S26 Ultra', width: 1440, height: 3120, category: 'android-phone', required: false },
  // Play Console requires 2 screenshots to publish; tablets are "can add", not
  // "must provide". Was `true` until 2026-09-07. See lib/device-specs.ts.
  { id: 'android-tablet-10', name: 'Android Tablet 7"', width: 1200, height: 1920, category: 'android-tablet', required: false },
  { id: 'android-tablet-large', name: 'Android Tablet 10"', width: 1600, height: 2560, category: 'android-tablet', required: false },
  { id: 'apple-watch-ultra', name: 'Apple Watch Ultra 2', width: 410, height: 502, category: 'apple-watch', required: true },
] as const;

const VALID_DEVICE_IDS = DEVICES.map(d => d.id);

// Aliases callers commonly pass instead of the canonical id: display-name
// derivations ("iPhone 16 Pro Max" -> iphone-16-pro-max) and legacy slugs.
// Mirrors MARKETING_TO_SPEC in lib/device-specs.ts. Keep the two in sync.
const DEVICE_ALIASES: Record<string, string> = {
  'iphone-16-pro': 'iphone-6.9',
  'iphone-16-pro-max': 'iphone-6.9',
  'iphone-17-pro': 'iphone-6.3',
  'samsung-galaxy-s25-ultra': 'android-phone',
  'ipad-pro-13': 'ipad-13',
  'ipad-12.9': 'ipad-13',
  'ipad-pro-12.9': 'ipad-13',
  'android-tablet': 'android-tablet-10',
  'apple-watch': 'apple-watch-ultra',
};

/**
 * Resolve a caller-supplied device id to a canonical one, or return the list of
 * valid devices for a helpful error. Runs at the tool boundary so an unknown
 * device fails fast (before a project is created and generation credits are
 * spent) instead of surfacing late as a render-time "Unknown device".
 */
function resolveDeviceId(input: string): { id: string } | { error: string } {
  const normalized = DEVICE_ALIASES[input] ?? input;
  if ((VALID_DEVICE_IDS as readonly string[]).includes(normalized)) return { id: normalized };
  const options = DEVICES.map(d => `${d.id} (${d.name})`).join(', ');
  return { error: `Unknown device "${input}". Valid devices: ${options}.` };
}

// ─── API helper ─────────────────────────────────────────────────────────────────

async function apiCall(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  if (!API_KEY) {
    return { ok: false, status: 401, data: { error: 'APPSCREENSHOTSTUDIO_API_KEY not set' } };
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = await res.json() as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

// ─── Message builder ────────────────────────────────────────────────────────────

const STORY_FLOW_DESCRIPTIONS: Record<string, string> = {
  'auto': 'Choose the best narrative structure automatically',
  'standard': 'Standard feature highlights',
  'problem-solution': 'Problem, then solution, then benefit',
  'social-proof': 'Lead with testimonials and reviews',
  'benefit-first': 'Lead with benefits, features later',
  'journey': 'User journey and before/after transformation',
  'hero-intro': 'Hero branding screen first (no device), then features with devices',
  'social-proof-bookend': 'Hero intro, then features, then social proof ending',
};

interface CodebaseContext {
  readme_summary?: string;
  key_screens?: string[];
  color_tokens?: Record<string, string>;
  target_audience?: string;
  app_category?: string;
  competitive_edge?: string;
  app_store_description?: string;
  tech_stack?: string;
  ui_style?: string;
  primary_user_flow?: string;
}

interface GenerateInput {
  app_name: string;
  app_description: string;
  features?: string[];
  brand_colors?: { primary: string; secondary?: string; accent?: string };
  mood?: string;
  device_id: string;
  count: number;
  story_flow: string;
  codebase_context?: CodebaseContext;
}

function buildDesignMessage(input: GenerateInput, hasScreenshotImages = false): string {
  const parts: string[] = [];

  parts.push(`Create ${input.count} App Store screenshots for my app.`);
  parts.push(`\nApp name: ${input.app_name}`);
  parts.push(`Description: ${input.app_description}`);

  if (input.features?.length) {
    parts.push(`\nKey features (in order of importance):`);
    for (const f of input.features) {
      parts.push(`- ${f}`);
    }
  }

  if (input.brand_colors) {
    const colors = [`primary: ${input.brand_colors.primary}`];
    if (input.brand_colors.secondary) colors.push(`secondary: ${input.brand_colors.secondary}`);
    if (input.brand_colors.accent) colors.push(`accent: ${input.brand_colors.accent}`);
    parts.push(`\nBrand colors: ${colors.join(', ')}`);
  }

  if (input.mood) {
    parts.push(`Mood: ${input.mood}`);
  }

  if (input.story_flow && input.story_flow !== 'auto') {
    parts.push(`\nStory flow: ${input.story_flow} (${STORY_FLOW_DESCRIPTIONS[input.story_flow] || input.story_flow})`);
  }

  if (input.codebase_context) {
    const ctx = input.codebase_context;
    parts.push('\n--- App Research Context (from codebase analysis) ---');
    if (ctx.readme_summary) parts.push(`App overview: ${ctx.readme_summary}`);
    if (ctx.key_screens?.length) {
      parts.push('Key screens in the app:');
      for (const screen of ctx.key_screens) parts.push(`  - ${screen}`);
    }
    if (ctx.color_tokens && Object.keys(ctx.color_tokens).length) {
      parts.push(`Theme colors from code: ${JSON.stringify(ctx.color_tokens)}`);
    }
    if (ctx.target_audience) parts.push(`Target audience: ${ctx.target_audience}`);
    if (ctx.app_category) parts.push(`App category: ${ctx.app_category}`);
    if (ctx.competitive_edge) parts.push(`What makes it unique: ${ctx.competitive_edge}`);
    if (ctx.app_store_description) parts.push(`Existing store description: ${ctx.app_store_description}`);
    if (ctx.tech_stack) parts.push(`Tech stack: ${ctx.tech_stack}`);
    if (ctx.ui_style) parts.push(`UI style: ${ctx.ui_style}`);
    if (ctx.primary_user_flow) parts.push(`Primary user flow: ${ctx.primary_user_flow}`);
    parts.push('--- End App Research Context ---');
    parts.push('\nUse the research context above to create screenshots that accurately represent this specific app. Headlines, features, and visual style should reflect what the app actually does and looks like.');
  }

  if (hasScreenshotImages) {
    parts.push(`\nMy app screenshots are attached, and they are placed into the device frames automatically.`);
  } else {
    parts.push(`\nAll device mockups should have screenshotImage: null. The developer will upload actual app screenshots later.`);
  }
  parts.push(`Please include projectMeta with brand colors, mood, appCategory, and a rich globalVisualTheme description.`);

  return parts.join('\n');
}

/** Read local image files into the chat API's images payload. Same file
 *  handling as upload-screenshots; kind rides through to server-side
 *  placement (screenshots fill the generated device frames, mascots get
 *  placed decoratively around the phones, references are read for taste and
 *  never placed). */
type ChatImageKind = 'screenshot' | 'mascot' | 'reference' | 'background';

/**
 * Characters of image data one chat call may carry. The server sits behind a
 * 4.5MB request-body limit that rejects the call before it runs, so an agent
 * sees a bare failure. This package does not resize (no image library), and a
 * background photo straight off a camera is several MB, so say so up front.
 */
const CHAT_IMAGE_BUDGET_CHARS = 4_000_000;

/** A message telling the agent how to fit, or null when the images fit. */
function imagesOverBudget(payload: Array<{ dataUrl: string }>): string | null {
  const total = payload.reduce((n, img) => n + img.dataUrl.length, 0);
  if (total <= CHAT_IMAGE_BUDGET_CHARS) return null;
  return `The attached images are ${(total / 1e6).toFixed(1)}MB encoded, over the ${(CHAT_IMAGE_BUDGET_CHARS / 1e6).toFixed(1)}MB one call can carry, so nothing was sent and no credits were spent. `
    + 'Shrink them first, e.g. to a 3840px long edge as JPEG quality 85 (macOS: sips -Z 3840 -s format jpeg in.png --out out.jpg; ImageMagick: magick in.png -resize "3840x3840>" -quality 85 out.jpg), or send background photos in a call of their own.';
}
function readImagesForChat(
  images?: Array<{ file_path: string; kind: ChatImageKind }>,
): { payload: Array<{ dataUrl: string; mediaType: string; kind: ChatImageKind }>; errors: string[] } {
  const payload: Array<{ dataUrl: string; mediaType: string; kind: ChatImageKind }> = [];
  const errors: string[] = [];
  for (const { file_path, kind } of images ?? []) {
    try {
      if (!existsSync(file_path)) {
        errors.push(`File not found: ${file_path}`);
        continue;
      }
      const buffer = readFileSync(file_path);
      const ext = file_path.toLowerCase().split('.').pop();
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : 'image/png';
      payload.push({ dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`, mediaType: mimeType, kind });
    } catch (err) {
      errors.push(`Failed to read ${file_path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { payload, errors };
}

/** Shared images param for generate-screenshots and edit-screenshots. */
const chatImagesSchema = z.array(z.object({
  file_path: z.string().describe('Absolute path to an image file on the local filesystem (PNG, JPG, or WEBP)'),
  kind: z.enum(['screenshot', 'mascot', 'reference', 'background']).default('screenshot')
    .describe("'screenshot' = real app UI, automatically placed inside the generated device frames (in attachment order). 'mascot' = the app's character/mascot, placed decoratively around the phones (peeking from behind the hook card's phone, beside or in a corner on the closing card); use a transparent PNG. 'reference' = a look to match rather than content: a competitor's App Store listing, a design you want the style of, any image that already shows a phone with a headline above it. A reference is read for taste and is NEVER placed inside a frame, which is the point: wrapping a finished marketing card in a device frame puts a phone inside a phone. 'background' = the user's own photo, placed BEHIND the cards: one background photo becomes one panorama across a group of cards (the first three, or the cards the message names, e.g. \"across all of them\"), several become one per card in attachment order. Free, nothing is generated; cards the photo lands on get a dark band and light text so the words stay readable."),
})).max(5).optional()
  .describe('Images to attach to this generation. App screenshots land inside the device frames automatically; a mascot gets placed around the phones; a reference only informs the design; a background photo goes behind the cards. All survive later edits and regenerations. Together they must stay under about 4MB encoded: this tool does not resize, so shrink camera photos first.');

// ─── MCP Server ─────────────────────────────────────────────────────────────────

// Read from package.json rather than a literal. This is the version a client
// sees in the MCP handshake, and a hand-synced literal silently sat at 0.6.1
// through the 0.6.2 release, then at 0.6.3 through 0.7.0 and 0.8.0. A comment
// asking the next person to remember has now failed twice, so stop asking.
const PKG_VERSION: string = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
).version;

const server = new McpServer({
  name: 'appscreenshotstudio',
  version: PKG_VERSION,
});

// Tool 1: generate-screenshots
server.registerTool(
  'generate-screenshots',
  {
    title: 'Generate App Store Screenshots',
    annotations: {
      // Creates a new project; never overwrites an existing one.
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    description: `Create a complete set of App Store screenshot designs for an app. Attach real app screenshots via the images param and they are placed inside the device frames automatically; attach a mascot/character image (kind: "mascot", transparent PNG) and it gets placed around the phones; attach the user's own photo (kind: "background") and it goes behind the cards, one photo as a panorama or several as one per card. Returns a project URL where the developer can preview, refine, and export final PNGs.

IMPORTANT: Before calling this tool, research the user's codebase to populate the codebase_context parameter. Search for: package.json/README (app name & description), theme/color config files (brand colors), route definitions (key screens), marketing copy (value proposition), and App Store metadata. The more context you provide, the better the screenshots will be. Call prepare-screenshot-brief first if you need a research checklist.

The AI picks a narrative arc that fits the app's sell angle (trust-first for finance/health, visual-first for creative/lifestyle, problem-first for pain-relief apps, numbers-led for SaaS/analytics, community-first for social, feature-forward for multi-mode apps) and assigns a job to each card: HOOK → EDUCATE → PROVE → CONVERT.

10 layout types available per card:
- text-top-device-bottom: headline top, flat device bottom (feature/educate)
- text-top-device-tilted: headline left, tilted device right (or mirrored)
- device-hero: headline + large centered device, product-forward
- social-proof: stars + quote + laurel stat, no device (testimonial-led)
- review-clip: rating-statement headline + stars + quote + bottom-clipped device
- screen-hero: top-clipped device + centered headline + optional trust stat
- lifestyle-hero: full-bleed photo background + text overlay (no device)
- stats-hero: giant centered stat(s), no device, numbers-led
- metric-badge: centered device + chunky "achievement card" floating over its screen
- annotated-feature: tilted device + side callout chip linked by a connector line

Each card can carry auto-positioned compound fields: statRow, laurelStat, pressBanner, starRating, quote, credential ("FDIC insured"-style trust pills), guarantee ("Cancel anytime"-style risk-reversal pills). Trust signals are opt-in: supply the real number, quote or press name, or the card ships clean rather than inventing one.

Panoramic backgrounds slice one wide AI-generated or Pexels image across multiple cards for cohesion. Panoramic element spans stretch a foreground image or device across adjacent cards. Note: if the design comes back with a panoramic background, the chat only tags the cards; call generate-panoramic-background afterwards to actually create and slice the wide image.

Design features:
- Rich text with per-word color, weight, italic, underline, highlight pills, gradient fills, stroke outlines, and emoji
- Device perspective variants: flat, left-15/30, right-15/30, isometric, top-down, landscape
- 77 decorative shapes across 13 categories (nature, weather, celebration, social, tech, health, food, travel, abstract, finance, education, pets, emoji), plus 17 core geometric shapes
- Laurel stats: wing-left + wing-right shapes flanking a hero number

App Store 60/40 rule enforced: minimum 60% of cards must show a device mockup, maximum 40% can be marketing-only.

Costs 5 credits per generation.`,
    inputSchema: z.object({
      app_name: z.string().describe('Name of the app'),
      app_description: z.string().describe('What the app does, in 1-3 sentences'),
      features: z.array(z.string()).max(10).optional()
        .describe('Key features in order of importance. The first 2-3 will be highlighted most prominently.'),
      brand_colors: z.object({
        primary: z.string().describe('Primary brand color as hex (e.g. #7C3AED)'),
        secondary: z.string().optional().describe('Secondary color as hex'),
        accent: z.string().optional().describe('Accent color as hex'),
      }).optional().describe('Brand colors to use in the design'),
      mood: z.string().optional()
        .describe('Design mood, e.g. "energetic", "calm", "minimal", "bold", "professional", "playful"'),
      device_id: z.string().default('iphone-6.9')
        .describe(`Target device. Options: ${VALID_DEVICE_IDS.join(', ')}. Default: iphone-6.9 (iPhone 16 Pro Max)`),
      count: z.number().min(3).max(10).default(5)
        .describe('Number of screenshot cards to generate (3-10). Default: 5'),
      story_flow: z.enum(['auto', 'standard', 'problem-solution', 'social-proof', 'benefit-first', 'journey', 'hero-intro', 'social-proof-bookend']).default('auto')
        .describe('Narrative structure for the screenshots. "auto" lets the AI choose the best flow.'),
      codebase_context: z.object({
        readme_summary: z.string().optional()
          .describe('Summary of the app from README or docs: what does it do and why?'),
        key_screens: z.array(z.string()).max(15).optional()
          .describe('Main screens/views in the app, e.g. "Dashboard with activity feed", "Settings with theme toggle"'),
        color_tokens: z.record(z.string()).optional()
          .describe('Brand/theme colors found in code, e.g. {"primary": "#7C3AED", "background": "#0F172A"}'),
        target_audience: z.string().optional()
          .describe('Who the app is for, e.g. "busy professionals who want to track habits"'),
        app_category: z.string().optional()
          .describe('App category, e.g. fitness, finance, social, productivity, food, travel, health, education'),
        competitive_edge: z.string().optional()
          .describe('What makes this app unique vs competitors'),
        app_store_description: z.string().optional()
          .describe('Existing App Store/Play Store description if found in the codebase'),
        tech_stack: z.string().optional()
          .describe('Tech stack, e.g. "React Native", "SwiftUI", "Flutter". Useful for developer-tool apps.'),
        ui_style: z.string().optional()
          .describe('UI style observations, e.g. "dark mode with neon accents", "clean minimal with lots of whitespace"'),
        primary_user_flow: z.string().optional()
          .describe('The main user journey, e.g. "Sign up → Create project → Invite team → Track progress"'),
      }).optional()
        .describe('Context gathered from researching the app codebase. Dramatically improves screenshot quality. The more detail here, the better the output.'),
      images: chatImagesSchema,
    }),
  },
  async (input) => {
    // Resolve/validate the device up front so an unknown id fails fast here
    // instead of after a project (and its 5 generation credits) is spent.
    const resolved = resolveDeviceId(input.device_id);
    if ('error' in resolved) {
      return { content: [{ type: 'text' as const, text: resolved.error }] };
    }

    // Read the images before anything is created, so an oversized attachment
    // fails here instead of leaving an empty project behind.
    const { payload: chatImages, errors: imageErrors } = readImagesForChat(input.images);
    const tooBig = imagesOverBudget(chatImages);
    if (tooBig) {
      return { content: [{ type: 'text' as const, text: tooBig }] };
    }

    // Step 1: Create project (with codebase context if provided)
    const projectName = `${input.app_name} Screenshots`;
    const createBody: Record<string, unknown> = {
      device_id: resolved.id,
      name: projectName,
    };
    if (input.codebase_context) {
      createBody.codebase_context = input.codebase_context;
    }
    const createRes = await apiCall('POST', '/api/v1/projects', createBody);

    if (!createRes.ok) {
      return {
        content: [{ type: 'text' as const, text: `Failed to create project: ${JSON.stringify(createRes.data)}` }],
      };
    }

    const project = createRes.data.data as { id: string };
    const projectId = project.id;

    // Step 2: Chat to generate all cards (with attached images when provided:
    // screenshots auto-fill the device frames, mascots decorate around them)
    const hasScreens = chatImages.some((img) => img.kind === 'screenshot');
    const message = buildDesignMessage(input, hasScreens);
    const chatRes = await apiCall('POST', `/api/v1/projects/${projectId}/chat`, {
      message,
      selected_card_indices: [],
      ...(chatImages.length > 0 ? { images: chatImages } : {}),
    });

    if (!chatRes.ok) {
      return {
        content: [{ type: 'text' as const, text: `Project created (${projectId}) but design generation failed: ${JSON.stringify(chatRes.data)}` }],
      };
    }

    const chatData = chatRes.data.data as {
      message: string;
      canvas_state: { cards: unknown[] };
      suggestions: string[];
      project_meta: unknown;
    };
    const creditsRemaining = chatRes.data.credits_remaining;

    const projectUrl = `${API_BASE}/builder/${projectId}`;

    return {
      content: [{
        type: 'text' as const,
        text: [
          `Generated ${chatData.canvas_state?.cards?.length || 0} screenshot cards for "${input.app_name}".`,
          '',
          chatData.message,
          '',
          `Project URL: ${projectUrl}`,
          `Project ID: ${projectId}`,
          `Credits remaining: ${creditsRemaining}`,
          '',
          'Next steps:',
          hasScreens
            ? '1. Your attached screenshots were placed into the device frames (upload-screenshots can swap any card later)'
            : '1. Use upload-screenshots to add your app screenshots into the device frames',
          // edit-screenshots was missing from this list until 2026-09-14, and the
          // omission has a measurable cost: with no in-band pointer to the refine
          // path, the cheapest visible way to change a design is to call generate
          // again, which bills 5 credits and starts a NEW project every time. User
          // 5b0a496d called generate 4x and edit 0x on one brief, spending 20 of 25
          // trial credits on four near-identical projects.
          '2. Use edit-screenshots to refine THIS project (change copy, colours, layout). Prefer it over calling generate again: generate always starts a new project and re-bills.',
          '3. Use render-screenshots to export final PNGs (needs a paid plan; trials can build and iterate but not export)',
          '4. Or open the project URL in a browser to preview and adjust',
          '',
          imageErrors.length ? `Image read warnings:\n${imageErrors.join('\n')}` : '',
          chatData.suggestions?.length
            ? `Suggestions: ${chatData.suggestions.join(', ')}`
            : '',
        ].filter(Boolean).join('\n'),
      }],
    };
  },
);

// Tool 2: edit-screenshots
server.registerTool(
  'edit-screenshots',
  {
    title: 'Edit Screenshot Designs',
    annotations: {
      // Rewrites cards in place, so a bad edit costs the previous design.
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
    description: `Make changes to an existing screenshot project. Use natural language to describe what you want to change. Costs 5 credits per edit. You can also attach images: app screenshots fill the device frames of regenerated cards, a mascot (kind: "mascot") gets placed around the phones, and a background photo (kind: "background") goes behind the cards, one photo as a panorama or several as one per card.

What you can change:
- Text: headlines, subtitles, badge text, font size, font family (Inter, Poppins, Montserrat, DM Sans, Space Grotesk, etc.)
- Text styling: per-word color, bold, italic, underline, highlight pills (colored background behind words), gradient text, text stroke outlines
- Colors: brand palette, gradient backgrounds, accent colors, text colors. A set can rotate MULTIPLE accents card by card ("pink, then coral, then brick") and each card keeps its own highlight colour.
- Background textures (ask for one explicitly, they are never added on their own): diagonal-stripe, crosshatch, checkerboard, zigzag, hairline-grid, dot-grid, waves, grain, radial-rays, concentric-circles. Kept subtle by design so they cannot affect headline contrast. Tiled textures run continuously across the whole set; radial-rays and concentric-circles can be centred on the middle of the set so the pattern fans out across every card.
- Layouts (10 types): text-top-device-bottom, text-top-device-tilted, device-hero, social-proof, review-clip, screen-hero, lifestyle-hero, stats-hero, metric-badge, annotated-feature. The AI picks a narrative arc (HOOK → EDUCATE → PROVE → CONVERT) across the set.
- Layout params: deviceScale (small/medium/large), deviceSide (left/right), textPosition (above/below), textAlign (left/center)
- Device mockups: perspective variants (flat, left-15, right-15, left-30, right-30, isometric, top-down, landscape-left, landscape-right), 2D rotation, resize, reposition
- Frame color: recolor the device frame: "natural" (default), "black", "white", "gold". Examples: "make the iPhone gold", "black titanium finish", "white iPhone". Requires Growth plan or higher.
- Switch devices: "make this for Apple Watch" / "duplicate for Android tablet" clones the project at the target device's canvas size
- Add/remove cards: add a social proof card, remove card 3, add a marketing title card
- Compound fields (auto-positioned): statRow, laurelStat, pressBanner, starRating, quote, credential, guarantee
- Panoramic backgrounds: one wide AI or Pexels image sliced across multiple cards ("pano the background across cards 1-3"). The edit only tags the cards; call generate-panoramic-background afterwards to create and slice the wide image.
- Panoramic element spans: stretch a foreground image, device-mockup, or shape across adjacent cards ("pano the device across cards 1-2")
- Floating elements: add/edit badges, star ratings
- Shapes: glow orbs, waves, blobs, rounded rectangles, circles, custom SVG paths
- Decorative shapes: 77 library shapes: leaf, flower, cloud, sparkle, heart, rocket, trophy, crown, coffee-cup, airplane, dollar-sign, paw-print, wing-left/wing-right (for laurels), and many more
- Backgrounds: solid, subtle-gradient, rich-gradient, photo (Pexels), or ai-generated; change gradient colors/angle; set a backgroundPrompt for AI-generated
- Style: shadows, opacity, border radius, rotation, blur

What isn't supported (the AI will flag these in unsupportedAsks):
- Multiple devices side-by-side in a single card (e.g. iPhone + Watch in one scene). Each card renders one device. Use the duplicate-for-device workflow instead, or split across cards.
- Uploading a specific user-supplied screenshot into a mockup: use upload-screenshots tool first, then reference the uploaded project.

Example edit messages:
- "Make the headlines larger and use Bebas Neue font"
- "Change the color scheme to blue (#2563EB) across all cards"
- "Add a social proof card with 5 stars and a testimonial quote"
- "Tilt the phone on card 2 to the left"
- "Pano the background photo across cards 1-3"
- "Stretch the device on card 1 across into card 2"
- "Make this project for Apple Watch"
- "Recolor the iPhone frame to gold across all cards"
- "Replace card 3 with a CTA card saying Download Free"
- "Switch card 2 to device-hero layout with statRow showing our three key metrics"
- "Add decorative leaf and sparkle shapes scattered in the background"
- "Make 'Every' underlined and italic in the headline"`,
    inputSchema: z.object({
      project_id: z.string().describe('Project ID from a previous generate-screenshots call'),
      message: z.string().describe('What to change, in natural language'),
      card_indices: z.array(z.number().int().min(0)).max(10).optional()
        .describe('Target specific cards by index (0-based). e.g. [0] for card 1, [2,3] for cards 3-4. Max 10 indices. Omit to apply changes to all cards.'),
      codebase_context: z.object({
        readme_summary: z.string().optional(),
        key_screens: z.array(z.string()).max(15).optional(),
        color_tokens: z.record(z.string()).optional(),
        target_audience: z.string().optional(),
        app_category: z.string().optional(),
        competitive_edge: z.string().optional(),
        app_store_description: z.string().optional(),
        tech_stack: z.string().optional(),
        ui_style: z.string().optional(),
        primary_user_flow: z.string().optional(),
      }).optional()
        .describe('App context from codebase research. Helps the AI make edits that match the actual app.'),
      images: chatImagesSchema,
    }),
  },
  async ({ project_id, message, card_indices, codebase_context, images }) => {
    let enrichedMessage = message;
    if (codebase_context) {
      const ctxParts: string[] = [];
      if (codebase_context.readme_summary) ctxParts.push(`App: ${codebase_context.readme_summary}`);
      if (codebase_context.key_screens?.length) ctxParts.push(`Screens: ${codebase_context.key_screens.join(', ')}`);
      if (codebase_context.color_tokens) ctxParts.push(`Colors: ${JSON.stringify(codebase_context.color_tokens)}`);
      if (codebase_context.target_audience) ctxParts.push(`Audience: ${codebase_context.target_audience}`);
      if (codebase_context.ui_style) ctxParts.push(`UI style: ${codebase_context.ui_style}`);
      if (codebase_context.competitive_edge) ctxParts.push(`Unique: ${codebase_context.competitive_edge}`);
      if (ctxParts.length) {
        enrichedMessage = `[App context: ${ctxParts.join('. ')}]\n\n${message}`;
      }
    }

    const { payload: chatImages, errors: imageErrors } = readImagesForChat(images);
    const tooBig = imagesOverBudget(chatImages);
    if (tooBig) {
      return { content: [{ type: 'text' as const, text: tooBig }] };
    }
    const res = await apiCall('POST', `/api/v1/projects/${project_id}/chat`, {
      message: enrichedMessage,
      selected_card_indices: card_indices || [],
      ...(chatImages.length > 0 ? { images: chatImages } : {}),
    });

    if (!res.ok) {
      return {
        content: [{ type: 'text' as const, text: `Edit failed: ${JSON.stringify(res.data)}${imageErrors.length ? `\n\nImage read warnings:\n${imageErrors.join('\n')}` : ''}` }],
      };
    }

    const data = res.data.data as {
      message: string;
      canvas_state: { cards: unknown[] };
      suggestions: string[];
      duplicated_project_id?: string;
    };
    const creditsRemaining = res.data.credits_remaining;
    // A device switch ("make this for iPad") clones the project. All further
    // edits, uploads, and renders must target the NEW project id, not the old one.
    const activeProjectId = data.duplicated_project_id || project_id;

    return {
      content: [{
        type: 'text' as const,
        text: [
          data.message,
          '',
          data.duplicated_project_id
            ? `NEW PROJECT CREATED at the target device size: ${data.duplicated_project_id}\nUse this project_id for all further edits, screenshot uploads, and rendering. The original project (${project_id}) is unchanged.`
            : '',
          `Cards: ${data.canvas_state?.cards?.length || 0}`,
          `Credits remaining: ${creditsRemaining}`,
          `Project URL: ${API_BASE}/builder/${activeProjectId}`,
          '',
          data.suggestions?.length
            ? `Suggestions: ${data.suggestions.join(', ')}`
            : '',
        ].filter(Boolean).join('\n'),
      }],
    };
  },
);

// Tool 3: render-screenshots
server.registerTool(
  'render-screenshots',
  {
    title: 'Render Screenshots to PNG',
    annotations: {
      // Re-rendering the same project state yields the same PNGs.
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description: 'Export a screenshot project to high-resolution PNG files at exact App Store dimensions. Returns download URLs for each card; URLs stay valid for 7 days, so save the PNGs to disk promptly (re-rendering is free if a URL has expired). Costs no credits, but export is unlocked by the first payment: on a trial this returns 402 PAYMENT_REQUIRED, so check the plan before promising a user their PNGs. Pass device_ids to get the same canvas at several device sizes in one call, re-laid-out for each, instead of building a second project: an App Store submission wants the 6.9-inch iPhone and, when the app supports iPad, the 13-inch iPad, and Google Play is a separate listing. Rendering blocks until the PNGs are ready: expect roughly 20-40s per iPhone set and 60-120s per iPad set (the larger canvas renders slower), and those add up per device, so allow up to ~2 minutes each before treating it as failed. Note: device mockups will show empty frames unless app screenshots have been uploaded via upload-screenshots first.',
    inputSchema: z.object({
      project_id: z.string().describe('Project ID to render'),
      device_ids: z
        .array(z.string())
        .min(1)
        .max(4)
        .optional()
        .describe(
          'Optional. Render the same canvas at these device sizes instead of the project device. Each id is a full render, so up to 4. Use list-devices for valid ids.',
        ),
    }),
  },
  async ({ project_id, device_ids }) => {
    const res = await apiCall(
      'POST',
      `/api/v1/projects/${project_id}/render`,
      device_ids?.length ? { device_ids } : undefined,
    );

    if (!res.ok) {
      return {
        content: [{ type: 'text' as const, text: `Render failed: ${JSON.stringify(res.data)}` }],
      };
    }

    const data = res.data.data as {
      images: Array<{ card_index: number; url: string; width: number; height: number; preview?: string; device_id?: string }>;
    };
    const images = data.images || [];
    // With more than one device in the response, "Card 1" appears once per set,
    // so the device has to be on the line or the URLs cannot be told apart.
    const deviceCount = new Set(images.map((img) => img.device_id).filter(Boolean)).size;
    const label = (img: { card_index: number; device_id?: string }, i: number) =>
      deviceCount > 1 && img.device_id
        ? `${img.device_id} card ${(img.card_index ?? i) + 1}`
        : `Card ${i + 1}`;

    // Text block: full-resolution download URLs (for export / saving to disk).
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mimeType: string }
    > = [
      {
        type: 'text' as const,
        text: [
          `Rendered ${images.length} screenshot${images.length === 1 ? '' : 's'}${deviceCount > 1 ? ` across ${deviceCount} device sizes` : ''}:`,
          '',
          ...images.map((img, i) => `${label(img, i)}: ${img.url} (${img.width}×${img.height})`),
          '',
          'Download URLs are valid for 7 days. Save the PNGs to disk now if you',
          'need them long-term (re-rendering later is free).',
          '',
          'Previews are shown below. To compare all cards side by side at full size,',
          'refine by hand, or export, open the project URL in the builder.',
        ].join('\n'),
      },
    ];

    // Image blocks: downscaled inline previews so image-capable agents
    // (Claude Code, Cursor) display the screenshots in-chat. The API returns
    // each preview as a `data:<mime>;base64,<data>` URL; MCP image content
    // needs the raw base64 + mimeType, so split it out.
    for (const img of images) {
      if (!img.preview) continue;
      const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(img.preview);
      if (!match) continue;
      content.push({ type: 'image' as const, mimeType: match[1], data: match[2] });
    }

    return { content };
  },
);

// Tool 4: list-devices
server.registerTool(
  'list-devices',
  {
    title: 'List Supported Devices',
    annotations: {
      // Reads a local constant; makes no API call at all.
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    description: 'Show all supported device specs for App Store and Play Store screenshots. Use the device ID when generating screenshots.',
    inputSchema: z.object({}),
  },
  async () => {
    const lines = DEVICES.map(d =>
      `${d.id}: ${d.name} (${d.width}×${d.height}, ${d.category}${d.required ? ', required for store submission' : ''})`
    );

    return {
      content: [{
        type: 'text' as const,
        text: [
          'Supported devices:',
          '',
          ...lines,
          '',
          'Default: iphone-6.9 (iPhone 16 Pro Max, 1260×2736)',
          'For App Store, you need at least: iphone-6.9 + ipad-13',
        ].join('\n'),
      }],
    };
  },
);

// Tool 5: get-project
server.registerTool(
  'get-project',
  {
    title: 'Get Project Details',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    description: `Retrieve the full state of a screenshot project, including all cards and their elements. Use this to inspect what was generated before making edits. Free: no credit cost.

Returns the canvas state with:
- cards[]: each card has an id, elements array, and optional background settings
- Each element has: type (text, device-mockup, shape, badge, image, star-rating), position (x, y), size (width, height), zIndex, and type-specific properties
- Text elements: fontFamily, fontSize, fontWeight, color, segments (for multi-color text with per-word color, bold, italic, underline, highlightColor)
- Device mockups: perspectiveVariant (flat, left-15, right-15, left-30, right-30, isometric, top-down, landscape-left, landscape-right), screenshotImage (null if no upload), frameStyle (realistic | none), showIsland (false hides the Dynamic Island pill; Apple accepts screenshots either way)
- Shapes: 94 shape types (17 core + 77 decorative across 13 categories): core shapes (circle, rectangle, rounded-rect, blob, wave, triangle, diamond, hexagon, ring, star, wing-left, wing-right, etc.) plus decorative library shapes (leaf, flower, cloud, sparkle, heart, rocket, trophy, crown, coffee-cup, airplane, dollar-sign, paw-print, and many more)
- projectMeta: globalVisualTheme, brandColors, mood, appCategory`,
    inputSchema: z.object({
      project_id: z.string().describe('Project ID to inspect'),
    }),
  },
  async ({ project_id }) => {
    const res = await apiCall('GET', `/api/v1/projects/${project_id}`);

    if (!res.ok) {
      return {
        content: [{ type: 'text' as const, text: `Failed to get project: ${JSON.stringify(res.data)}` }],
      };
    }

    const project = res.data.data as {
      id: string;
      name: string;
      device_id: string;
      canvas_state: {
        cards: Array<{
          id: string;
          elements: Array<{ type: string; id: string; [key: string]: unknown }>;
        }>;
        projectMeta?: unknown;
      };
    };

    // Build a concise summary instead of dumping raw JSON
    const cardSummaries = project.canvas_state?.cards?.map((card, i) => {
      const elementTypes = card.elements.map(el => el.type);
      const typeCounts: Record<string, number> = {};
      for (const t of elementTypes) {
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      }
      const typeStr = Object.entries(typeCounts).map(([t, c]) => `${c} ${t}`).join(', ');
      return `  Card ${i} (${card.id}): ${card.elements.length} elements: ${typeStr}`;
    }) || [];

    return {
      content: [{
        type: 'text' as const,
        text: [
          `Project: ${project.name}`,
          `ID: ${project.id}`,
          `Device: ${project.device_id}`,
          `Cards: ${project.canvas_state?.cards?.length || 0}`,
          '',
          ...cardSummaries,
          '',
          `Project URL: ${API_BASE}/builder/${project.id}`,
          '',
          `Full canvas state:`,
          JSON.stringify(project.canvas_state, null, 2),
        ].join('\n'),
      }],
    };
  },
);

// Tool 6: generate-background
server.registerTool(
  'generate-background',
  {
    title: 'Generate AI Background',
    annotations: {
      // Replaces the card's existing background.
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    description: `Generate an AI background image for a specific card using Gemini. The background is generated based on a text prompt and applied directly to the card. Costs 6 credits.

Good prompts describe mood, lighting, and color, not objects or text:
- "Deep purple nebula with soft pink and blue light rays"
- "Warm sunset gradient with golden bokeh particles"
- "Dark moody atmosphere with teal and emerald glow"
- "Clean minimal white-to-light-gray gradient with subtle noise texture"

The generated image is cropped to exact device dimensions and set as the card's background.`,
    inputSchema: z.object({
      project_id: z.string().describe('Project ID'),
      card_index: z.number().describe('Card index (0-based) to apply the background to'),
      prompt: z.string().describe('Background description: describe mood, lighting, colors, textures. Do NOT include text, devices, or UI elements.'),
    }),
  },
  async ({ project_id, card_index, prompt }) => {
    const res = await apiCall('POST', `/api/v1/projects/${project_id}/generate-background`, {
      card_index,
      prompt,
    });

    if (!res.ok) {
      return {
        content: [{ type: 'text' as const, text: `Background generation failed: ${JSON.stringify(res.data)}` }],
      };
    }

    const creditsRemaining = res.data.credits_remaining;

    return {
      content: [{
        type: 'text' as const,
        text: [
          `AI background generated and applied to card ${card_index + 1}.`,
          `Credits remaining: ${creditsRemaining}`,
          `Project URL: ${API_BASE}/builder/${project_id}`,
        ].join('\n'),
      }],
    };
  },
);

// Tool 7: generate-panoramic-background
server.registerTool(
  'generate-panoramic-background',
  {
    title: 'Generate Panoramic Background',
    annotations: {
      // Replaces the background on every card in the span.
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    description: `Generate one wide background image and slice it across multiple cards so they read as a continuous scene when the App Store gallery scrolls. The store gallery gap is accounted for, so slices line up after Apple's gutter.

Two image sources:
- prompt: AI-generated via Gemini. Costs 6 credits.
- pexels_query: stock landscape photo from Pexels. Free.

If you omit both, the tool fulfills a panoramic the chat already set up: when generate-screenshots or edit-screenshots returns a design with a panoramic background (e.g. after "pano the background across cards 1-3"), the cards are tagged but the wide image isn't created yet. Calling this tool with just the project_id picks up that pending panoramic and generates it.

Good prompts describe a continuous scene, not objects or text:
- "Misty mountain range at dawn, soft pink-to-blue gradient sky"
- "Calm ocean horizon at golden hour with gentle waves"
- "Abstract flowing emerald and teal silk waves"`,
    inputSchema: z.object({
      project_id: z.string().describe('Project ID'),
      prompt: z.string().optional()
        .describe('AI scene description (Gemini, 6 credits). Describe one continuous landscape scene: no text, devices, or UI.'),
      pexels_query: z.string().optional()
        .describe('Stock photo search query (Pexels, free). e.g. "mountain sunrise", "ocean horizon". Provide either this or prompt, not both.'),
      card_indices: z.array(z.number().int().min(0)).max(10).optional()
        .describe('Which cards share the panoramic (0-based, min 2). Default: first 3 cards (the ones visible in the App Store gallery without scrolling).'),
    }),
  },
  async ({ project_id, prompt, pexels_query, card_indices }) => {
    const res = await apiCall('POST', `/api/v1/projects/${project_id}/generate-panoramic-background`, {
      ...(prompt ? { prompt } : {}),
      ...(pexels_query ? { pexels_query } : {}),
      ...(card_indices ? { card_indices } : {}),
    });

    if (!res.ok) {
      return {
        content: [{ type: 'text' as const, text: `Panoramic background generation failed: ${JSON.stringify(res.data)}` }],
      };
    }

    const data = res.data.data as { card_indices: number[]; slices: Array<{ card_index: number; image_url: string }> };
    const creditsRemaining = res.data.credits_remaining;

    return {
      content: [{
        type: 'text' as const,
        text: [
          `Panoramic background generated and sliced across cards ${data.card_indices.map(i => i + 1).join(', ')}.`,
          `Credits remaining: ${creditsRemaining}`,
          `Project URL: ${API_BASE}/builder/${project_id}`,
        ].join('\n'),
      }],
    };
  },
);

// Tool 8: prepare-screenshot-brief
server.registerTool(
  'prepare-screenshot-brief',
  {
    title: 'Prepare Screenshot Brief',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    description: `Get a category playbook and repo-research checklist to prepare for screenshot generation. Call this BEFORE generate-screenshots. Free (no credits).

Pass app_category to get category-specific guidance pulled live from AppScreenshotStudio: the frame-1 hook playbook (default layout, what to avoid, caption patterns), the recommended story_flow and mood, and the exact facts to dig out of THIS app's repo for its category (e.g. security and compliance signals for finance, real gameplay art for games, the outcome for fitness).

Returns:
- A category playbook (frame-1 hooks + layout + arc + mood) for the app_category
- A category-specific repo research focus (what to grep this app for)
- A generic codebase research checklist (file patterns per tech stack)
- Headline tips + the codebase_context schema to fill in

The more you gather here, the better generate-screenshots does on the first try.`,
    inputSchema: z.object({
      app_category: z.string().optional()
        .describe('App category, e.g. fitness, finance, gaming, social, productivity, health, travel, wellness. Drives the category playbook this tool returns; synonyms are normalized server-side.'),
      platform: z.enum(['ios', 'android', 'both']).default('ios')
        .describe('Target platform'),
    }),
  },
  async ({ app_category, platform }) => {
    const checklist = [
      '# Screenshot Brief: Research Checklist',
      '',
      'Search the codebase for each of these before calling generate-screenshots.',
      'The more you find, the better the screenshots will be.',
      '',
      '## 1. App Identity (REQUIRED)',
      '',
      '**Find the app name and description:**',
      '- package.json → "name", "description"',
      '- README.md → first paragraph, badges, tagline',
      '- pubspec.yaml → "name", "description" (Flutter)',
      '- build.gradle / app/build.gradle → applicationId, versionName (Android)',
      '- Info.plist / *.xcodeproj → CFBundleDisplayName (iOS native)',
      '- Cargo.toml → "name", "description" (Rust)',
      '- pyproject.toml / setup.py → name, description (Python)',
      '',
      '**Find the value proposition:**',
      '- Landing page / marketing page components → hero headline, subheadline',
      '- README.md → "Features" or "Why" section',
      '- App Store metadata files (fastlane/metadata/) → description, keywords',
      '',
      '## 2. Features & Screens (REQUIRED)',
      '',
      '**Find the main screens:**',
      '- Route definitions: look for Router, Navigator, routes.ts, app.tsx routing',
      '- Page/screen directories: pages/, screens/, views/, app/ (Next.js)',
      '- Navigation config: tabs, drawer items, bottom nav',
      '',
      '**Find key features:**',
      '- README.md → feature list, bullet points',
      '- Settings/preferences screen → feature toggles reveal capabilities',
      '- Changelog/release notes → recent features',
      '',
      '## 3. Visual Identity (HIGHLY RECOMMENDED)',
      '',
      '**Find brand colors:**',
      '- tailwind.config.* → theme.extend.colors',
      '- theme.ts, colors.ts, tokens.ts → color definitions',
      '- CSS variables: :root { --primary: ... }',
      '- styles/globals.css, variables.css → custom properties',
      '- SwiftUI: Color.accentColor, Asset catalog colors',
      '- Flutter: ThemeData, ColorScheme',
      '- Android: colors.xml, themes.xml',
      '',
      '**Find fonts:**',
      '- Font imports in layout/root files',
      '- Google Fonts imports, @font-face declarations',
      '- Typography config in theme files',
      '',
      '**Observe UI style:**',
      '- Dark mode / light mode support?',
      '- Design system: shadcn/ui, Material, Cupertino, custom?',
      '- Dense or spacious layout?',
      '- Rounded or sharp corners?',
      '',
      '## 4. Market Context (NICE TO HAVE)',
      '',
      '- Target audience mentions in docs, README, marketing copy',
      '- Competitor references in code comments or docs',
      '- Analytics/tracking events → reveal most-used features',
      '- Testimonials or reviews referenced in code',
      '- Social proof data (user counts, ratings)',
      '',
      '## 5. User Flow (NICE TO HAVE)',
      '',
      '- Onboarding screens → what the app teaches users first',
      '- Auth flow → sign up with email, social, magic link?',
      '- Main navigation → what users do most',
      '- Key interactions → what makes the app satisfying to use',
    ];

    // Category playbook: pulled live from the app so improvements reach the
    // agent without an npm republish. Falls back silently to the generic
    // checklist below if the endpoint is unreachable.
    type Playbook = {
      matched: string;
      depth: string;
      label: string;
      arc: string;
      mood: string;
      researchFocus: string[];
      frame1?: {
        defaultLayout: string;
        avoidLayouts: string[];
        rationale: string;
        hooks: Array<{ name: string; shows: string; fits: string; layout: string; captionPattern: string }>;
      };
      patternsToAvoid?: string[];
      highlights?: string[];
    };

    let playbook: Playbook | null = null;
    try {
      const res = await fetch(`${API_BASE}/api/v1/playbook?category=${encodeURIComponent(app_category ?? '')}`);
      if (res.ok) {
        const json = (await res.json()) as { data?: Playbook };
        if (json?.data) playbook = json.data;
      }
    } catch {
      // offline or endpoint unavailable: the generic checklist still stands
    }

    const categoryBlock: string[] = [];
    if (playbook && playbook.depth !== 'general') {
      categoryBlock.push(
        `# Category Playbook: ${playbook.label}`,
        '',
        `Recommended \`story_flow\`: \`${playbook.arc}\`  |  \`mood\`: \`${playbook.mood}\``,
        '',
        '## Research this app for its category',
        `These are what a ${playbook.label.toLowerCase()} frame 1 lives or dies on. Dig them out of the repo before generating:`,
        ...playbook.researchFocus.map((r) => `- ${r}`),
        '',
      );
      if (playbook.frame1) {
        categoryBlock.push(
          '## Frame 1 (the hook) for this category',
          `Default layout: \`${playbook.frame1.defaultLayout}\`. Avoid: ${playbook.frame1.avoidLayouts.map((l) => `\`${l}\``).join(', ')}.`,
          `Why: ${playbook.frame1.rationale}`,
          '',
          'Pick the hook that fits the app, then write the headline from its caption pattern:',
          ...playbook.frame1.hooks.map((h) => `- **${h.name}** (${h.layout}): ${h.shows}. Caption: ${h.captionPattern}`),
          '',
        );
      }
      if (playbook.patternsToAvoid && playbook.patternsToAvoid.length) {
        categoryBlock.push('## Avoid for this category', ...playbook.patternsToAvoid.map((p) => `- ${p}`), '');
      }
      if (playbook.highlights && playbook.highlights.length) {
        categoryBlock.push(`Highlights worth surfacing: ${playbook.highlights.join(', ')}.`, '');
      }
      categoryBlock.push('---', '');
    }

    // Headline tips
    const headlineTips = [
      '',
      '---',
      '',
      '# Screenshot Headline Tips',
      '',
      '- Lead with USER BENEFIT, not feature name: "Never forget a task" > "Task Management"',
      '- Use power words: Track, Save, Build, Discover, Master, Simplify, Automate',
      '- Include numbers when possible: "3x faster", "10K+ recipes", "Save 2hrs/week"',
      '- First 3 screenshots matter most: App Store shows them in search results',
      '- Hero card headline = your one-sentence pitch. Make it count.',
      '- Keep headlines under 6 words. Subtitle can add detail.',
    ];

    // Device recommendations
    const deviceTips = [
      '',
      '---',
      '',
      '# Device Recommendations',
      '',
    ];
    if (platform === 'ios' || platform === 'both') {
      deviceTips.push('**iOS (required for App Store):**');
      deviceTips.push('- iPhone 16 Pro Max (iphone-6.9): 1260×2736: REQUIRED');
      deviceTips.push('- iPad Pro 13" (ipad-13): 2064×2752: REQUIRED');
      deviceTips.push('');
    }
    if (platform === 'android' || platform === 'both') {
      deviceTips.push('**Android (required for Play Store):**');
      deviceTips.push('- Android Phone (android-phone): 1080×2340: REQUIRED');
      deviceTips.push('- Android Tablet 7" (android-tablet-10): 1200×1920: REQUIRED');
      deviceTips.push('- Android Tablet 10" (android-tablet-large): 1600×2560: second large-screen slot');
      deviceTips.push('');
    }

    // Schema reminder
    const schemaReminder = [
      '',
      '---',
      '',
      '# Next Step',
      '',
      'After researching, call `generate-screenshots` with your findings in the `codebase_context` parameter:',
      '```json',
      '{',
      '  "app_name": "...",',
      '  "app_description": "...",',
      '  "features": ["...", "..."],',
      '  "brand_colors": { "primary": "#...", "secondary": "#..." },',
      '  "mood": "...",',
      '  "story_flow": "...",',
      '  "count": 5,',
      '  "codebase_context": {',
      '    "readme_summary": "...",',
      '    "key_screens": ["Dashboard", "Settings", "Profile", "..."],',
      '    "color_tokens": { "primary": "#...", "background": "#..." },',
      '    "target_audience": "...",',
      '    "app_category": "...",',
      '    "competitive_edge": "...",',
      '    "ui_style": "...",',
      '    "primary_user_flow": "Sign up → ... → ..."',
      '  }',
      '}',
      '```',
    ];

    return {
      content: [{
        type: 'text' as const,
        text: [...categoryBlock, ...checklist, ...headlineTips, ...deviceTips, ...schemaReminder].join('\n'),
      }],
    };
  },
);


// Tool 9: upload-screenshots
server.registerTool(
  'upload-screenshots',
  {
    title: 'Upload App Screenshots',
    annotations: {
      // Overwrites whatever image the device frames already held.
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
    description: `Upload local app screenshots (from Simulator, emulator, or screen captures) into the device mockups of an existing project. This lets you add real app UI into the device frames without leaving the terminal.

Reads files from your local filesystem, converts them to base64, and sets them on the device mockup elements in the specified cards.

Free: no credit cost. The screenshots are placed into the device frames that were created by generate-screenshots.

Workflow:
1. generate-screenshots → creates project with empty device frames
2. upload-screenshots → fills the device frames with your actual app UI
3. render-screenshots → exports final PNGs at App Store dimensions

Tips:
- Take screenshots from the iOS Simulator (Cmd+S) or Android emulator
- Use PNG format for best quality
- Screenshots are automatically fitted into the device frame
- You can upload different screenshots to different cards`,
    inputSchema: z.object({
      project_id: z.string().describe('Project ID from a previous generate-screenshots call'),
      screenshots: z.array(z.object({
        file_path: z.string().describe('Absolute path to a screenshot file on the local filesystem (PNG, JPG, or WEBP)'),
        card_index: z.number().int().min(0).describe('Which card to place this screenshot on (0-based)'),
      })).min(1).max(10)
        .describe('Array of screenshots to upload, each mapped to a specific card index'),
    }),
  },
  async ({ project_id, screenshots }) => {
    // Read local files and convert to base64
    const screenshotData: Array<{ card_index: number; image_base64: string }> = [];
    const errors: string[] = [];

    for (const { file_path, card_index } of screenshots) {
      try {
        if (!existsSync(file_path)) {
          errors.push(`File not found: ${file_path}`);
          continue;
        }

        const buffer = readFileSync(file_path);
        const ext = file_path.toLowerCase().split('.').pop();
        const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : ext === 'webp' ? 'image/webp'
          : 'image/png';

        const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
        screenshotData.push({ card_index, image_base64: base64 });
      } catch (err) {
        errors.push(`Failed to read ${file_path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (screenshotData.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: `No screenshots could be read.\n\nErrors:\n${errors.join('\n')}`,
        }],
      };
    }

    // Upload to API
    const res = await apiCall('POST', `/api/v1/projects/${project_id}/upload-screenshots`, {
      screenshots: screenshotData,
    });

    if (!res.ok) {
      return {
        content: [{
          type: 'text' as const,
          text: `Upload failed: ${JSON.stringify(res.data)}${errors.length ? `\n\nFile read errors:\n${errors.join('\n')}` : ''}`,
        }],
      };
    }

    const data = res.data.data as { uploaded: number; results: Array<{ card_index: number; success: boolean; error?: string }> };

    const lines = [
      `Uploaded ${data.uploaded} screenshot${data.uploaded !== 1 ? 's' : ''} into device mockups.`,
      '',
    ];

    for (const r of data.results) {
      lines.push(`  Card ${r.card_index + 1}: ${r.success ? 'OK' : r.error}`);
    }

    if (errors.length) {
      lines.push('', 'File read warnings:', ...errors.map(e => `  ${e}`));
    }

    lines.push(
      '',
      `Project URL: ${API_BASE}/builder/${project_id}`,
      '',
      'Next steps:',
      '- Use render-screenshots to export final PNGs (needs a paid plan; trials can build and iterate but not export)',
      '- Use edit-screenshots to adjust the design',
      '- Open the project URL to preview in the browser',
    );

    return {
      content: [{
        type: 'text' as const,
        text: lines.join('\n'),
      }],
    };
  },
);

// ─── Start server ───────────────────────────────────────────────────────────────

function autoInstallSkill() {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const src = join(__dir, '..', 'skills', 'appscreenshotstudio', 'SKILL.md');
    const destDir = join(homedir(), '.claude', 'skills', 'appscreenshotstudio');
    const dest = join(destDir, 'SKILL.md');

    if (!existsSync(src)) return;

    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, dest);
  } catch {
    // Silent fail: skill install is optional
  }
}

async function main() {
  if (!API_KEY) {
    console.error('Warning: APPSCREENSHOTSTUDIO_API_KEY not set. Tools will fail until it is configured.');
  }

  autoInstallSkill();

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
