#!/usr/bin/env python3
"""
Update dashboard-data.js from YouTube Data API results.

This script is intentionally conservative:
- it never stores the API key;
- it preserves manual review records from data/manual-review.json;
- it updates mutable public metadata for known videos;
- newly discovered videos are added as review candidates, not promoted to S/A.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_JS = ROOT / "data" / "dashboard-data.js"
MANUAL_REVIEW = ROOT / "data" / "manual-review.json"
SOURCES = ROOT / "config" / "sources.json"
AUTOMATION_CONFIG = ROOT / "data" / "automation-config.js"
YOUTUBE_API = "https://www.googleapis.com/youtube/v3"


class YouTubeRateLimitError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lookback-days", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def load_dashboard() -> dict:
    text = DATA_JS.read_text(encoding="utf-8")
    prefix = "window.DASHBOARD_DATA = "
    if not text.startswith(prefix):
        raise ValueError(f"{DATA_JS} does not start with {prefix!r}")
    payload = text[len(prefix):].strip()
    if payload.endswith(";"):
        payload = payload[:-1]
    return json.loads(payload)


def save_dashboard(data: dict) -> None:
    DATA_JS.write_text(
        "window.DASHBOARD_DATA = "
        + json.dumps(data, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def youtube_get(endpoint: str, params: dict, api_key: str) -> dict:
    query = dict(params)
    query["key"] = api_key
    url = f"{YOUTUBE_API}/{endpoint}?{urllib.parse.urlencode(query)}"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            if error.code == 429:
                if attempt < 2:
                    wait_seconds = 20 * (attempt + 1)
                    print(f"YouTube API returned 429. Waiting {wait_seconds}s before retry {attempt + 2}/3.", file=sys.stderr)
                    time.sleep(wait_seconds)
                    continue
                raise YouTubeRateLimitError(
                    "YouTube API returned HTTP 429 Too Many Requests. "
                    "The run was stopped before writing partial data. "
                    f"Response: {body[:500]}"
                ) from error
            raise


def iso_after(days: int) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    return (now - dt.timedelta(days=days)).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def search_video_ids(api_key: str, sources: dict, lookback_days: int) -> list[str]:
    published_after = iso_after(lookback_days)
    max_results = min(int(sources.get("maxResultsPerQuery", 15)), 50)
    max_queries = int(sources.get("maxQueriesPerRun", 30))
    ids: list[str] = []

    for query in sources.get("searchQueries", [])[:max_queries]:
        payload = youtube_get(
            "search",
            {
                "part": "snippet",
                "type": "video",
                "order": "date",
                "publishedAfter": published_after,
                "maxResults": max_results,
                "q": query,
            },
            api_key,
        )
        ids.extend(item["id"]["videoId"] for item in payload.get("items", []) if item.get("id", {}).get("videoId"))
        time.sleep(1.2)

    channel_max = min(int(sources.get("maxChannelResults", 15)), 50)
    for channel_id in sources.get("channelIds", []):
        payload = youtube_get(
            "search",
            {
                "part": "snippet",
                "type": "video",
                "order": "date",
                "publishedAfter": published_after,
                "maxResults": channel_max,
                "channelId": channel_id,
            },
            api_key,
        )
        ids.extend(item["id"]["videoId"] for item in payload.get("items", []) if item.get("id", {}).get("videoId"))
        time.sleep(1.2)

    return sorted(set(ids))


def fetch_video_details(api_key: str, video_ids: list[str]) -> list[dict]:
    results: list[dict] = []
    for i in range(0, len(video_ids), 50):
        chunk = video_ids[i : i + 50]
        payload = youtube_get(
            "videos",
            {
                "part": "snippet,statistics,contentDetails",
                "id": ",".join(chunk),
                "maxResults": 50,
            },
            api_key,
        )
        results.extend(payload.get("items", []))
        time.sleep(1.2)
    return results


def parse_duration_minutes(value: str | None) -> float | None:
    if not value:
        return None
    match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", value)
    if not match:
        return None
    hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return round(hours * 60 + minutes + seconds / 60, 2)


def text_blob(video: dict) -> str:
    snippet = video.get("snippet", {})
    return " ".join([snippet.get("title", ""), snippet.get("description", "")]).lower()


def infer_candidate_record(video: dict) -> dict:
    snippet = video.get("snippet", {})
    stats = video.get("statistics", {})
    content = video.get("contentDetails", {})
    video_id = video["id"]
    blob = text_blob(video)
    title = snippet.get("title", "")
    description = re.sub(r"\s+", " ", snippet.get("description", "")).strip()

    competitor_terms = ["meshy", "tripo", "hunyuan", "rodin", "luma", "sloyd", "kaedim", "csm", "scenario"]
    workflow_terms = ["workflow", "pipeline", "blender", "unity", "unreal", "game asset", "3d printing", "stl"]
    review_terms = ["review", "comparison", " vs ", "tested", "best"]

    competitor_hits = sum(term in blob for term in competitor_terms)
    workflow_hits = sum(term in blob for term in workflow_terms)
    review_hits = sum(term in blob for term in review_terms)

    if competitor_hits:
        bucket = "Competitor Intelligence"
        validated_use = "Competitor Signal"
    elif workflow_hits:
        bucket = "Workflow / Use Case"
        validated_use = "Workflow / Scenario Signal"
    else:
        bucket = "Core AI 3D Knowledge"
        validated_use = "AI 3D Signal"

    if review_hits:
        content_format = "comparison" if " vs " in blob or "comparison" in blob else "review"
    elif workflow_hits:
        content_format = "workflow_or_case"
    else:
        content_format = "general"

    duration = parse_duration_minutes(content.get("duration"))
    relevance = min(40, 22 + competitor_hits * 4 + workflow_hits * 2)
    strategic = min(30, 16 + competitor_hits * 3 + workflow_hits * 2 + review_hits * 2)
    market = 8
    score = round(relevance + strategic + market, 1)
    tier = "B" if score >= 70 else "C"
    suggestion = infer_review_suggestion(
        bucket=bucket,
        tier=tier,
        score=score,
        competitor_hits=competitor_hits,
        workflow_hits=workflow_hits,
        review_hits=review_hits,
        duration=duration,
    )

    return {
        "id": video_id,
        "addedByAutomation": True,
        "addedAt": dt.datetime.now(dt.timezone.utc).date().isoformat(),
        "manualStatus": "unreviewed",
        "manualReviewer": "",
        "manualReviewedAt": "",
        "manualNote": "",
        "score": score,
        "tier": tier,
        "bucket": bucket,
        "role": "Workflow Case" if bucket != "Competitor Intelligence" else "Competitor Reference",
        "priority": "Medium" if tier == "B" else "Low",
        "priorityReason": "自动新增候选，待人工复核",
        "reviewLane": suggestion["reviewLane"],
        "suggestedAction": suggestion["suggestedAction"],
        "suggestedBucket": suggestion["suggestedBucket"],
        "suggestedTier": suggestion["suggestedTier"],
        "suggestedReason": suggestion["suggestedReason"],
        "reviewConfidence": suggestion["reviewConfidence"],
        "action": "Review newly discovered resource",
        "validatedUse": validated_use,
        "qualityGate": "pass",
        "qualityReason": "",
        "spamFlag": False,
        "spamReason": "",
        "relevance": relevance,
        "strategicValue": strategic,
        "marketSignal": market,
        "format": content_format,
        "heat": 0,
        "velocityScore": 0,
        "velocity": 0,
        "discovery": 0,
        "queryDiversity": 0,
        "channelScore": 0,
        "recency": 4,
        "ageDays": None,
        "screening": "Auto-Review",
        "searchStrength": "Scheduled update",
        "matchedQueryCount": 0,
        "matchedQueries": "",
        "matchedGroups": "",
        "sourceRounds": "scheduled",
        "watchStatus": "Review",
        "topicGroup": "scheduled",
        "title": title,
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "channel": snippet.get("channelTitle", ""),
        "channelUrl": f"https://www.youtube.com/channel/{snippet.get('channelId', '')}",
        "publishedAt": snippet.get("publishedAt", ""),
        "views": int(stats.get("viewCount", 0) or 0),
        "comments": int(stats.get("commentCount", 0) or 0),
        "duration": duration,
        "description": description[:420] + ("..." if len(description) > 420 else ""),
        "keywordHits": "",
        "thumbnail": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg",
        "hitCounts": {
            "coreAI3D": 1 if "3d" in blob else 0,
            "workflow": workflow_hits,
            "competitor": competitor_hits,
            "evaluation": review_hits,
            "adjacentAI": 1 if "ai" in blob else 0,
            "noise": 0,
        },
    }


def infer_review_suggestion(
    *,
    bucket: str,
    tier: str,
    score: float,
    competitor_hits: int,
    workflow_hits: int,
    review_hits: int,
    duration: float | None,
) -> dict:
    strong_topic_signal = competitor_hits > 0 or workflow_hits >= 2 or review_hits > 0
    weak_or_short = duration is not None and duration < 2.5 and not strong_topic_signal

    if weak_or_short:
        review_lane = "archive_candidate"
        suggested_action = "建议归档"
        suggested_tier = "Archive"
        confidence = "medium"
        reason = "时长较短且没有明显竞品、工作流或评测信号，可先不进入主库。"
    elif score >= 70 and strong_topic_signal:
        review_lane = "high_priority"
        suggested_action = "优先人工确认"
        suggested_tier = tier
        confidence = "high"
        reason = "分数达到 B 级及以上，并命中竞品、工作流或评测信号。"
    elif strong_topic_signal or score >= 58:
        review_lane = "needs_review"
        suggested_action = "人工快速判断"
        suggested_tier = tier
        confidence = "medium"
        reason = "存在可用信号，但需要人工判断是否值得正式收录。"
    else:
        review_lane = "low_priority"
        suggested_action = "低优先观察"
        suggested_tier = "C"
        confidence = "low"
        reason = "相关性较弱，建议保留在候选池，暂不占用本周审核时间。"

    if bucket == "Competitor Intelligence":
        suggested_bucket = "竞品相关"
    elif "Workflow" in bucket or "Use Case" in bucket:
        suggested_bucket = "工作流相关"
    else:
        suggested_bucket = "AI 3D 基础知识"

    return {
        "reviewLane": review_lane,
        "suggestedAction": suggested_action,
        "suggestedBucket": suggested_bucket,
        "suggestedTier": suggested_tier,
        "suggestedReason": reason,
        "reviewConfidence": confidence,
    }


def update_public_metadata(existing: dict, video: dict) -> None:
    snippet = video.get("snippet", {})
    stats = video.get("statistics", {})
    content = video.get("contentDetails", {})
    existing["title"] = snippet.get("title", existing.get("title", ""))
    existing["channel"] = snippet.get("channelTitle", existing.get("channel", ""))
    existing["publishedAt"] = snippet.get("publishedAt", existing.get("publishedAt", ""))
    existing["views"] = int(stats.get("viewCount", existing.get("views", 0)) or 0)
    existing["comments"] = int(stats.get("commentCount", existing.get("comments", 0)) or 0)
    duration = parse_duration_minutes(content.get("duration"))
    if duration is not None:
        existing["duration"] = duration


def apply_manual_review(video: dict, manual: dict) -> None:
    review = manual.get(video.get("id"))
    if not review:
        return
    video["manualStatus"] = review.get("manualStatus", "")
    video["manualReviewer"] = review.get("reviewer", "")
    video["manualReviewedAt"] = review.get("reviewedAt", "")
    video["manualNote"] = review.get("note", "")
    if review.get("tierOverride"):
        video["tier"] = review["tierOverride"]
    if review.get("priorityOverride"):
        video["priority"] = review["priorityOverride"]
    if review.get("roleOverride"):
        video["role"] = review["roleOverride"]


def rebuild_summaries(data: dict) -> None:
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    videos = data["videos"]
    metrics = data.setdefault("metrics", {})
    metrics["total_scored_videos"] = len(videos)
    for tier in ["S", "A", "B", "C", "Archive"]:
        metrics[f"{tier}_tier_count" if tier != "Archive" else "Archive_count"] = sum(v.get("tier") == tier for v in videos)
    metrics["High_current_intelligence_count"] = sum(v.get("priority") == "High" for v in videos)
    metrics["metadata_spam_flag_count"] = sum(bool(v.get("spamFlag")) for v in videos)
    metrics["quality_gate_blocked_count"] = sum(v.get("qualityGate") in {"hard_exclude", "limit_to_B"} for v in videos)
    scores = [float(v.get("score") or 0) for v in videos]
    metrics["average_score"] = round(sum(scores) / max(len(scores), 1), 2)
    metrics["max_score"] = max(scores) if scores else 0
    metrics["last_score_run_at"] = now
    metrics["last_auto_update"] = now

    def counts(field: str) -> list[dict]:
        result: dict[str, int] = {}
        for video in videos:
            label = str(video.get(field) or "Unknown")
            result[label] = result.get(label, 0) + 1
        return [{"label": label, "count": count} for label, count in sorted(result.items(), key=lambda item: item[1], reverse=True)]

    data["distributions"] = {
        "tier": counts("tier"),
        "bucket": counts("bucket"),
        "role": counts("role"),
        "priority": counts("priority"),
        "format": counts("format"),
        "qualityGate": counts("qualityGate"),
        "validatedUse": counts("validatedUse"),
        "watchStatus": counts("watchStatus"),
        "screening": counts("screening"),
    }

    channels: dict[str, dict] = {}
    for video in videos:
        if video.get("tier") not in {"S", "A"}:
            continue
        channel = video.get("channel") or "Unknown"
        item = channels.setdefault(channel, {"channel_title": channel, "count": 0, "avgScore": 0, "topScore": 0, "views": 0})
        item["count"] += 1
        item["avgScore"] += float(video.get("score") or 0)
        item["topScore"] = max(item["topScore"], float(video.get("score") or 0))
        item["views"] += int(video.get("views") or 0)
    for item in channels.values():
        item["avgScore"] = round(item["avgScore"] / max(item["count"], 1), 1)
    data["topChannels"] = sorted(channels.values(), key=lambda item: (item["count"], item["topScore"]), reverse=True)[:16]


def update_automation_config() -> None:
    text = AUTOMATION_CONFIG.read_text(encoding="utf-8")
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    today = now.date().isoformat()
    timestamp = now.isoformat().replace("+00:00", "Z")
    text = re.sub(r'lastSourceUpdate: "[^"]+"', f'lastSourceUpdate: "{today}"', text)
    if re.search(r'lastAutomationRunAt: "[^"]*"', text):
        text = re.sub(r'lastAutomationRunAt: "[^"]*"', f'lastAutomationRunAt: "{timestamp}"', text)
    else:
        text = re.sub(r'(lastSourceUpdate: "[^"]+",)', f'\\1\\n  lastAutomationRunAt: "{timestamp}",', text)
    text = re.sub(r'plannedCadence: "[^"]+"', 'plannedCadence: "GitHub Actions 每周自动更新"', text)
    text = re.sub(r'statusLabel: "[^"]+"', 'statusLabel: "GitHub 自动更新"', text)
    AUTOMATION_CONFIG.write_text(text, encoding="utf-8")


def main() -> int:
    args = parse_args()
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        print("YOUTUBE_API_KEY is not set. Add it as a GitHub Actions secret.", file=sys.stderr)
        return 2

    data = load_dashboard()
    manual = load_json(MANUAL_REVIEW)
    sources = load_json(SOURCES)
    lookback_days = args.lookback_days or int(sources.get("lookbackDays", 14))

    try:
        discovered_ids = search_video_ids(api_key, sources, lookback_days)
        details = fetch_video_details(api_key, discovered_ids)
    except YouTubeRateLimitError as error:
        print(str(error), file=sys.stderr)
        print("No dashboard files were changed. Try again later or reduce maxQueriesPerRun in config/sources.json.", file=sys.stderr)
        return 0
    existing_by_id = {video["id"]: video for video in data["videos"]}
    new_count = 0

    for detail in details:
        video_id = detail["id"]
        if video_id in existing_by_id:
            update_public_metadata(existing_by_id[video_id], detail)
        else:
            record = infer_candidate_record(detail)
            data["videos"].append(record)
            existing_by_id[video_id] = record
            new_count += 1

    for video in data["videos"]:
        apply_manual_review(video, manual)

    rebuild_summaries(data)
    data["generatedAt"] = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    print(f"Discovered {len(discovered_ids)} ids; added {new_count} new videos; total {len(data['videos'])}.")
    if not args.dry_run:
        save_dashboard(data)
        update_automation_config()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
