import os
import json
import re

brain_dir = "/Users/wayneclub/.gemini/antigravity/brain"
output_path = "/Users/wayneclub/PassBar/scripts/prompts/zh_explanation.txt"

best_lines = {}
best_source = None

# Loop through all directories
for folder in os.listdir(brain_dir):
    folder_path = os.path.join(brain_dir, folder)
    if not os.path.isdir(folder_path):
        continue
    
    logs_dir = os.path.join(folder_path, ".system_generated", "logs")
    if not os.path.exists(logs_dir):
        continue
    
    for filename in ["transcript_full.jsonl", "transcript.jsonl"]:
        log_path = os.path.join(logs_dir, filename)
        if not os.path.exists(log_path):
            continue
        
        # print(f"Checking {log_path}...")
        try:
            with open(log_path, "r", encoding="utf-8") as f:
                for line in f:
                    data = json.loads(line)
                    content = ""
                    if "content" in data:
                        content = data["content"]
                    elif "tool_calls" in data:
                        continue
                    
                    if "File Path: `file:///Users/wayneclub/PassBar/scripts/prompts/zh_explanation.txt`" in content:
                        current_lines = {}
                        for raw_line in content.split("\n"):
                            match = re.match(r"^(\d+): (.*)$", raw_line)
                            if match:
                                line_num = int(match.group(1))
                                line_content = match.group(2)
                                current_lines[line_num] = line_content
                            elif re.match(r"^(\d+):$", raw_line):
                                line_num = int(raw_line.split(":")[0])
                                current_lines[line_num] = ""
                        
                        if len(current_lines) > len(best_lines):
                            best_lines = current_lines
                            best_source = f"{log_path} (len: {len(current_lines)})"
        except Exception as e:
            pass

if best_lines:
    sorted_keys = sorted(best_lines.keys())
    print(f"Found best lines from {best_source}. Total unique lines: {len(sorted_keys)}. Range: {sorted_keys[0]} to {sorted_keys[-1]}")
    with open(output_path, "w", encoding="utf-8") as out:
        for k in sorted_keys:
            out.write(best_lines[k] + "\n")
    print("Successfully restored the full file from backup log!")
else:
    print("Failed to find prompt in any conversation logs.")
