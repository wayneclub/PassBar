#!/usr/bin/env python3
import sys
import re
import json
import urllib.request
import urllib.parse
from html import unescape

def fetch_html(url):
    """Fetches the HTML content of the page using urllib."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"Error fetching URL: {e}", file=sys.stderr)
        return None

def resolve_nuxt_references(flat_list):
    """Resolves Nuxt 3 flat list reference serialization."""
    # Nuxt serializes data into a flat array. Values reference index integers of this array.
    def resolve_val(val):
        if isinstance(val, int) and 0 <= val < len(flat_list):
            return flat_list[val]
        return val
    return resolve_val

def parse_stardust_nuxt_data(html):
    """Extracts and parses __NUXT_DATA__ JSON state from HTML."""
    # Look for Nuxt 3 script data block
    match = re.search(r'<script[^>]*?id="__NUXT_DATA__"[^>]*?>(.*?)</script>', html, re.DOTALL)
    if not match:
        # Fallback to search for raw JSON array
        match = re.search(r'\[\[.*\]\]', html, re.DOTALL)
        if not match:
            return None
    
    try:
        raw_json = unescape(match.group(1).strip() if match.lastindex >= 1 else match.group(0))
        return json.loads(raw_json)
    except Exception as e:
        print(f"Failed to parse Nuxt JSON: {e}", file=sys.stderr)
        return None

def extract_episodes(nuxt_data):
    """Resolves the episode objects list and their thumbnails from parsed Nuxt data."""
    resolver = resolve_nuxt_references(nuxt_data)
    
    episode_list = []
    # Search for an object that has the 'list' attribute
    for item in nuxt_data:
        if isinstance(item, dict) and "list" in item:
            resolved_list = resolver(item["list"])
            if isinstance(resolved_list, list):
                episode_list = resolved_list
                break
                
    # Scanning fallback if no direct 'list' attribute found
    if not episode_list:
        for item in nuxt_data:
            if isinstance(item, list) and len(item) > 0:
                first = resolver(item[0])
                if isinstance(first, dict) and ("snapshot_url" in first or "filepath" in first):
                    episode_list = item
                    break

    if not episode_list:
        return []

    episodes = []
    for idx in episode_list:
        ep = resolver(idx)
        if isinstance(ep, dict):
            name = resolver(ep.get("name"))
            snapshot_url = resolver(ep.get("snapshot_url"))
            sort = resolver(ep.get("sort"))
            
            if name and snapshot_url:
                ep_info = {
                    "name": name,
                    "sort": sort,
                    "snapshot_url": snapshot_url.replace('\\/', '/') if isinstance(snapshot_url, str) else ""
                }
                episodes.append(ep_info)
                
    # Sort episodes by their sequence number
    episodes.sort(key=lambda x: x["sort"] if isinstance(x["sort"], int) else 9999)
    return episodes

def deduce_m3u8_links(episodes):
    """Deduces the m3u8 URLs by extracting the hash from thumbnail URLs."""
    results = []
    for ep in episodes:
        name = ep["name"]
        snapshot_url = ep["snapshot_url"]
        
        # Generically match: .../thumbnail_{hash}.jpg
        # Extract the path prefix (after the domain) and the hash string
        match = re.search(r'https?://[^/]+(.*?)/thumbnail_([a-f0-9]+)\.jpg', snapshot_url)
        if match:
            path_prefix = match.group(1)
            hash_str = match.group(2)
            
            # Reconstruct the video m3u8 link using the CDN domain and the prefix path
            m3u8_url = f"https://cf-v.stardust-tv.com{path_prefix}/{hash_str}.m3u8"
            results.append({
                "name": name,
                "m3u8": m3u8_url
            })
    return results

def main():
    if len(sys.argv) < 2:
        print("Usage: python stardust_parser.py <StardustTV_Drama_URL>")
        print("Example: python stardust_parser.py \"https://www.stardusttv.net/zh-Hant/full-episodes/%E8%A9%AD%E7%95%B0%E6%99%82%E4%BB%A3-%E6%88%91%E9%9D%A0%E7%B3%BB%E7%B5%B1%E9%A6%AD%E8%A9%AD%E6%B1%82%E7%94%9F-19508\"")
        sys.exit(1)
        
    url = sys.argv[1]
    print(f"[*] Fetching HTML from: {url}...")
    html = fetch_html(url)
    if not html:
        print("[-] Failed to retrieve HTML.")
        sys.exit(1)
        
    print("[*] Parsing Nuxt serialized data...")
    nuxt_data = parse_stardust_nuxt_data(html)
    if not nuxt_data:
        print("[-] Could not find Nuxt serialization data block.")
        sys.exit(1)
        
    print("[*] Extracting episode lists...")
    episodes = extract_episodes(nuxt_data)
    if not episodes:
        print("[-] No episodes found in the page data.")
        sys.exit(1)
        
    print(f"[+] Found {len(episodes)} episodes! Deducing play links...")
    deduced = deduce_m3u8_links(episodes)
    
    # Output to console
    print("\n" + "="*80)
    print(f"{'Episode Name':<15} | {'Deduced M3U8 Play Link'}")
    print("="*80)
    for item in deduced:
        print(f"{item['name']:<15} | {item['m3u8']}")
    print("="*80)
    
    # Save output to a text file
    output_filename = "deduced_m3u8_links.txt"
    try:
        with open(output_filename, "w", encoding="utf-8") as f_out:
            for item in deduced:
                f_out.write(f"{item['name']}: {item['m3u8']}\n")
        print(f"\n[+] Success! All links have been saved to '{output_filename}'")
    except Exception as e:
        print(f"[-] Error saving file: {e}")

if __name__ == "__main__":
    main()
