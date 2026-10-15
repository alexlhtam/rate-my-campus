# Map movement investigation — 15 October 2026

The investigation used the production build based on PR #13, the existing MapLibre engine and OpenStreetMap fallback, before changing the render path. Campus geometry has 297 features and 4,779 coordinates; a geometry rewrite was not supported by the evidence.

## Findings and changes

- The old overlay loop changed `left` / `top`, then read the container's live `clientWidth` and `clientHeight` for each marker. The new loop reads both dimensions once before any writes and moves overlays with CSS `translate`. The existing percentage anchor and hover scale remain independent. Positions still update synchronously in the map's render event, retaining subpixel accuracy. [Browser layout guidance](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing), [MapLibre marker positioning options](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MarkerOptions/).
- The parent clock recreated items and callbacks every second. A stable selection callback plus an exhaustive semantic map-prop comparison now skips unchanged map renders. Event markers show a stable Live label; their detail/list countdowns keep ticking. A changed score, selection, location, title, start state, expiry or callback still reaches the map. [React memo guidance](https://react.dev/reference/react/memo).
- Building hover hit testing now skips camera movement. This avoids querying rendered building features while dragging.
- Co-located alerts from different layers share an accessible picker instead of hiding behind one another. Each entry retains its own layer icon. Review clustering and stable geographic representatives during movement remain intact.

## Measurements and limits

A temporary, app-owned diagnostic button animated four 1.4-second camera moves around Bloomsbury at zooms 16.65–18.3, pitch 42, bearing 0. The viewport was held at 1280 × 800; the new Events layer was off for the comparison. The diagnostic was removed from shipping code.

| Run | Mean animation frame interval | 95th percentile | Frames over 33.4 ms | Maximum interval |
| --- | ---: | ---: | ---: | ---: |
| Baseline 1 | 16.48 ms | 25.1 ms | 2 | 79 ms |
| Baseline warmed repeat | 14.51 ms | 25.0 ms | 2 | 83 ms |
| Updated 1 | 12.88 ms | 20.8 ms | 1 | 162 ms |
| Updated warmed repeat | 7.99 ms | 12.6 ms | 0 | 25 ms |

These are observations on one desktop, not a guaranteed speedup: tile caches, browser scheduling, active sample countdowns and settling overlay groups vary. The first updated run still had a 162 ms outlier. The camera script does not exercise mouse hover, Google tile loading or a low-end phone. No controlled percentage improvement is claimed. Final mixed-alert clustering was verified separately after these measurements.

Deterministic regressions verify one pair of container measurements before writes, unchanged styles avoided, same-frame subpixel positions, independent anchor/scale, fresh callbacks, event-state changes, selection, expiry and access to every clustered alert. The temporary probe is not a supported application endpoint.

Google coverage/attribution logic and the flat fallback geometry path were left intact. Changes to provider loading would require a separate measurement with configured Google credentials.

Final validation: all 303 tests and the Node 24 production build passed. Browser checks covered the two-week event view, the Now filter, separate Events/Freebies toggles, mixed-marker selection, disabled pre-start availability votes, pan/zoom controls, and 390 × 844 mobile list/map layouts. The browser preview used explicitly fictional demo events; no live import is implied.
