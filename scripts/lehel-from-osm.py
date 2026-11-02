#!/usr/bin/env python3
"""
Turns an OpenStreetMap Overpass dump (JSON, "out geom") around Widenmayerstrasse 48 into the compact
src/client/world/agentix/lehel-data.ts that the agentix map's outside is built from (outside.ts).

Run it with the standard library only:

    python -I scripts/lehel-from-osm.py path/to/widenmayer.json

The dump comes from the Overpass API (ways with their geometry, 300 m or a bit more around the address
point). It is not kept in the repo; the generated file is. Everything is written in metres east and
north of the address point (OUTLOOK in src/shared/maps/agentix.ts), clipped to 300 m, simplified
(Douglas-Peucker) and rounded to 0.1 m. Buildings that would stand where the office's hall is are
dropped (the hall is the real building's stand-in, with made-up rooms: see HALL below).

Map data (c) OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright
"""
import json
import math
import sys
from pathlib import Path

# The address point of Widenmayerstrasse 48 (OUTLOOK in src/shared/maps/agentix.ts).
LAT0, LON0 = 48.1488592, 11.5964165
BEARING = 314.0  # the way the window looks (compass degrees)
RADIUS = 300.0  # how far out the map goes (a square this far to each side)
TOLERANCE = 1.5  # Douglas-Peucker, metres
BUILDING_TOLERANCE = 1.0  # buildings keep their corners a little better
MIN_AREA = 15.0  # smaller buildings are sheds and bins

# The hall (24 by 18 m) as it stands outside: the window wall runs through the address point, and the
# hall lies behind it. The real room's window is 3.3 m from the hall's west end (x = -8.7 of -12..12),
# so in the frame turned to the bearing (x to the right of the window, z away from the window) the hall
# is x -3.3..20.7, z 0..18. Buildings within MARGIN of it are dropped.
HALL = (-3.3, 20.7, 0.0, 18.0)
MARGIN = 3.0

# How wide a road is drawn (metres), by OSM highway class. Anything else is left out.
WIDTH = {
    'secondary': 9.0, 'secondary_link': 5.0, 'residential': 6.0, 'unclassified': 6.0, 'service': 3.5,
    'pedestrian': 4.0, 'cycleway': 2.5, 'track': 3.0, 'footway': 1.8, 'path': 1.5, 'steps': 1.8,
}
GREEN = {('leisure', 'park'): 0, ('landuse', 'grass'): 1, ('landuse', 'meadow'): 1, ('landuse', 'greenfield'): 1, ('leisure', 'pitch'): 2}
# Storeys when the map doesn't say.
LEVELS = {'shed': 1, 'garages': 1, 'parking': 2, 'service': 1, 'guardhouse': 1, 'house': 3, 'detached': 3}


def to_xy(p):
    return ((p['lon'] - LON0) * 111320.0 * math.cos(math.radians(LAT0)), (p['lat'] - LAT0) * 110540.0)


def turn(p):
    """East/north to the hall's frame: x to the right of the window, z away from the window's outlook."""
    b = math.radians(BEARING)
    e, n = p
    return (e * math.cos(b) - n * math.sin(b), -(e * math.sin(b) + n * math.cos(b)))


def area(ring):
    return 0.5 * sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))


def dp(points, tol):
    """Douglas-Peucker on an open line."""
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy)
    far, at = -1.0, 0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        d = math.hypot(px - x1, py - y1) if norm == 0 else abs(dy * (px - x1) - dx * (py - y1)) / norm
        if d > far:
            far, at = d, i
    if far <= tol:
        return [points[0], points[-1]]
    return dp(points[: at + 1], tol)[:-1] + dp(points[at:], tol)


def dp_ring(ring, tol):
    """Douglas-Peucker on a closed ring (without its repeated last point): split at the point furthest from the first."""
    if len(ring) < 4:
        return ring
    far = max(range(1, len(ring)), key=lambda i: math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]))
    return dp(ring[: far + 1], tol)[:-1] + dp(ring[far:] + [ring[0]], tol)[:-1]


def clip_ring(ring, x0, x1, y0, y1):
    """Sutherland-Hodgman against a box."""
    def side(out, inside, cross):
        res = []
        for i, cur in enumerate(out):
            prev = out[i - 1]
            a, b = inside(prev), inside(cur)
            if a != b:
                res.append(cross(prev, cur))
            if b:
                res.append(cur)
        return res
    def at_x(x):
        return lambda p, q: (x, p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0]))
    def at_y(y):
        return lambda p, q: (p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]), y)
    out = ring
    for inside, cross in (
        (lambda p: p[0] >= x0, at_x(x0)), (lambda p: p[0] <= x1, at_x(x1)),
        (lambda p: p[1] >= y0, at_y(y0)), (lambda p: p[1] <= y1, at_y(y1)),
    ):
        if not out:
            break
        out = side(out, inside, cross)
    return out


def clip_line(line, r):
    """The pieces of an open line inside the square +-r."""
    pieces, cur = [], []
    inside = lambda p: abs(p[0]) <= r and abs(p[1]) <= r
    for i, p in enumerate(line):
        if inside(p):
            cur.append(p)
        else:
            if cur:
                pieces.append(cur)
            cur = []
    if cur:
        pieces.append(cur)
    return [c for c in pieces if len(c) > 1]


def r1(v):
    v = round(v, 1)
    return 0.0 if v == 0 else v


def flat(points):
    return [r1(c) for p in points for c in p]


def num(v):
    s = ('%.1f' % v).rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def arr(values):
    return '[' + ','.join(num(v) for v in values) + ']'


def emit(rows, indent='  ', width=190):
    """Rows of numbers or [number, row] pairs, several to a line."""
    lines, cur = [], indent
    for r in rows:
        s = arr(r) if isinstance(r[0], (int, float)) and not isinstance(r[1], list) else '[' + num(r[0]) + ',' + arr(r[1]) + ']'
        if len(cur) + len(s) > width and cur.strip():
            lines.append(cur.rstrip())
            cur = indent
        cur += s + ', '
    if cur.strip():
        lines.append(cur.rstrip())
    return '\n'.join(lines)


def hits_hall(ring):
    x0, x1, z0, z1 = HALL
    box = clip_ring([turn(p) for p in ring], x0 - MARGIN, x1 + MARGIN, z0 - MARGIN, z1 + MARGIN)
    return len(box) >= 3 and abs(area(box)) > 0.01


def main(src):
    data = json.loads(Path(src).read_text(encoding='utf-8'))
    buildings, water, green, roads, streams = [], [], [], [], []
    dropped = 0
    for e in data['elements']:
        t = e.get('tags', {})
        pts = [to_xy(p) for p in e.get('geometry', [])]
        if len(pts) < 2:
            continue
        closed = pts[0] == pts[-1] and len(pts) > 3
        ring = pts[:-1] if closed else pts
        if 'building' in t and closed:
            if abs(area(ring)) < MIN_AREA or not any(abs(x) <= RADIUS and abs(y) <= RADIUS for x, y in ring):
                continue
            if hits_hall(ring):
                dropped += 1
                continue
            ring = dp_ring(ring, BUILDING_TOLERANCE)
            if len(ring) < 3:
                continue
            try:
                levels = float(t['building:levels'])
            except (KeyError, ValueError):
                levels = LEVELS.get(t['building'], 4)
            buildings.append([int(levels) if levels == int(levels) else levels] + flat(ring if area(ring) > 0 else ring[::-1]))
        elif t.get('natural') == 'water' and closed:
            ring = clip_ring(ring, -RADIUS, RADIUS, -RADIUS, RADIUS)
            ring = dp_ring(ring, TOLERANCE) if len(ring) > 3 else ring
            if len(ring) >= 3 and abs(area(ring)) > 8:
                water.append(flat(ring if area(ring) > 0 else ring[::-1]))
        elif t.get('waterway') in ('river', 'stream', 'canal') and t.get('name') != 'Isar' and t.get('tunnel') in (None, 'no'):
            # The Isar itself is drawn from its water polygons; the smaller waters from their lines.
            wide = 6.0 if t.get('name') == 'Eisbach' else 2.5
            for piece in clip_line(pts, RADIUS):
                streams.append((wide, flat(dp(piece, TOLERANCE))))
        elif any((k, t.get(k)) in GREEN for k in ('leisure', 'landuse')) and closed:
            kind = next(GREEN[(k, t[k])] for k in ('leisure', 'landuse') if (k, t.get(k)) in GREEN)
            ring = clip_ring(ring, -RADIUS, RADIUS, -RADIUS, RADIUS)
            ring = dp_ring(ring, TOLERANCE) if len(ring) > 3 else ring
            if len(ring) >= 3 and abs(area(ring)) > 20:
                green.append([kind] + flat(ring if area(ring) > 0 else ring[::-1]))
        elif t.get('highway') in WIDTH and t.get('tunnel') in (None, 'no'):
            for piece in clip_line(pts, RADIUS):
                roads.append((WIDTH[t['highway']], flat(dp(piece, TOLERANCE))))

    def by_width(items):
        out = {}
        for w, line in items:
            out.setdefault(w, []).append(line)
        return sorted(out.items(), key=lambda kv: -kv[0])

    head = f'''/*
 * The surroundings of Widenmayerstraße 48 in Lehel, Munich, for the agentix map's outside (outside.ts).
 *
 * Map data (c) OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright
 *
 * Generated by scripts/lehel-from-osm.py; do not edit by hand. All coordinates are metres east and north
 * of the address point (OUTLOOK in src/shared/maps/agentix.ts), flat as x0,y0,x1,y1,..., clipped to
 * {int(RADIUS)} m, simplified and rounded to 0.1 m. {len(buildings)} buildings; {dropped} that stood where the office's hall is were dropped.
 * OpenStreetMap does not tie No. 48 to a building outline, so none of these is "No. 48".
 */

'''
    body = '/** Buildings: the number of storeys, then the outline (counter-clockwise). */\n'
    body += 'export const BUILDINGS: number[][] = [\n' + emit(buildings) + '\n];\n\n'
    body += '/** Water (the Isar, ponds): outlines. */\nexport const WATER: number[][] = [\n' + emit(water) + '\n];\n\n'
    body += '/** Small waters (the Eisbach and the streams) as lines: [width, lines]. */\nexport const STREAMS: [number, number[][]][] = [\n'
    body += '\n'.join(f'  [{num(w)}, [\n{emit(ls, "    ")}\n  ]],' for w, ls in by_width(streams)) + '\n];\n\n'
    body += '/** Green areas: the kind (0 park, 1 grass, 2 pitch), then the outline. */\nexport const GREEN: number[][] = [\n' + emit(green) + '\n];\n\n'
    body += '/** Roads and paths as lines: [width, lines]. */\nexport const ROADS: [number, number[][]][] = [\n'
    body += '\n'.join(f'  [{num(w)}, [\n{emit(ls, "    ")}\n  ]],' for w, ls in by_width(roads)) + '\n];\n'
    out = Path(__file__).resolve().parent.parent / 'src' / 'client' / 'world' / 'agentix' / 'lehel-data.ts'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(head + body, encoding='utf-8', newline='\n')
    print(f'{out}: {len(buildings)} buildings ({dropped} dropped at the hall), {len(water)} water, {sum(len(l) for _, l in by_width(streams))} streams, {len(green)} green, {sum(len(l) for _, l in by_width(roads))} roads')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: python -I scripts/lehel-from-osm.py widenmayer.json')
    main(sys.argv[1])
