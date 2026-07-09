import json
import re

transcript_paths = [
    "/Users/wayneclub/.gemini/antigravity/brain/e90e6e41-db93-4298-b5fa-54d1347fd46d/.system_generated/logs/transcript.jsonl",
    "/Users/wayneclub/.gemini/antigravity/brain/e90e6e41-db93-4298-b5fa-54d1347fd46d/.system_generated/logs/transcript_full.jsonl"
]
output_path = "/Users/wayneclub/PassBar/scripts/prompts/zh_explanation.txt"

lines_dict = {}

for path in transcript_paths:
    print(f"Reading {path}...")
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            try:
                data = json.loads(line)
                content = ""
                # Try to extract content field
                if "content" in data:
                    content = data["content"]
                elif "tool_calls" in data:
                    # check tool outputs
                    continue
                
                # Check for our specific file dump
                if "File Path: `file:///Users/wayneclub/PassBar/scripts/prompts/zh_explanation.txt`" in content:
                    for raw_line in content.split("\n"):
                        match = re.match(r"^(\d+): (.*)$", raw_line)
                        if match:
                            line_num = int(match.group(1))
                            line_content = match.group(2)
                            lines_dict[line_num] = line_content
                        elif re.match(r"^(\d+):$", raw_line):
                            line_num = int(raw_line.split(":")[0])
                            lines_dict[line_num] = ""
            except Exception as e:
                pass

if lines_dict:
    sorted_keys = sorted(lines_dict.keys())
    print(f"Found total of {len(sorted_keys)} unique lines. Range: {sorted_keys[0]} to {sorted_keys[-1]}")
    with open(output_path, "w", encoding="utf-8") as out:
        for k in sorted_keys:
            out.write(lines_dict[k] + "\n")
    print("Successfully restored the full file!")
else:
    print("Failed to find prompt in logs.")
