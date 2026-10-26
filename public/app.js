import { TOPICS, buildQuery, groupByTopic, scoreClass, lastRefreshed, formatDate, safeUrl, timeAgo } from "./lib.js";

const API = "https://news-app-backend.tom-dyar.workers.dev";

const $ = (id) => document.getElementById(id);
const els = {
	topic: $("f-topic"), score: $("f-score"), limit: $("f-limit"),
	refresh: $("refresh"), refreshLabel: $("refresh-label"), last: $("last-refreshed"),
	count: $("result-count"), status: $("status"), content: $("content"),
};

function el(tag, props = {}, ...children) {
	const node = Object.assign(document.createElement(tag), props);
	node.append(...children);
	return node;
}

function fillSelect(select, options, selected) {
	select.replaceChildren(...options.map(([value, text]) => el("option", { value, textContent: text, selected: String(value) === String(selected) })));
}

fillSelect(els.topic, [["", "All topics"], ...TOPICS.map((t) => [t.id, t.title])], "");
fillSelect(els.score, [["0", "Any score"], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), `${i + 1}+`])], "0");
fillSelect(els.limit, [10, 25, 50, 100].map((n) => [String(n), String(n)]), "50");

function plural(n, word) {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function setStatus(message, kind = "") {
	els.status.hidden = !message;
	els.status.textContent = message ?? "";
	els.status.className = `status ${kind}`.trim();
}

function renderCard(a) {
	const score = a.relevance_score;
	const scored = score != null;
	return el("article", { className: "card" },
		el("h3", {}, el("a", { href: safeUrl(a.url), target: "_blank", rel: "noopener noreferrer", textContent: a.headline })),
		el("div", { className: "badge " + scoreClass(score), title: scored ? `Relevance ${score} out of 10` : "Not scored" },
			...(scored ? [String(score), el("small", { textContent: "/10" })] : ["–"])),
		el("div", { className: "byline" }, a.source, el("span", { className: "sep", textContent: "·" }), formatDate(a.published_at)),
		a.summary ? el("p", { className: "summary", textContent: a.summary }) : "",
	);
}

function render(articles) {
	const groups = groupByTopic(articles);
	els.count.textContent = plural(articles.length, "article");
	if (groups.length === 0) {
		els.content.replaceChildren(el("div", { className: "empty", textContent: "No articles match these filters." }));
		return;
	}
	els.content.replaceChildren(...groups.map((g) =>
		el("section", { className: "topic-group" },
			el("h2", {}, g.title, el("span", { className: "n", textContent: plural(g.articles.length, "article") })),
			...g.articles.map(renderCard))));
}

function showSkeleton() {
	els.content.replaceChildren(...Array.from({ length: 4 }, () => el("div", { className: "skeleton" })));
}

let lastFetched = null;
function showLastRefreshed() {
	els.last.textContent = lastFetched ? `Last refreshed ${timeAgo(lastFetched)} · ${lastFetched.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : "No data yet";
}

async function loadAll() {
	// "Last refreshed" reflects the newest fetch in the whole database, independent of the filters.
	const res = await fetch(`${API}/articles?limit=200`);
	if (res.ok) lastFetched = lastRefreshed((await res.json()).articles);
	showLastRefreshed();
}

let loadSeq = 0;
async function loadArticles({ skeleton = true } = {}) {
	const seq = ++loadSeq;
	if (skeleton) showSkeleton();
	try {
		const query = buildQuery({ topic: els.topic.value, minScore: els.score.value, limit: els.limit.value });
		const res = await fetch(`${API}/articles?${query}`);
		if (!res.ok) throw new Error(`The API returned ${res.status}`);
		const data = await res.json();
		if (seq !== loadSeq) return; // a newer request superseded this one
		setStatus(null);
		render(data.articles);
	} catch (err) {
		if (seq !== loadSeq) return;
		els.content.replaceChildren();
		els.count.textContent = "";
		setStatus(`Couldn't load articles: ${err.message}. Try Refresh or reload the page.`, "error");
	}
}

for (const select of [els.topic, els.score, els.limit]) select.addEventListener("change", () => loadArticles());

els.refresh.addEventListener("click", async () => {
	els.refresh.disabled = true;
	els.refresh.classList.add("loading");
	els.refreshLabel.textContent = "Refreshing…";
	setStatus("Searching the web for new articles on each topic. This usually takes 30–90 seconds.");
	try {
		const res = await fetch(`${API}/agent`, { method: "POST" });
		if (!res.ok) throw new Error(`The agent returned ${res.status}`);
		const run = await res.json();
		await Promise.all([loadArticles({ skeleton: false }), loadAll()]);
		const failed = run.topics.filter((t) => t.error).length;
		setStatus(
			`Refresh complete: ${plural(run.inserted, "new article")} added, ${run.skipped} already known.` + (failed ? ` ${plural(failed, "topic")} failed.` : ""),
			failed ? "error" : "ok",
		);
	} catch (err) {
		setStatus(`Refresh failed: ${err.message}`, "error");
	} finally {
		els.refresh.disabled = false;
		els.refresh.classList.remove("loading");
		els.refreshLabel.textContent = "Refresh";
	}
});

setInterval(showLastRefreshed, 60_000);
loadArticles();
loadAll().catch(() => {});
