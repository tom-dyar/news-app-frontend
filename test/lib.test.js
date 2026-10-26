import { test } from "node:test";
import assert from "node:assert/strict";
import { TOPICS, buildQuery, groupByTopic, scoreClass, lastRefreshed, formatDate, safeUrl, timeAgo } from "../public/lib.js";

const art = (over) => ({ id: 1, topic: TOPICS[0].label, headline: "h", source: "s", published_at: "2026-10-25", url: "https://x.test/1", summary: "sum", relevance_score: 7, fetched_at: "2026-10-26T20:00:00Z", ...over });

test("buildQuery includes only set filters", () => {
	assert.equal(buildQuery({ topic: "", minScore: "", limit: 50 }), "limit=50");
	assert.equal(buildQuery({ topic: "healthcare-ai", minScore: "6", limit: 25 }), "topic=healthcare-ai&min_score=6&limit=25");
	assert.equal(buildQuery({ topic: "", minScore: "0", limit: 10 }), "limit=10");
});

test("groupByTopic orders groups by TOPICS, keeps article order, drops empty groups", () => {
	const a = art({ id: 1, topic: TOPICS[2].label });
	const b = art({ id: 2, topic: TOPICS[0].label });
	const c = art({ id: 3, topic: TOPICS[0].label });
	const groups = groupByTopic([a, b, c]);
	assert.deepEqual(groups.map((g) => g.label), [TOPICS[0].label, TOPICS[2].label]);
	assert.deepEqual(groups[0].articles.map((x) => x.id), [2, 3]);
});

test("groupByTopic appends unknown topics at the end", () => {
	const groups = groupByTopic([art({ topic: "something new" }), art({ topic: TOPICS[1].label })]);
	assert.deepEqual(groups.map((g) => g.label), [TOPICS[1].label, "something new"]);
});

test("scoreClass buckets scores", () => {
	assert.equal(scoreClass(10), "high");
	assert.equal(scoreClass(8), "high");
	assert.equal(scoreClass(7), "mid");
	assert.equal(scoreClass(5), "mid");
	assert.equal(scoreClass(4), "low");
	assert.equal(scoreClass(1), "low");
	assert.equal(scoreClass(null), "none");
});

test("lastRefreshed returns the newest fetched_at, or null", () => {
	assert.equal(lastRefreshed([art({ fetched_at: "2026-10-25T10:00:00Z" }), art({ fetched_at: "2026-10-26T20:00:00Z" })]).toISOString(), "2026-10-26T20:00:00.000Z");
	assert.equal(lastRefreshed([]), null);
});

test("formatDate renders YYYY-MM-DD without timezone shifting", () => {
	assert.equal(formatDate("2026-10-25"), "Oct 25, 2026");
	assert.equal(formatDate("2026-01-01"), "Jan 1, 2026");
	assert.equal(formatDate("garbage"), "garbage");
});

test("safeUrl only allows http(s)", () => {
	assert.equal(safeUrl("https://a.test/x"), "https://a.test/x");
	assert.equal(safeUrl("javascript:alert(1)"), "#");
	assert.equal(safeUrl("not a url"), "#");
});

test("timeAgo", () => {
	const now = new Date("2026-10-26T12:00:00Z");
	assert.equal(timeAgo(new Date("2026-10-26T11:59:40Z"), now), "just now");
	assert.equal(timeAgo(new Date("2026-10-26T11:30:00Z"), now), "30 minutes ago");
	assert.equal(timeAgo(new Date("2026-10-26T11:00:00Z"), now), "1 hour ago");
	assert.equal(timeAgo(new Date("2026-10-25T09:00:00Z"), now), "1 day ago");
});

import { formatWait } from "../public/lib.js";

test("formatWait rounds up to whole minutes in friendly wording", () => {
	assert.equal(formatWait(5), "1 minute");
	assert.equal(formatWait(60), "1 minute");
	assert.equal(formatWait(61), "2 minutes");
	assert.equal(formatWait(1800), "30 minutes");
	assert.equal(formatWait(3599), "60 minutes");
});
