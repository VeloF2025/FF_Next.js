/**
 * Health & Safety Dashboard — legacy path
 * /projects/health-safety
 *
 * This one RENDERS the dashboard instead of redirecting to /health-safety,
 * unlike its sibling stubs. That is deliberate — read this before "tidying" it
 * into a redirect.
 *
 * Until this change, /health-safety redirected HERE with `permanent: true`
 * (a 308). Browsers cache 308s indefinitely, with no Cache-Control needed, so
 * any client that hit /health-safety while that redirect was live still holds
 * it. If this path redirected back to /health-safety, such a client would
 * loop: /health-safety -> (cached 308, never reaches the server) ->
 * /projects/health-safety -> 307 -> /health-safety -> cached 308 -> ... until
 * the browser gives up with ERR_TOO_MANY_REDIRECTS. Nothing server-side can
 * clear that cache.
 *
 * Serving the page here breaks the loop: those clients land on real content,
 * while everyone else reaches /health-safety directly from the sidebar.
 *
 * The child stubs are unaffected — they already pointed old -> new before this
 * change, so their direction never reversed and no cached redirect conflicts.
 *
 * See `.claude/learnings.md` ("Circular Redirect Detection"): this module has
 * already produced one such loop, at /health-safety/incidents.
 */

export { default, getServerSideProps } from '../../health-safety/index';
