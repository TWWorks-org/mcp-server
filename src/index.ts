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
// ⚠️ Keep in sync: lib/device-specs.ts, mcp-server/README.md, docs/api page, docs/mcp page

const DEVICES = [
  { id: 'iphone-6.9', name: 'iPhone 16 Pro Max', width: 1260, height: 2736, category: 'iphone', required: true },
  { id: 'iphone-6.3', name: 'iPhone 17 Pro', width: 1206, height: 2622, category: 'iphone', required: false },
  { id: 'ipad-13', name: 'iPad Pro 13"', width: 2064, height: 2752, category: 'ipad', required: true },
  { id: 'android-phone', name: 'Android Phone', width: 1080, height: 2340, category: 'android-phone', required: true },
  { id: 'android-tablet-10', name: 'Android Tablet 7"', width: 1200, height: 1920, category: 'android-tablet', required: true },
  { id: 'apple-watch-ultra', name: 'Apple Watch Ultra 2', width: 410, height: 502, category: 'apple-watch', required: true },
] as const;

const VALID_DEVICE_IDS = DEVICES.map(d => d.id);

// Aliases callers commonly pass instead of the canonical id: display-name
// derivations ("iPhone 16 Pro Max" -> iphone-16-pro-max) and legacy slugs.
// Mirrors MARKETING_TO_SPEC in lib/device-specs.ts — keep the two in sync.
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

function buildDesignMessage(input: GenerateInput): string {
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

  parts.push(`\nAll device mockups should have screenshotImage: null — the developer will upload actual app screenshots later.`);
  parts.push(`Please include projectMeta with brand colors, mood, appCategory, and a rich globalVisualTheme description.`);

  return parts.join('\n');
}

// ─── MCP Server ─────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'appscreenshotstudio',
  version: '0.4.4',
});

// Tool 1: generate-screenshots
server.registerTool(
  'generate-screenshots',
  {
    title: 'Generate App Store Screenshots',
    description: `Create a complete set of App Store screenshot designs for an app. Returns a project URL where the developer can upload actual app screenshots into the device frames and export final PNGs.

IMPORTANT: Before calling this tool, research the user's codebase to populate the codebase_context parameter. Search for: package.json/README (app name & description), theme/color config files (brand colors), route definitions (key screens), marketing copy (value proposition), and App Store metadata. The more context you provide, the better the screenshots will be. Call prepare-screenshot-brief first if you need a research checklist.

The AI picks a narrative arc that fits the app's sell angle (trust-first for finance/health, visual-first for creative/lifestyle, problem-first for pain-relief apps, numbers-led for SaaS/analytics, community-first for social, feature-forward for multi-mode apps) and assigns a job to each card: HOOK → EDUCATE → PROVE → CONVERT.

13 layout types available per card:
- text-top-device-bottom: headline top, flat device bottom (feature/educate)
- text-top-device-tilted: headline left, tilted device right (or mirrored)
- device-hero: headline + large centered device, product-forward
- social-proof: stars + quote + laurel stat, no device (testimonial-led)
- review-clip: rating-statement headline + stars + quote + bottom-clipped device
- screen-hero: top-clipped device + centered headline + optional trust stat
- lifestyle-hero: full-bleed photo background + text overlay (no device)
- feature-grid: headline + 2×2 or 2×3 icon+label grid, no device
- before-after: dark before-half + bright after-half (transformation apps)
- stats-hero: giant centered stat(s), no device, numbers-led
- metric-badge: centered device + chunky "achievement card" floating over its screen
- annotated-feature: tilted device + side callout chip linked by a connector line
- step-flow: headline + 2-4 numbered step rows ("how it works"), no device

Each card can carry auto-positioned compound fields: statRow, laurelStat, pressBanner, starRating, quote, featureGrid, beforeAfterSplit, stepList.

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
      app_description: z.string().describe('What the app does — 1-3 sentences'),
      features: z.array(z.string()).max(10).optional()
        .describe('Key features in order of importance. The first 2-3 will be highlighted most prominently.'),
      brand_colors: z.object({
        primary: z.string().describe('Primary brand color as hex (e.g. #7C3AED)'),
        secondary: z.string().optional().describe('Secondary color as hex'),
        accent: z.string().optional().describe('Accent color as hex'),
      }).optional().describe('Brand colors to use in the design'),
      mood: z.string().optional()
        .describe('Design mood — e.g. "energetic", "calm", "minimal", "bold", "professional", "playful"'),
      device_id: z.string().default('iphone-6.9')
        .describe(`Target device. Options: ${VALID_DEVICE_IDS.join(', ')}. Default: iphone-6.9 (iPhone 16 Pro Max)`),
      count: z.number().min(3).max(10).default(5)
        .describe('Number of screenshot cards to generate (3-10). Default: 5'),
      story_flow: z.enum(['auto', 'standard', 'problem-solution', 'social-proof', 'benefit-first', 'journey', 'hero-intro', 'social-proof-bookend']).default('auto')
        .describe('Narrative structure for the screenshots. "auto" lets the AI choose the best flow.'),
      codebase_context: z.object({
        readme_summary: z.string().optional()
          .describe('Summary of the app from README or docs — what does it do and why?'),
        key_screens: z.array(z.string()).max(15).optional()
          .describe('Main screens/views in the app — e.g. "Dashboard with activity feed", "Settings with theme toggle"'),
        color_tokens: z.record(z.string()).optional()
          .describe('Brand/theme colors found in code — e.g. {"primary": "#7C3AED", "background": "#0F172A"}'),
        target_audience: z.string().optional()
          .describe('Who the app is for — e.g. "busy professionals who want to track habits"'),
        app_category: z.string().optional()
          .describe('App category — e.g. fitness, finance, social, productivity, food, travel, health, education'),
        competitive_edge: z.string().optional()
          .describe('What makes this app unique vs competitors'),
        app_store_description: z.string().optional()
          .describe('Existing App Store/Play Store description if found in the codebase'),
        tech_stack: z.string().optional()
          .describe('Tech stack — e.g. "React Native", "SwiftUI", "Flutter". Useful for developer-tool apps.'),
        ui_style: z.string().optional()
          .describe('UI style observations — e.g. "dark mode with neon accents", "clean minimal with lots of whitespace"'),
        primary_user_flow: z.string().optional()
          .describe('The main user journey — e.g. "Sign up → Create project → Invite team → Track progress"'),
      }).optional()
        .describe('Context gathered from researching the app codebase. Dramatically improves screenshot quality — the more detail here, the better the output.'),
    }),
  },
  async (input) => {
    // Resolve/validate the device up front so an unknown id fails fast here
    // instead of after a project (and its 5 generation credits) is spent.
    const resolved = resolveDeviceId(input.device_id);
    if ('error' in resolved) {
      return { content: [{ type: 'text' as const, text: resolved.error }] };
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

    // Step 2: Chat to generate all cards
    const message = buildDesignMessage(input);
    const chatRes = await apiCall('POST', `/api/v1/projects/${projectId}/chat`, {
      message,
      selected_card_indices: [],
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
          '1. Use upload-screenshots to add your app screenshots into the device frames',
          '2. Use render-screenshots to export final PNGs',
          '3. Or open the project URL in a browser to preview and adjust',
          '',
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
    description: `Make changes to an existing screenshot project. Use natural language to describe what you want to change. Costs 5 credits per edit.

What you can change:
- Text: headlines, subtitles, badge text, font size, font family (Inter, Poppins, Montserrat, DM Sans, Space Grotesk, etc.)
- Text styling: per-word color, bold, italic, underline, highlight pills (colored background behind words), gradient text, text stroke outlines
- Colors: brand palette, gradient backgrounds, accent colors, text colors
- Layouts (13 types): text-top-device-bottom, text-top-device-tilted, device-hero, social-proof, review-clip, screen-hero, lifestyle-hero, feature-grid, before-after, stats-hero, metric-badge, annotated-feature, step-flow. The AI picks a narrative arc (HOOK → EDUCATE → PROVE → CONVERT) across the set.
- Layout params: deviceScale (small/medium/large), deviceSide (left/right), textPosition (above/below), textAlign (left/center)
- Device mockups: perspective variants (flat, left-15, right-15, left-30, right-30, isometric, top-down, landscape-left, landscape-right), 2D rotation, resize, reposition
- Frame color: recolor the device frame — "natural" (default), "black", "white", "gold". Examples: "make the iPhone gold", "black titanium finish", "white iPhone". Requires Growth plan or higher.
- Switch devices: "make this for Apple Watch" / "duplicate for Android tablet" clones the project at the target device's canvas size
- Add/remove cards: add a social proof card, remove card 3, add a marketing title card
- Compound fields (auto-positioned): statRow, laurelStat, pressBanner, starRating, quote, featureGrid, beforeAfterSplit
- Panoramic backgrounds: one wide AI or Pexels image sliced across multiple cards ("pano the background across cards 1-3"). The edit only tags the cards; call generate-panoramic-background afterwards to create and slice the wide image.
- Panoramic element spans: stretch a foreground image, device-mockup, or shape across adjacent cards ("pano the device across cards 1-2")
- Floating elements: add/edit badges, star ratings
- Shapes: glow orbs, waves, blobs, rounded rectangles, circles, custom SVG paths
- Decorative shapes: 77 library shapes — leaf, flower, cloud, sparkle, heart, rocket, trophy, crown, coffee-cup, airplane, dollar-sign, paw-print, wing-left/wing-right (for laurels), and many more
- Backgrounds: solid, subtle-gradient, rich-gradient, photo (Pexels), or ai-generated; change gradient colors/angle; set a backgroundPrompt for AI-generated
- Style: shadows, opacity, border radius, rotation, blur

What isn't supported (the AI will flag these in unsupportedAsks):
- Multiple devices side-by-side in a single card (e.g. iPhone + Watch in one scene) — each card renders one device. Use the duplicate-for-device workflow instead, or split across cards.
- Uploading a specific user-supplied screenshot into a mockup — use upload-screenshots tool first, then reference the uploaded project.

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
- "Add a before-after card showing the transformation"
- "Add decorative leaf and sparkle shapes scattered in the background"
- "Make 'Every' underlined and italic in the headline"`,
    inputSchema: z.object({
      project_id: z.string().describe('Project ID from a previous generate-screenshots call'),
      message: z.string().describe('What to change — use natural language'),
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
    }),
  },
  async ({ project_id, message, card_indices, codebase_context }) => {
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

    const res = await apiCall('POST', `/api/v1/projects/${project_id}/chat`, {
      message: enrichedMessage,
      selected_card_indices: card_indices || [],
    });

    if (!res.ok) {
      return {
        content: [{ type: 'text' as const, text: `Edit failed: ${JSON.stringify(res.data)}` }],
      };
    }

    const data = res.data.data as {
      message: string;
      canvas_state: { cards: unknown[] };
      suggestions: string[];
    };
    const creditsRemaining = res.data.credits_remaining;

    return {
      content: [{
        type: 'text' as const,
        text: [
          data.message,
          '',
          `Cards: ${data.canvas_state?.cards?.length || 0}`,
          `Credits remaining: ${creditsRemaining}`,
          `Project URL: ${API_BASE}/builder/${project_id}`,
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
    description: 'Export a screenshot project to high-resolution PNG files at exact App Store dimensions. Returns download URLs for each card. Free (no credit cost). Rendering blocks until the PNGs are ready: expect roughly 20-40s for iPhone sets and 60-120s for iPad (the larger canvas renders slower), so allow up to ~2 minutes before treating it as failed. Note: device mockups will show empty frames unless app screenshots have been uploaded via upload-screenshots first.',
    inputSchema: z.object({
      project_id: z.string().describe('Project ID to render'),
    }),
  },
  async ({ project_id }) => {
    const res = await apiCall('POST', `/api/v1/projects/${project_id}/render`);

    if (!res.ok) {
      return {
        content: [{ type: 'text' as const, text: `Render failed: ${JSON.stringify(res.data)}` }],
      };
    }

    const data = res.data.data as {
      images: Array<{ card_index: number; url: string; width: number; height: number; preview?: string }>;
    };
    const images = data.images || [];

    // Text block: full-resolution download URLs (for export / saving to disk).
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mimeType: string }
    > = [
      {
        type: 'text' as const,
        text: [
          `Rendered ${images.length} screenshot${images.length === 1 ? '' : 's'}:`,
          '',
          ...images.map((img, i) => `Card ${i + 1}: ${img.url} (${img.width}×${img.height})`),
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
    description: 'Show all supported device specs for App Store and Play Store screenshots. Use the device ID when generating screenshots.',
    inputSchema: z.object({}),
  },
  async () => {
    const lines = DEVICES.map(d =>
      `${d.id} — ${d.name} (${d.width}×${d.height}, ${d.category}${d.required ? ', required for store submission' : ''})`
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
    description: `Retrieve the full state of a screenshot project, including all cards and their elements. Use this to inspect what was generated before making edits. Free — no credit cost.

Returns the canvas state with:
- cards[]: each card has an id, elements array, and optional background settings
- Each element has: type (text, device-mockup, shape, badge, image, star-rating), position (x, y), size (width, height), zIndex, and type-specific properties
- Text elements: fontFamily, fontSize, fontWeight, color, segments (for multi-color text with per-word color, bold, italic, underline, highlightColor)
- Device mockups: perspectiveVariant (flat, left-15, right-15, left-30, right-30, isometric, top-down, landscape-left, landscape-right), screenshotImage (null if no upload)
- Shapes: 94 shape types (17 core + 77 decorative across 13 categories) — core shapes (circle, rectangle, rounded-rect, blob, wave, triangle, diamond, hexagon, ring, star, wing-left, wing-right, etc.) plus decorative library shapes (leaf, flower, cloud, sparkle, heart, rocket, trophy, crown, coffee-cup, airplane, dollar-sign, paw-print, and many more)
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
      return `  Card ${i} (${card.id}): ${card.elements.length} elements — ${typeStr}`;
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
    description: `Generate an AI background image for a specific card using Gemini. The background is generated based on a text prompt and applied directly to the card. Costs 6 credits.

Good prompts describe mood, lighting, and color — not objects or text:
- "Deep purple nebula with soft pink and blue light rays"
- "Warm sunset gradient with golden bokeh particles"
- "Dark moody atmosphere with teal and emerald glow"
- "Clean minimal white-to-light-gray gradient with subtle noise texture"

The generated image is cropped to exact device dimensions and set as the card's background.`,
    inputSchema: z.object({
      project_id: z.string().describe('Project ID'),
      card_index: z.number().describe('Card index (0-based) to apply the background to'),
      prompt: z.string().describe('Background description — describe mood, lighting, colors, textures. Do NOT include text, devices, or UI elements.'),
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
    description: `Get a research checklist and strategy guide to prepare for screenshot generation. Call this BEFORE generate-screenshots to know what to look for in the codebase. Free — no API call or credits needed.

Returns:
- A codebase research checklist (file patterns to search for each tech stack)
- Story flow recommendations by app category
- Tips for writing compelling screenshot headlines
- The codebase_context schema to fill in

This tool helps you gather the right information so generate-screenshots produces the best possible output on the first try.`,
    inputSchema: z.object({
      app_category: z.string().optional()
        .describe('App category if known — e.g. fitness, finance, social, productivity, developer-tools'),
      platform: z.enum(['ios', 'android', 'both']).default('ios')
        .describe('Target platform'),
    }),
  },
  async ({ app_category, platform }) => {
    const checklist = [
      '# Screenshot Brief — Research Checklist',
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

    // Story flow recommendations
    const storyFlows = [
      '',
      '---',
      '',
      '# Story Flow Recommendations',
      '',
    ];

    const categoryRecommendations: Record<string, string[]> = {
      'fitness': [
        '**Fitness apps → `journey` or `benefit-first`**',
        '- Lead with transformation: "Before → After" or "Track → Improve → Achieve"',
        '- Highlight: workout tracking, progress charts, streaks, community challenges',
        '- Mood: energetic or bold',
      ],
      'finance': [
        '**Finance apps → `benefit-first` or `problem-solution`**',
        '- Lead with outcomes: "Save $X/month" or "See all accounts in one place"',
        '- Highlight: dashboards, charts, budgets, alerts, security',
        '- Mood: professional or calm',
      ],
      'social': [
        '**Social apps → `social-proof-bookend` or `hero-intro`**',
        '- Lead with community: "Join 1M+ users" or show vibrant UI',
        '- Highlight: feed, messaging, profiles, discovery, sharing',
        '- Mood: playful or energetic',
      ],
      'productivity': [
        '**Productivity apps → `problem-solution` or `standard`**',
        '- Lead with pain point: "Stop juggling 5 apps" → "One place for everything"',
        '- Highlight: task management, collaboration, integrations, speed',
        '- Mood: minimal or professional',
      ],
      'food': [
        '**Food/recipe apps → `hero-intro` or `journey`**',
        '- Lead with beautiful imagery or the discovery experience',
        '- Highlight: recipe browsing, meal planning, grocery lists, cooking mode',
        '- Mood: warm or playful',
      ],
      'travel': [
        '**Travel apps → `journey` or `hero-intro`**',
        '- Lead with destination discovery or trip planning flow',
        '- Highlight: search, booking, itinerary, maps, offline access',
        '- Mood: energetic or calm',
      ],
      'health': [
        '**Health/wellness apps → `benefit-first` or `journey`**',
        '- Lead with outcomes: "Sleep better", "Feel calmer", "Know your body"',
        '- Highlight: tracking, insights, reminders, progress, professional guidance',
        '- Mood: calm or professional',
      ],
      'education': [
        '**Education apps → `journey` or `hero-intro`**',
        '- Lead with learning progression or "learn anything" hero',
        '- Highlight: courses, progress tracking, quizzes, certificates, offline',
        '- Mood: playful or professional',
      ],
      'developer-tools': [
        '**Developer tools → `problem-solution` or `benefit-first`**',
        '- Lead with workflow pain: "Stop copy-pasting" → "One command and done"',
        '- Highlight: CLI, integrations, speed, DX, code examples',
        '- Mood: minimal or bold',
      ],
      'shopping': [
        '**Shopping/e-commerce → `social-proof-bookend` or `benefit-first`**',
        '- Lead with deals or trust: "Trusted by 500K+ shoppers"',
        '- Highlight: discovery, search, wishlists, checkout, tracking',
        '- Mood: bold or energetic',
      ],
    };

    if (app_category && categoryRecommendations[app_category]) {
      storyFlows.push(...categoryRecommendations[app_category]);
    } else {
      storyFlows.push('**General recommendations by app type:**', '');
      for (const [, lines] of Object.entries(categoryRecommendations)) {
        storyFlows.push(...lines, '');
      }
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
      '- First 3 screenshots matter most — App Store shows them in search results',
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
      deviceTips.push('- iPhone 16 Pro Max (iphone-6.9): 1260×2736 — REQUIRED');
      deviceTips.push('- iPad Pro 13" (ipad-13): 2064×2752 — REQUIRED');
      deviceTips.push('');
    }
    if (platform === 'android' || platform === 'both') {
      deviceTips.push('**Android (required for Play Store):**');
      deviceTips.push('- Android Phone (android-phone): 1080×2340 — REQUIRED');
      deviceTips.push('- Android Tablet 7" (android-tablet-10): 1200×1920 — optional');
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
        text: [...checklist, ...storyFlows, ...headlineTips, ...deviceTips, ...schemaReminder].join('\n'),
      }],
    };
  },
);


// Tool 9: upload-screenshots
server.registerTool(
  'upload-screenshots',
  {
    title: 'Upload App Screenshots',
    description: `Upload local app screenshots (from Simulator, emulator, or screen captures) into the device mockups of an existing project. This lets you add real app UI into the device frames without leaving the terminal.

Reads files from your local filesystem, converts them to base64, and sets them on the device mockup elements in the specified cards.

Free — no credit cost. The screenshots are placed into the device frames that were created by generate-screenshots.

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
      '- Use render-screenshots to export final PNGs',
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
    // Silent fail — skill install is optional
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
