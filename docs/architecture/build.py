"""Assemble self-contained diagram pages from the shared sources.

Outputs full HTML documents into this folder (for the repo) and skeleton-free
copies into ./dist (for publishing where a wrapper supplies html/head/body).
"""
from pathlib import Path

here = Path(__file__).parent
tpl = (here / 'template.html').read_text()
base = (here / 'base.css').read_text()
data = (here / 'data.js').read_text().replace('export const ARCH', 'const ARCH')
engine = (here / 'engine.js').read_text().replace('export function mountArchitecture', 'function mountArchitecture')

legend_items = [
    ('sky', 'Client'), ('teal', 'API server'), ('moss', 'Orchestration'), ('gold', 'Agent runtime'),
    ('copper', 'MCP gateway'), ('lavender', 'Models'), ('rose', 'Evals'), ('stone', 'Data'),
    ('ink', 'Protocol'), ('slate', 'External'),
]
legend = ''.join(f'<span class="tone-{t}"><i></i>{name}</span>' for t, name in legend_items)

variants = {
    'traditional': dict(
        title='Stardust Cafe Architecture',
        desc='Pannable architecture map of the Stardust Cafe agentic eval harness: client, API server, orchestration, agent runtime, MCP gateway, models, evals, data and the shared protocol.',
        sub='Drag to pan · scroll to zoom · click a component for details',
        search='Jump to a component…',
        hint='Click any component to expand it. Esc collapses.',
        fonts='https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap',
        theme_css=(here / 'theme-traditional.css').read_text(),
        nick='false',
    ),
    'cafe': dict(
        title='Stardust Cafe Floor Plan',
        desc='The same architecture drawn as districts of the cafe, in the dusk palette of the 3D scene: storefront, back office, the floor, the staff, the pass, the roster, the inspector’s desk, the cellar and the house rules.',
        sub='Wander the square · scroll to zoom · tap a station to peek behind the counter',
        search='Find a station…',
        hint='Every station is a real module. Tap one; Esc steps back.',
        fonts='https://fonts.googleapis.com/css2?family=Lilita+One&family=Nunito:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap',
        theme_css=(here / 'theme-cafe.css').read_text(),
        nick='true',
    ),
}

(here / 'dist').mkdir(exist_ok=True)
for name, v in variants.items():
    page_css = 'html, body { height: 100%; margin: 0; overflow: hidden; } body { background: var(--bg); }'
    body = (tpl.replace('__BASE_CSS__', page_css + '\n' + base).replace('__TITLE__', v['title']).replace('__DESC__', v['desc']).replace('__SUB__', v['sub'])
            .replace('__SEARCH__', v['search']).replace('__HINT__', v['hint']).replace('__FONTS__', v['fonts'])
            .replace('__THEME_CSS__', v['theme_css']).replace('__LEGEND__', legend)
            .replace('__DATA_JS__', data).replace('__NICK__', v['nick']).replace('__ENGINE_JS__', engine))
    (here / 'dist' / f'{name}.html').write_text(body)
    full = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n'
            + body.split('<div class="archv archv-page">')[0] + '</head>\n<body>\n<div class="archv archv-page">' + body.split('<div class="archv archv-page">')[1] + '\n</body>\n</html>\n')
    (here / f'{name}.html').write_text(full)
    print(name, len(full), 'bytes')
