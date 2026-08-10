"""
Dev tool: re-embed edited source files back into Floor_Planner_version2.html.

Floor_Planner_version2.html is a self-contained "bundle": the real app code
(app.js = the <floor-3d> Three.js component, data.js = window.EGN_DATA,
vendor-three.js = Three.js r160) lives gzip+base64-encoded inside a
<script type="__bundler/manifest"> tag, keyed by UUID. shell.html is the
outer page (toolbar, search, zone chips) stored as a JSON string inside a
<script type="__bundler/template"> tag.

Workflow to make a change:
  1. Edit app.js / data.js / shell.html in this folder directly.
  2. Run: python repack.py
  3. Reload the HTML in the browser — no other build step needed.

Editing shell.html requires re-encoding it as the template JSON string too;
this script handles both the manifest resources and the template in one pass.
"""
import re, json, base64, gzip, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_HTML = os.path.join(HERE, "..", "Floor_Planner_version2.html")

# uuid -> local filename (must match the uuids already present in the manifest)
RESOURCES = {
    "0c296ce5-70da-4f17-928f-8842766540b2": "app.js",
    "4f5a6f4e-abe1-447a-9b60-4bd57be078c9": "data.js",
    "c040ec6d-c3b3-47d2-892e-87f915f8e3a5": "vendor-three.js",
}

with open(SRC_HTML, "r", encoding="utf-8") as f:
    content = f.read()

# ---- manifest (compressed JS resources) ----
m = re.search(r'<script type="__bundler/manifest">(.*?)</script>', content, re.S)
if not m:
    sys.exit("manifest script tag not found")
manifest = json.loads(m.group(1))

changed = []
for uuid, fname in RESOURCES.items():
    if uuid not in manifest:
        print(f"WARNING: uuid {uuid} ({fname}) not in manifest, skipping")
        continue
    path = os.path.join(HERE, fname)
    with open(path, "rb") as f:
        raw = f.read()
    compressed = gzip.compress(raw, mtime=0)
    b64 = base64.b64encode(compressed).decode("ascii")
    if b64 != manifest[uuid]["data"]:
        manifest[uuid]["data"] = b64
        changed.append(fname)

new_manifest_json = json.dumps(manifest, separators=(",", ":"))
content = content[:m.start()] + '<script type="__bundler/manifest">' + new_manifest_json + '</script>' + content[m.end():]

# ---- template (outer HTML shell) ----
t = re.search(r'<script type="__bundler/template">(.*?)</script>', content, re.S)
if not t:
    sys.exit("template script tag not found")
shell_path = os.path.join(HERE, "shell.html")
with open(shell_path, "r", encoding="utf-8") as f:
    shell_html = f.read()
current_template = json.loads(t.group(1))
if shell_html != current_template:
    new_template_json = json.dumps(shell_html)
    content = content[:t.start()] + '<script type="__bundler/template">' + new_template_json + '</script>' + content[t.end():]
    changed.append("shell.html")

with open(SRC_HTML, "w", encoding="utf-8") as f:
    f.write(content)

if changed:
    print("Repacked:", ", ".join(changed))
else:
    print("No changes detected — nothing repacked.")
