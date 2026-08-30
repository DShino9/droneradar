/* The world map as a turning globe.

   The flat map is 900x366 — two and a half times wider than it is tall — and
   the panel it lives in is roughly square. Whichever way that is resolved,
   something is wasted: either the map is small and the panel is mostly empty,
   or the panel is short and the article under it has no room. A sphere is
   square, so the same data in the same box comes out several times larger.

   Half the world is behind it at any moment. That is the trade, and it is paid
   back at the moment it matters: when a story is pinged the globe spins to
   bring that country to the front before the ping lands, so the place you are
   being shown is always facing you.

   The source is an equirectangular projection with known bounds, so the screen
   coordinates in world.json invert to longitude and latitude exactly:
     lon = x / SCALE + LON_MIN,  lat = LAT_MAX - y / SCALE
   From there it is an orthographic projection, which is what a globe seen from
   far away is. */

import { $, S } from "./state.js";

const LON_MIN = -132, LAT_MAX = 74, SCALE = 3;   // must match tools_mkworld.py
const RAD = Math.PI / 180;

// The box the globe is drawn into. Square, unlike the flat map.
const BOX = 400;
const CX = BOX / 2, CY = BOX / 2, R = BOX * 0.455;

// Tilt: the pole is not at the top of the screen. A globe seen dead-on at the
// equator hides both poles; twenty degrees is enough to show the northern
// landmasses, which is where the drone news is.
const TILT = 22 * RAD;

/* Every point as a unit vector, worked out once.

   Rotating a sphere is a matrix multiply, and the trigonometry is per-frame
   only if the points are stored as angles. Stored as vectors, a frame is six
   multiplies per point and no trigonometry at all beyond one sine and one
   cosine for the rotation itself. */
function toVector(x, y) {
  const lon = (x / SCALE + LON_MIN) * RAD;
  const lat = (LAT_MAX - y / SCALE) * RAD;
  const cl = Math.cos(lat);
  return [cl * Math.sin(lon), Math.sin(lat), cl * Math.cos(lon)];
}

// "M12.3 45.6 78.9 10.1 …" — pairs of numbers, one subpath per M.
function parsePath(d) {
  const subs = [];
  for (const chunk of String(d).split("M")) {
    const nums = chunk.match(/-?\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 6) continue;          // fewer than 3 points
    const v = new Float64Array(nums.length / 2 * 3);
    for (let i = 0, k = 0; i + 1 < nums.length; i += 2, k += 3) {
      const p = toVector(+nums[i], +nums[i + 1]);
      v[k] = p[0]; v[k + 1] = p[1]; v[k + 2] = p[2];
    }
    subs.push(v);
  }
  return subs;
}

function buildGlobe(data) {
  const out = [];
  for (const c of data.countries || []) {
    const subs = parsePath(c.d);
    if (!subs.length) continue;
    out.push({ iso: c.iso, ja: c.ja, en: c.en, subs, anchor: toVector(c.cx, c.cy) });
  }
  return out;
}

/* Project one unit vector for a given rotation.

   Rotate about the polar axis by `lon0` — that is the spin — then tilt the
   whole thing forward by TILT so the northern hemisphere faces the viewer.
   The z component after both is the depth: positive is the near side. */
function project(v, sinL, cosL, out) {
  const xr = v[0] * cosL - v[2] * sinL;
  const zr = v[0] * sinL + v[2] * cosL;
  const yr = v[1] * Math.cos(TILT) - zr * Math.sin(TILT);
  const zz = v[1] * Math.sin(TILT) + zr * Math.cos(TILT);
  out[0] = CX + R * xr;
  out[1] = CY - R * yr;
  out[2] = zz;                                     // > 0 means facing us
  return out;
}

/* The path for one country at this rotation, or "" if it is round the back.

   A shape straddling the horizon is cut there rather than drawn across the
   sphere: the run of points is broken wherever it passes behind, so the
   visible part keeps its outline and the hidden part simply is not there. */
const P = [0, 0, 0];

function pathFor(country, sinL, cosL) {
  let d = "";
  for (const v of country.subs) {
    let open = false;
    for (let k = 0; k < v.length; k += 3) {
      project([v[k], v[k + 1], v[k + 2]], sinL, cosL, P);
      if (P[2] <= 0) { open = false; continue; }    // behind the globe
      d += (open ? "L" : "M") + P[0].toFixed(1) + " " + P[1].toFixed(1);
      open = true;
    }
  }
  return d;
}

// Where a country's own anchor lands, and whether it is facing us.
function anchorAt(country, lon0) {
  const sinL = Math.sin(lon0), cosL = Math.cos(lon0);
  project(country.anchor, sinL, cosL, P);
  return { x: P[0], y: P[1], front: P[2] > 0 };
}

/* The rotation that brings a country to the front.

   `project` rotates as x' = x·cos a − z·sin a, z' = x·sin a + z·cos a, so x'
   vanishes — the point lands on the meridian facing the viewer — when
   a = atan2(x, z), which for a unit vector built from a longitude is that
   longitude. Not its negative: with the sign flipped the rotation doubled the
   angle instead of cancelling it, and every country but the few already near
   the front ended up round the back. */
function facingRotation(country) {
  const [x, , z] = country.anchor;
  return Math.atan2(x, z);
}

export { BOX, CX, CY, R, TILT, anchorAt, buildGlobe, facingRotation, pathFor, project, toVector };

/* ------------------------------------------------------------- rendering */

const NS = "http://www.w3.org/2000/svg";

/* Seconds for one turn — while it is turning.

   It stands still for the seven seconds a ping is up, and the world's turn in
   the spotlight comes round every fourteen, so it is only spinning about half
   the time. A nominal 42s was therefore 84s of clock before a given ocean came
   back round, which is why it read as barely moving.

   Twenty-two nominal is about 44s of clock for a full turn, and 16°/s while it
   runs — quick enough to watch a continent cross the face, slow enough to read
   a country name off it on the way. */
const SPIN_SECONDS = 22;
// Redraw only when the sphere has actually turned. Below this the paths would
// round to the same string anyway.
const STEP = 0.35 * RAD;

const G = {
  built: null,        // geometry, parsed once
  lon: 0,             // current rotation
  target: null,       // where a spotlight wants it
  spinning: true,
  zoom: 1,
  lastDrawn: -99,
  seekFrom: 0, seekTo: 0, seekMs: 0, seekT0: 0,
  paths: new Map(),   // iso -> <path>
  raf: 0,
};

function mk(tag, attrs, cls) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (cls) n.setAttribute("class", cls);
  return n;
}

/* Build the globe's fixed furniture once: the ocean, the graticule, and one
   empty <path> per country that the spin loop rewrites in place.

   Rewriting the `d` of paths that already exist is what makes a spinning
   sphere affordable — creating and discarding a hundred and seventy nodes
   every frame is not. */
function mountGlobe(svg, data, onPick) {
  if (!G.built) G.built = buildGlobe(data);
  svg.setAttribute("viewBox", `0 0 ${BOX} ${BOX}`);
  svg.innerHTML = "";
  G.paths.clear();

  svg.append(mk("circle", { cx: CX, cy: CY, r: R }, "globe-sea"));

  // Meridians and parallels, drawn as plain circles and ellipses rather than
  // projected curves: at this size the difference is under a pixel and the
  // cost is three nodes instead of a thousand points.
  for (const f of [0.33, 0.66]) {
    svg.append(mk("ellipse", { cx: CX, cy: CY, rx: R * f, ry: R }, "globe-grid"));
    svg.append(mk("ellipse", { cx: CX, cy: CY, rx: R, ry: R * f }, "globe-grid"));
  }
  svg.append(mk("line", { x1: CX - R, y1: CY, x2: CX + R, y2: CY }, "globe-grid"));

  for (const c of G.built) {
    const p = mk("path", { d: "" }, "pref");
    const t = document.createElementNS(NS, "title");
    p.append(t);
    p.onclick = () => onPick && onPick(c.iso);
    svg.append(p);
    G.paths.set(c.iso, p);
  }

  // The limb: a ring over the top, so the sphere has an edge rather than
  // fading into the panel.
  svg.append(mk("circle", { cx: CX, cy: CY, r: R }, "globe-limb"));
  // Bubbles ride on the surface and are rebuilt every frame; the ping is put
  // there once and has to survive them, so it gets a layer of its own. It was
  // in with the bubbles, and the first frame after it landed wiped it out.
  svg.append(mk("g", {}, "globe-marks"));
  svg.append(mk("g", {}, "globe-ping"));
}

/* Redraw the countries for the current rotation. */
function drawGlobe(svg) {
  if (!G.built) return;
  if (Math.abs(G.lon - G.lastDrawn) < STEP) return;
  G.lastDrawn = G.lon;
  const sinL = Math.sin(G.lon), cosL = Math.cos(G.lon);
  for (const c of G.built) {
    const p = G.paths.get(c.iso);
    if (!p) continue;
    // Cheap reject: if the country's own anchor is well round the back, its
    // outline is too. The margin keeps a shape that straddles the limb.
    project(c.anchor, sinL, cosL, P);
    p.setAttribute("d", P[2] < -0.35 ? "" : pathFor(c, sinL, cosL));
  }
}

export { G, SPIN_SECONDS, STEP, drawGlobe, mk, mountGlobe };

/* The spin.

   One frame is a few multiplies per point and a string rebuild; the throttle
   above keeps it to the frames that would actually look different. The loop
   stops itself when the tab is hidden — a globe turning in a window nobody is
   looking at is pure cost. */
function spinGlobe(svg) {
  cancelAnimationFrame(G.raf);
  let last = performance.now();
  const step = (t) => {
    const dt = Math.min(0.25, (t - last) / 1000);
    last = t;
    if (!document.hidden && svg.isConnected) {
      if (G.target != null) {
        /* Hurrying to a country the spotlight is about to ping — the long way
           round if that is the way the Earth turns.

           It used to take the shorter arc, which for a target just behind the
           meridian meant spinning backwards for a moment. A globe that
           reverses is not a globe; it is a dial. So the seek always goes the
           same way the idle drift does, and a country ten degrees "behind"
           costs most of a turn to reach — which is the honest way to get
           there, and takes about two seconds.

           A fixed sweep rather than an easing towards the target: easing makes
           the speed depend on the distance, so a short hop was a flick and a
           long one crawled at the end. This way every seek takes a similar
           time and the globe never appears to change its mind. */
        const k = Math.min(1, (t - G.seekT0) / G.seekMs);
        const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        G.lon = G.seekFrom + (G.seekTo - G.seekFrom) * e;
        if (k >= 1) { G.lon = G.target; G.target = null; }
      } else if (G.spinning) {
        /* Eastward, the way the Earth turns.

           `project` sends +x to the right of the screen and toVector puts
           eastern longitudes at +x, so east is screen-right exactly as on a
           map. The Earth turns eastward, which means the face of it we can see
           travels to the right — and the rotation that does that is a
           decreasing angle here, not an increasing one. It was going the other
           way, which is backwards in the way that a clock running anticlockwise
           is backwards: not obviously wrong, but wrong. */
        G.lon -= (2 * Math.PI / SPIN_SECONDS) * dt;
      }
      if (G.lon > Math.PI) G.lon -= 2 * Math.PI;
      if (G.lon < -Math.PI) G.lon += 2 * Math.PI;
      drawGlobe(svg);
      drawMarks(svg);
    }
    G.raf = requestAnimationFrame(step);
  };
  G.raf = requestAnimationFrame(step);
}

/* Bubbles, redrawn each frame because they travel with the sphere.

   They are few — six at most — so unlike the outlines these are cheap enough
   to recreate rather than track. A bubble on the far side is simply not
   drawn. */
let MARKS = [];

function setMarks(list) { MARKS = list || []; }

function drawMarks(svg) {
  const host = svg.querySelector(".globe-marks");
  if (!host) return;
  const sinL = Math.sin(G.lon), cosL = Math.cos(G.lon);
  host.innerHTML = "";
  for (const m of MARKS) {
    project(m.v, sinL, cosL, P);
    if (P[2] <= 0.02) continue;                    // behind, or on the limb
    // Fade as it approaches the edge, so bubbles leave rather than blink out.
    const fade = Math.min(1, P[2] * 4);
    const g = mk("g", { opacity: fade.toFixed(2) });
    g.append(mk("circle", { cx: P[0].toFixed(1), cy: P[1].toFixed(1), r: m.r }, "bub"));
    const t = mk("text", { x: P[0].toFixed(1), y: (P[1] + 3).toFixed(1) }, "bub-n");
    t.textContent = m.n;
    g.append(t);
    host.append(g);
  }
}

/* Turn to face this country, and stop there.

   `spinning` is what holds it. Setting a target alone was not enough: the
   target clears itself the moment the turn arrives, and the very next frame
   the drift took over again — so the ping and its icon, which are placed once
   at a point on the screen, were left behind by the globe sliding out from
   under them. Nothing was holding it, because `releaseGlobe` was setting a
   target that had already cleared itself to null. */
function faceCountry(iso) {
  if (!G.built) return null;
  const c = G.built.find((x) => x.iso === iso);
  if (!c) return null;
  const to = facingRotation(c);

  /* Always eastward, the way it drifts.

     The idle spin decreases `lon`, so a seek must decrease it too. Normalising
     the gap into (-2π, 0] is what forces that: the target is always taken to
     be ahead in the direction of travel, however close behind it may be. */
  let d = to - G.lon;
  while (d > 0) d -= 2 * Math.PI;
  while (d <= -2 * Math.PI) d += 2 * Math.PI;

  G.seekFrom = G.lon;
  G.seekTo = G.lon + d;
  // Between half a second for a short hop and two for the far side, so the
  // pace is recognisably the same gesture at any distance.
  G.seekMs = Math.max(500, Math.min(2000, Math.abs(d) / (2 * Math.PI) * 2000));
  G.seekT0 = performance.now();
  G.target = to;
  G.spinning = false;
  return c;
}

function releaseGlobe() { G.target = null; G.spinning = true; }

export { MARKS, drawMarks, faceCountry, releaseGlobe, setMarks, spinGlobe };
