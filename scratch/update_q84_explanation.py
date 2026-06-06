import json
from pathlib import Path

# Paths
json_path = Path("/Users/wayneclub/PassBar/out/Constitutional Law/Individual Rights/Individual Rights_castudy_enriched.json")
html_path = Path("/Users/wayneclub/PassBar/out_explanations_html/en/Constitutional Law/Individual Rights/084.html")

# Read HTML content
html_content = html_path.read_text(encoding="utf-8")

# Read JSON
with json_path.open(encoding="utf-8") as f:
    data = json.load(f)

# Find question index 84
found = False
for q in data.get("questions", []):
    if q.get("index") == 84:
        q["explanation"] = html_content
        found = True
        break

if found:
    # Write JSON back with indent=2
    with json_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("Successfully updated explanation for question 84 in the JSON file.")
else:
    print("Error: Could not find question with index 84 in the JSON file.")
