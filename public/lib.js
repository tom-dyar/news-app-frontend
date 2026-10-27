// Pure helpers for the dashboard (no DOM) so they can be unit tested with `npm test`.

export const TOPICS = [
	{ id: "healthcare-cybersecurity", label: "cybersecurity in healthcare", title: "Cybersecurity in Healthcare" },
	{ id: "healthcare-ai", label: "AI advances in healthcare", title: "AI Advances in Healthcare" },
	{ id: "ai-healthcare-law", label: "law enforcement and legal rulings regarding AI and healthcare", title: "Law Enforcement & Legal Rulings: AI and Healthcare" },
];

export function buildQuery({ topic, minScore, limit }) {
	const p = new URLSearchParams();
	if (topic) p.set("topic", topic);
	if (Number(minScore) > 0) p.set("min_score", String(minScore));
	p.set("limit", String(limit));
	return p.toString();
}

/** Group articles by topic in TOPICS order (unknown topics last); empty groups are dropped. */
export function groupByTopic(articles) {
	const byLabel = new Map();
	for (const a of articles) {
		if (!byLabel.has(a.topic)) byLabel.set(a.topic, []);
		byLabel.get(a.topic).push(a);
	}
	const known = TOPICS.filter((t) => byLabel.has(t.label)).map((t) => ({ label: t.label, title: t.title, articles: byLabel.get(t.label) }));
	const unknown = [...byLabel.keys()].filter((l) => !TOPICS.some((t) => t.label === l)).map((l) => ({ label: l, title: l, articles: byLabel.get(l) }));
	return [...known, ...unknown];
}

export function scoreClass(score) {
	if (score == null) return "none";
	if (score >= 8) return "high";
	if (score >= 5) return "mid";
	return "low";
}

export function lastRefreshed(articles) {
	let newest = null;
	for (const a of articles) {
		const d = new Date(a.fetched_at);
		if (!Number.isNaN(d.getTime()) && (!newest || d > newest)) newest = d;
	}
	return newest;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-25" -> "Oct 25, 2026" (parsed by hand so the local timezone can't shift the day). */
export function formatDate(ymd) {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? "");
	return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : String(ymd ?? "");
}

export function safeUrl(u) {
	try {
		const url = new URL(u);
		return url.protocol === "http:" || url.protocol === "https:" ? url.href : "#";
	} catch {
		return "#";
	}
}

export function plural(n, word) {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function timeAgo(date, now = new Date()) {
	const s = Math.max(0, Math.round((now - date) / 1000));
	if (s < 60) return "just now";
	const units = [
		[86400, "day"],
		[3600, "hour"],
		[60, "minute"],
	];
	for (const [secs, name] of units) {
		if (s >= secs) {
			return `${plural(Math.floor(s / secs), name)} ago`;
		}
	}
}

/** Request headers carrying the refresh password; nothing when there is no password. */
export function authHeaders(password) {
	const pw = (password ?? "").trim();
	return pw ? { Authorization: `Bearer ${pw}` } : {};
}
