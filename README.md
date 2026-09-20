# Medicare POC — headless frontend on Optimizely CMS + Optimizely Graph

A Next.js (App Router) marketing site whose **header, footer and site-wide copy are rendered from an
Optimizely CMS global settings content item** delivered through Optimizely Graph.

The global settings item is addressed by its content key:

```dotenv
OPTIMIZELY_GLOBAL_CONFIG_ID="41def1d7-5c9e-468a-bd4f-4062e307566b"
```

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill in the values below
npm run dev
```

| Variable | Purpose |
| --- | --- |
| `OPTIMIZELY_API_URL` | GraphQL endpoint, e.g. `https://cg.optimizely.com/content/v2` |
| `OPTIMIZELY_SINGLE_KEY` | Published-content key — **CMS → Settings → API Keys → Single key** |
| `OPTIMIZELY_GLOBAL_CONFIG_ID` | Content key (GUID) of the global settings item |
| `OPTIMIZELY_PREVIEW_SECRET` | `Base64(AppKey:AppSecret)`, only for draft/preview content |
| `OPTIMIZELY_OFFLINE` | `1` = never call Graph, render from `.cms-cache/` only |
| `NEXT_PUBLIC_SITE_URL` | Absolute site URL used for canonical/OG metadata |

Open <http://localhost:3000> — the hero, header and footer are CMS content, and the
**“Global settings — every property in Optimizely Graph”** panel lists every property that came back,
so you can see exactly what the CMS delivered.

---

## How the global settings are loaded

`lib/optimizely/global-config.ts` orchestrates four steps, none of which hard-code the content model:

1. **Resolve the content item** — the key from `OPTIMIZELY_GLOBAL_CONFIG_ID` is looked up in Graph
   (`_Content(where: { _metadata: { key: { eq: … } } })`). Graph stores keys as 32 hex characters without
   dashes, so the dashed form copied from the CMS is normalised and both forms are tried.
2. **Discover the content type** — `_metadata.types` tells us the concrete type (e.g. `GlobalConfigDefault`),
   so no type name needs to be configured.
3. **Introspect the schema and generate the query** — `lib/optimizely/schema.ts` reads the Graph schema and
   builds the selection set for that type (recursively, skipping fields that need arguments, deprecated
   fields and interface/union fields). *Add a property in the CMS and it appears in the query and on the
   page without a code change.*
4. **Normalise the values** — `lib/optimizely/normalize.ts` turns whatever shape each property has
   (string, `XhtmlString`, `ContentReference`, `LinkItem`, content area of blocks…) into the
   `SiteSettings` model used by the header, footer and page.

### Mapping CMS properties to the UI

Property names are matched heuristically (`siteName`, `logo`, `navigation`, `copyrightText`, `socialLinks`,
`footerColumns`, `ctaText`/`ctaHref`, `contactEmail`, …). Pin your own names in
`lib/optimizely/field-map.ts` — explicit overrides always win:

```ts
export const fieldOverrides: Record<string, string> = {
  headerLogo: 'logo',
  footerLegalText: 'copyright',
}
```

---

## Rendering from an environment without network access (browser bridge)

Some runtimes (sandboxes, firewalled CI) cannot reach `cg.optimizely.com`. The app never breaks in that
case — every query follows this order:

1. **live** request to Optimizely Graph,
2. the **last captured response** in `.cms-cache/` (so pages keep rendering),
3. the query is **queued** for the browser bridge and the UI shows a sample payload labelled as such.

Open **`/cms-bridge`** from a browser that can reach Optimizely Graph: it replays the queued queries
(using your single key — typed in the page or taken from `OPTIMIZELY_SINGLE_KEY`), stores the responses in
`.cms-cache/`, and the site then renders real CMS content. There is also a manual mode: copy a query, run
it anywhere (GraphiQL, `curl`), paste the JSON back.

The bridge is a development tool and returns 404 in production unless `OPTIMIZELY_ENABLE_CMS_BRIDGE=1`.

---

## Project layout

```
app/
  layout.tsx                 header/footer + metadata built from the global settings
  page.tsx                   home page + CMS inspector panel
  cms-bridge/page.tsx        browser bridge UI
  api/cms-bridge/route.ts    queue + capture API for the bridge
components/
  site-header.tsx            logo, navigation, CTA, phone — all CMS driven
  site-footer.tsx            footer columns, contact, legal, copyright — CMS driven
  global-settings-panel.tsx  raw Graph payload explorer (property names, kinds, values)
  cms-source-card.tsx        explains live/captured/sample source, lets you pin a content item
lib/optimizely/
  config.ts                  env configuration, key candidates, endpoint building
  client.ts                  GraphQL client: live → cache → bridge queue
  schema.ts                  introspection, content-type discovery, query generation
  global-config.ts           getGlobalSettings() → SiteSettings
  normalize.ts               value normalisation + heuristic field mapping
  field-map.ts               explicit CMS property → settings field overrides
  store.ts                   .cms-cache/ (captured responses, queued queries, state)
  fixture.ts                 built-in sample payload (clearly labelled in the UI)
```

## Scripts

```bash
npm run dev      # development server
npm run build    # production build
npm run start    # production server
npm run lint     # eslint
```
