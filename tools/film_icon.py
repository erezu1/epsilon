# Makes the app icons with the soap film: run from the repo root (python3 tools/film_icon.py), then render the SVGs in film_icons.json
# (and look at film_icons_preview.html) in a browser to PNG: icon-maskable-512 (Android, cut to a circle), icon-512/192 and
# apple-touch-icon (the whole square), favicon (a disc).
import base64, json
film = base64.b64encode(open("viewer/film.webp","rb").read()).decode()
d = "M 331.1 173.7 A 76 56 0 1 0 250.8 255.1 L 248.7 253.0 A 88 64 0 1 0 337.0 351.8"
def square_svg(n, film_a):
    # the whole square shows (iOS, and wherever it is drawn uncut): the film follows its rounded edge, soft inward
    glyph = '<path d="%s" fill="none" stroke="#111418" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/>' % d
    defs = ('<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="26"/></filter>'
            '<mask id="m"><rect width="512" height="512" fill="#000"/><rect x="0" y="0" width="512" height="512" rx="115" fill="none" stroke="#fff" '
            'stroke-width="92" filter="url(#soft)"/></mask>')
    body = ('<rect width="512" height="512" fill="#fff"/>'
            '<g mask="url(#m)" opacity="%s"><image href="data:image/webp;base64,%s" x="-340" y="-300" width="1150" height="1150"/></g>' % (film_a, film))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="%d" height="%d"><defs>%s</defs>%s%s</svg>' % (n, n, defs, body, glyph))
def icon_svg(n, film_a, disc=False):
    glyph = '<path d="%s" fill="none" stroke="#111418" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/>' % d
    # the film: clear at the middle, rising toward the edge the launcher shows (a circle of about 80% of the image on
    # Android, the whole rounded square on iOS)
    defs = ('<radialGradient id="rim" cx="256" cy="256" r="362" gradientUnits="userSpaceOnUse">'
            '<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.26" stop-color="#fff" stop-opacity="0"/>'
            '<stop offset="0.42" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.56" stop-color="#fff" stop-opacity="0.7"/>'
            '<stop offset="0.72" stop-color="#fff" stop-opacity="1"/></radialGradient>'
            '<mask id="m"><rect width="512" height="512" fill="url(#rim)"/></mask>')
    if disc:
        defs += '<clipPath id="c"><circle cx="256" cy="256" r="250"/></clipPath>'
        defs = defs.replace('r="362"', 'r="250"').replace('offset="0.56"', 'offset="0.8"').replace('offset="0.72"', 'offset="1"').replace('offset="0.42"', 'offset="0.6"').replace('offset="0.26"', 'offset="0.38"')
    body = ('<rect width="512" height="512" fill="#fff"/>'
            '<g mask="url(#m)" opacity="%s"><image href="data:image/webp;base64,%s" x="-340" y="-300" width="1150" height="1150"/></g>' % (film_a, film))
    if disc:
        body = '<g clip-path="url(#c)">' + body + '</g><circle cx="256" cy="256" r="250" fill="none" stroke="#d3d9e0" stroke-width="6"/>'
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="%d" height="%d"><defs>%s</defs>%s%s</svg>' % (n, n, defs, body, glyph))
A = 0.42
j = {"svg": icon_svg(512, A), "plain": icon_svg(512, 0), "disc": icon_svg(128, A, True), "sq": square_svg(512, 0.42),
     "sq192": square_svg(192, 0.42), "sq180": square_svg(180, 0.42), "mask512": icon_svg(512, A)}
json.dump(j, open("film_icons.json","w"))
enc = lambda s: "data:image/svg+xml;base64," + base64.b64encode(s.encode()).decode()
def android(s, size=150):
    k = 1 / 0.8
    return ('<div style="width:%dpx;height:%dpx;border-radius:50%%;overflow:hidden;display:inline-block;margin:10px;box-shadow:0 2px 6px rgba(0,0,0,.35)">'
            '<img src="%s" style="width:%dpx;height:%dpx;margin:%dpx"></div>' % (size, size, enc(s), size * k, size * k, -size * (k - 1) / 2))
def ios(s, size=150):
    return '<img src="%s" style="width:%dpx;height:%dpx;border-radius:%dpx;margin:10px;box-shadow:0 2px 6px rgba(0,0,0,.35)">' % (enc(s), size, size, size * 0.225)
row = lambda size: android(j["plain"], size) + android(j["svg"], size) + ios(j["plain"], size) + ios(j["sq"], size)
html = ('<html><body style="margin:0;padding:16px;font:14px sans-serif;background:#dfe3e8"><div>now, then with the film (Android, iOS)</div>' + row(150) +
        '<div style="background:#1b1b1f;padding:10px;margin-top:8px">' + row(56) + '</div><div style="background:#5d7fa3;padding:10px">' + row(56) + '</div></body></html>')
open("film_icons_preview.html","w").write(html)
