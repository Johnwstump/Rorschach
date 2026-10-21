# Rorshach

A review station. You hand it a queue of things to look at (web pages, images, saved
snapshots) and a question to answer about each one. It shows each item in a browser
pane, scrolls to the part that matters, and puts your answer buttons beside it. Answers
go to a JSON file as you work.

It was built for a chore that kept coming up: an automated check flags 150 things,
and a person has to look at each one and say "real problem" or "not a problem". Doing
that with a spreadsheet and a browser tab means copying URLs, hunting for the right
row on each page, and typing the verdict back into a cell. Rorshach turns each of
those into a glance and a keypress.

It pairs well with an AI assistant: the assistant writes the task file, you do the
looking, and the assistant reads the results file and acts on your answers.

## Run it

Requires [Node.js](https://nodejs.org/) (LTS).

```bash
npm install
npm run sample                              # a three-item demo
npx electron . path/to/task.json            # your own task
npx electron . task.json --out answers.json # choose where results go
```

Without a task file argument, Rorshach asks you to pick one. Results default to
`<task name>.results.json` next to the task file. If that file already exists, the
review resumes at the first unanswered item.

## Task file

```json
{
  "title": "Spec audit review",
  "description": "Optional text shown under the title.",
  "defaults": {
    "options": ["Real error", "Not a problem", "Needs vendor check"],
    "note": true
  },
  "items": [
    {
      "id": "milton-inside-width",
      "header": "Milton Power Recliner · Inside Width listed as 42",
      "detail": "Equals the overall width. Typical is 23–24.",
      "pane": {
        "kind": "url",
        "src": "https://www.havertys.com/products/product-page/milton-power-recliner",
        "focus": "Inside Width"
      },
      "options": [
        { "label": "Real error", "value": "error", "key": "1" },
        { "label": "Not a problem", "value": "fine", "key": "2" },
        { "label": "Needs vendor check", "value": "vendor", "key": "3" }
      ],
      "note": true,
      "meta": { "rule": "M1", "sku": "20462-262" }
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `items[].id` | Unique id, used as the key in the results file. Defaults to `item-N`. |
| `items[].header` | The question or claim, shown large. |
| `items[].detail` | Supporting text. Optional. |
| `items[].pane.kind` | `url` (a live page), `image` (a picture), or `snapshot` (a saved `.html` or `.mhtml`). |
| `items[].pane.src` | A URL, or a path relative to the task file. |
| `items[].pane.focus` | Text to find on the page. The first visible match is highlighted and scrolled into view; when the match is a label (`<dt>`, `<th>`, `<label>`), the value next to it is highlighted too. Optional. |
| `items[].pane.caption` | Caption under an image. Optional. |
| `items[].pane.viewport` | The size the page should believe it has: a preset name (`fit`, `desktop` 1440×900, `laptop` 1280×800, `tablet` 820×1180, `phone` 390×844) or `{ "width": 390, "height": 844, "mobile": true }`. Falls back to `defaults.viewport`, then `fit`. See below. |
| `items[].options` | Answer buttons. Strings, or objects with `label`, `value` and `key` (the hotkey). Falls back to `defaults.options`, then to Yes / No / Can't tell. |
| `items[].note` | Whether to show the free-text note box. Falls back to `defaults.note`, then `true`. |
| `items[].meta` | Anything you want carried through untouched. Optional. |

## Viewports

By default the pane fills the space beside the panel and the page sees that size
(`fit`). A fixed viewport makes Chromium emulate that size instead, the way the
device mode in developer tools does: the page lays out at the requested width, media
queries fire for it, and `mobile` adds the mobile layout viewport (the page's
`<meta name="viewport">` is honored, as on a phone), touch events and a mobile user
agent. When the requested size is larger than the space available, the
whole page is scaled down to fit and the panel shows the percentage.

Set it per item with `pane.viewport`, for the whole task with `defaults.viewport`, or
on the fly with the Viewport buttons in the panel (`V` cycles Task → Fit → Desktop →
Tablet → Phone). The viewport in effect is recorded with each answer.

This is a layout check, not a device: you get Chromium's rendering at that size with
a borrowed user agent, not Safari, native fonts or a site's app redirects.

## Results file

```json
{
  "task": "C:/reviews/spec-audit.json",
  "title": "Spec audit review",
  "total": 52,
  "startedAt": "2026-10-21T15:02:11.000Z",
  "updatedAt": "2026-10-21T15:19:40.000Z",
  "finishedAt": "2026-10-21T15:19:40.000Z",
  "done": true,
  "answers": {
    "milton-inside-width": {
      "value": "error", "label": "Real error", "note": "Should be 23.", "index": 0,
      "viewport": { "name": "fit" },
      "at": "2026-10-21T15:02:30.000Z"
    }
  }
}
```

The file is rewritten after every answer. `done` becomes `true` when every item has an
answer, which is the thing to watch for if something is waiting on the review.

## Keys

| Key | Action |
|---|---|
| `1`–`9`, or the option's own key | Answer and move to the next unanswered item |
| `N` | Jump to the note box (`Esc` leaves it) |
| `Backspace` / `←` | Previous item |
| `→` | Skip ahead without answering |
| `H` | Run the highlight again (for pages that render late) |
| `R` | Reload the pane |
| `O` | Open the current page in your default browser |
| `V` | Cycle the viewport: task setting, fit, desktop, tablet, phone |
| `Alt` + any of the above | Same, while the page itself has keyboard focus |
| `F12` | Developer tools for the pane |

Set `RORSHACH_DEBUG=1` to print item loads, highlight results, what the page reports
about its viewport, and answers to stdout. Add `RORSHACH_SNAPSHOT_DIR=<folder>` to
also save a PNG of the pane for each item once its highlight settles.

## How the pane is sandboxed

The reviewed content runs in its own Electron `WebContentsView` with the Chromium
sandbox on, no Node integration, no preload script, and a separate persistent session
(`persist:rorshach-pane`), so logins survive between runs but the page can't reach the
control panel or the file system. Popups open inside the pane. The highlight is a
small script run in the page that changes inline styles and nothing else.

## Build installers

```bash
npm install --save-dev electron-builder
npm run dist
```

## License

MIT.
