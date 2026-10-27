import { API } from "./config.js";
import { caretHost, renderMarkdown } from "./chat-render.js";
import { el, icon } from "./dom.js";
import { CHAT_MODELS, authHeaders, buildHistory, chatErrorMessage, describeEntry, formatCount, hoodEntry, modelLabel, plural, safeUrl, sumEntries, usageChips } from "./lib.js";
import { getPassword, rememberPassword } from "./password.js";
import { parseSse } from "./sse.js";

const $ = (id) => document.getElementById(id);
const panel = $("chat-panel");
const log = $("chat-log");
const form = $("chat-form");
const input = $("chat-input");
const sendBtn = $("chat-send");
const modelSelect = $("chat-model");
const toggleBtn = $("chat-toggle");
const webToggle = $("chat-web");
const hoodBadge = $("hood-badge");
const hoodList = $("hood-list");
const hoodEmpty = $("hood-empty");
const hoodTotal = $("hood-total");

const MODEL_KEY = "news-chat-model";
const WEB_KEY = "news-chat-web";
const SUGGESTIONS = [
	"What are the most serious cybersecurity incidents right now?",
	"Summarize the latest AI advances in healthcare.",
	"Are there any new legal rulings or enforcement actions?",
];

// ---- Transport -------------------------------------------------------------------------------------------------
// The only code that knows how answers arrive (an SSE stream from POST /chat). Swapping the transport later
// means replacing this function; the UI below only sees onOpen / onMeta / onDelta / onDone / onError.

class ChatHttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

async function streamChat({ question, model, history, webSearch, password, signal, onOpen, onMeta, onSearch, onWebSources, onDelta, onDone, onError }) {
	let res;
	try {
		res = await fetch(`${API}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...authHeaders(password) },
			body: JSON.stringify({ question, model, history, web_search: webSearch }),
			signal,
		});
	} catch (err) {
		if (err.name === "AbortError") throw err;
		throw new ChatHttpError(0, chatErrorMessage(0));
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new ChatHttpError(res.status, chatErrorMessage(res.status, body.error));
	}
	onOpen();

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		const parsed = parseSse(buffer + decoder.decode(value, { stream: true }));
		buffer = parsed.rest;
		for (const { event, data } of parsed.events) {
			if (event === "meta") onMeta(data);
			else if (event === "search") onSearch(data.query);
			else if (event === "web_sources") onWebSources(data.sources);
			else if (event === "delta") onDelta(data.text);
			else if (event === "done") onDone(data);
			else if (event === "error") onError(data.message);
		}
	}
}

// ---- Conversation state ----------------------------------------------------------------------------------------

const turns = []; // completed exchanges only: [{ role, content }, ...]
let controller = null;
let stickToBottom = true;

log.addEventListener("scroll", () => {
	stickToBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
});
const scrollDown = () => {
	if (stickToBottom) log.scrollTop = log.scrollHeight;
};

function setBusy(busy) {
	sendBtn.classList.toggle("stop", busy);
	sendBtn.replaceChildren(icon(busy ? "stop" : "send"), el("span", { textContent: busy ? "Stop" : "Send" }));
	sendBtn.setAttribute("aria-label", busy ? "Stop generating" : "Send message");
}

// ---- Message views ---------------------------------------------------------------------------------------------

function statusView(kind, label) {
	if (kind === "waiting") {
		return el("div", { className: "chat-status searching" }, el("span", { className: "pulse" }, icon("search")), el("span", { className: "label", textContent: label }), el("span", { className: "dots" }, el("i"), el("i"), el("i")));
	}
	return el("div", { className: "chat-status writing" }, icon("spark", "twinkle"), el("span", { className: "label", textContent: label }));
}

function addUser(text) {
	log.append(el("div", { className: "msg user" }, el("div", { className: "bubble", textContent: text })));
}

function addAssistant() {
	const status = el("div");
	const body = el("div", { className: "msg-body md" });
	const extras = el("div", { className: "msg-extras" });
	const root = el("div", { className: "msg assistant" }, el("div", { className: "avatar" }, icon("spark")), el("div", { className: "content" }, status, body, extras));
	log.append(root);
	return { root, status, body, extras };
}

function showSources(view, sources) {
	if (!sources.length) return;
	view.extras.append(
		el(
			"details",
			{ className: "sources" },
			el("summary", { textContent: `Sources (${sources.length})` }),
			el("ol", {}, ...sources.map((s) => el("li", {}, el("a", { href: safeUrl(s.url), target: "_blank", rel: "noopener noreferrer", textContent: s.headline }), el("span", { className: "src-meta", textContent: ` ${s.source} · ${s.published_at}` })))),
		),
	);
}

function showWebSources(view, webSources) {
	const unique = [...new Map(webSources.map((s) => [s.url, s])).values()];
	if (!unique.length) return;
	view.extras.append(
		el(
			"details",
			{ className: "sources web" },
			el("summary", { textContent: `Web sources (${unique.length})` }),
			el("ol", {}, ...unique.map((s) => el("li", {}, el("a", { href: safeUrl(s.url), target: "_blank", rel: "noopener noreferrer", textContent: s.title || s.url }), el("span", { className: "src-meta", textContent: ` ${hostOf(s.url)}` })))),
		),
	);
}

function hostOf(url) {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

function showUsage(view, entry) {
	view.extras.append(
		el(
			"div",
			{ className: "usage", title: "Tokens used by this response" },
			el("span", { className: "usage-model", textContent: modelLabel(entry.model) }),
			...usageChips(entry).map((c) => el("span", { className: `chip ${c.label === "total" ? "strong" : ""}`.trim() }, el("b", { textContent: c.value }), ` ${c.label}`)),
		),
	);
}

// ---- Under the hood ---------------------------------------------------------------------------------------------

const hoodEntries = []; // one per completed response in this conversation

function hoodItem(entry, number, latest) {
	const lines = describeEntry(entry);
	const row = (label, text) => [el("dt", { textContent: label }), el("dd", { textContent: text })];
	return el(
		"li",
		{ className: `hood-item${latest ? " latest" : ""}` },
		el("div", { className: "hood-item-head" }, el("strong", { textContent: `Response ${number}` }), el("span", { className: "meta", textContent: ` · ${modelLabel(entry.model)}` })),
		el("dl", {}, ...row("Database", lines.database), ...row("Tokens", lines.tokens), ...row("Web search", lines.web)),
	);
}

function renderHood() {
	hoodList.replaceChildren(...hoodEntries.map((e, i) => hoodItem(e, i + 1, i === hoodEntries.length - 1)).reverse());
	hoodEmpty.hidden = hoodEntries.length > 0;
	const t = sumEntries(hoodEntries);
	hoodTotal.hidden = t.responses === 0;
	let total = "";
	if (t.responses) {
		total = `Conversation total: ${formatCount(t.totalTokens)} tokens (${formatCount(t.inputTokens)} in · ${formatCount(t.outputTokens)} out) across ${plural(t.responses, "response")}`;
		if (t.searches) total += ` · ${t.searches} web ${t.searches === 1 ? "search" : "searches"}`;
	}
	hoodTotal.textContent = total;
}

function updateHoodBadge() {
	hoodBadge.textContent = webToggle.checked ? "Web search on" : "Web search off";
	hoodBadge.classList.toggle("on", webToggle.checked);
}

function showNote(view, text, kind = "") {
	view.extras.append(el("p", { className: `note ${kind}`.trim(), textContent: text }));
}

// ---- Sending ---------------------------------------------------------------------------------------------------

async function send(question) {
	if (controller) return;
	const password = await getPassword("Enter the password to chat. It is saved in this browser only.");
	if (!password) return;

	log.querySelector(".empty")?.remove();
	stickToBottom = true;
	addUser(question);
	const view = addAssistant();
	view.status.replaceWith((view.status = statusView("waiting", "Finding relevant articles")));
	scrollDown();

	controller = new AbortController();
	setBusy(true);
	input.value = "";
	autosize();

	let text = "";
	let sources = [];
	let meta = null;
	let webSources = [];
	const queries = [];
	let done = null;
	let streamError = null;
	let frame = 0;
	let generating = false;

	const render = () => {
		frame = 0;
		view.body.replaceChildren(...renderMarkdown(text, sources));
		if (!done) caretHost(view.body).append(el("span", { className: "caret" }));
		scrollDown();
	};

	try {
		await streamChat({
			question,
			model: modelSelect.value,
			history: buildHistory(turns),
			webSearch: webToggle.checked,
			password,
			signal: controller.signal,
			onOpen: () => rememberPassword(password),
			onMeta: (m) => {
				meta = m;
				sources = m.sources;
				if (!generating) view.status.querySelector(".label").textContent = sources.length ? `Reading ${plural(sources.length, "article")}` : "Thinking";
			},
			onSearch: (query) => {
				queries.push(query);
				generating = false; // searches can happen between pieces of text; the next text flips the status back to "Writing"
				view.status.replaceWith((view.status = statusView("waiting", `Searching the web: “${query}”`)));
			},
			onWebSources: (found) => webSources.push(...found),
			onDelta: (chunk) => {
				if (!generating) {
					generating = true;
					view.status.replaceWith((view.status = statusView("writing", "Writing")));
				}
				text += chunk;
				frame ||= requestAnimationFrame(render);
			},
			onDone: (d) => (done = d),
			onError: (message) => (streamError = message),
		});
	} catch (err) {
		cancelAnimationFrame(frame);
		view.status.remove();
		if (err.name === "AbortError") {
			render();
			view.body.querySelector(".caret")?.remove();
			showNote(view, "Stopped.");
		} else {
			if (err.status === 401) rememberPassword("");
			input.value = question; // keep what they typed so it can be re-sent
			autosize();
			showNote(view, err instanceof ChatHttpError ? err.message : chatErrorMessage(502), "error");
			if (!text) view.body.remove();
			else render();
		}
		return finish();
	}

	cancelAnimationFrame(frame);
	view.status.remove();
	render();
	showSources(view, sources);
	showWebSources(view, webSources);
	if (streamError) showNote(view, `${streamError} The answer above may be incomplete.`, "error");
	if (done?.stopReason === "refusal") showNote(view, "The assistant declined to answer that question.", "error");
	else if (done?.stopReason === "max_tokens") showNote(view, "The answer was cut off because it reached the length limit.");
	if (done) {
		const entry = hoodEntry(meta, done, webSources, queries);
		showUsage(view, entry);
		hoodEntries.push(entry);
		renderHood();
	}
	if (text && done && !streamError && done.stopReason !== "refusal") turns.push({ role: "user", content: question }, { role: "assistant", content: text });
	finish();

	function finish() {
		controller = null;
		setBusy(false);
		scrollDown();
		if (panel.classList.contains("open")) input.focus();
	}
}

// ---- Panel wiring ----------------------------------------------------------------------------------------------

function showEmptyState() {
	log.replaceChildren(
		el(
			"div",
			{ className: "empty" },
			icon("spark", "twinkle big"),
			el("h3", { textContent: "Ask about the news" }),
			el("p", { className: "meta", textContent: "Answers draw on the articles collected on this dashboard, and on the web if you switch it on." }),
			...SUGGESTIONS.map((q) => el("button", { type: "button", className: "suggestion", textContent: q, onclick: () => send(q) })),
		),
	);
}

function openPanel(open) {
	panel.classList.toggle("open", open);
	panel.inert = !open;
	toggleBtn.setAttribute("aria-expanded", String(open));
	if (open) input.focus();
	else toggleBtn.focus();
}

function autosize() {
	input.style.height = "auto";
	input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
}

fillModels();
function fillModels() {
	let saved = "";
	try {
		saved = localStorage.getItem(MODEL_KEY) || "";
	} catch {}
	const initial = CHAT_MODELS.some((m) => m.alias === saved) ? saved : "sonnet";
	modelSelect.replaceChildren(...CHAT_MODELS.map((m) => el("option", { value: m.alias, textContent: `${m.label} (${m.hint.split(":")[0].replace("Claude ", "")})`, title: m.hint, selected: m.alias === initial })));
}
modelSelect.addEventListener("change", () => {
	try {
		localStorage.setItem(MODEL_KEY, modelSelect.value);
	} catch {}
});

try {
	webToggle.checked = localStorage.getItem(WEB_KEY) === "1";
} catch {}
webToggle.addEventListener("change", () => {
	updateHoodBadge();
	try {
		localStorage.setItem(WEB_KEY, webToggle.checked ? "1" : "0");
	} catch {}
});
updateHoodBadge();
renderHood();

toggleBtn.addEventListener("click", () => openPanel(!panel.classList.contains("open")));
$("chat-close").addEventListener("click", () => openPanel(false));
panel.addEventListener("keydown", (e) => e.key === "Escape" && !e.defaultPrevented && openPanel(false));
$("chat-new").addEventListener("click", () => {
	controller?.abort();
	turns.length = 0;
	hoodEntries.length = 0;
	renderHood();
	showEmptyState();
});

form.addEventListener("submit", (e) => {
	e.preventDefault();
	if (controller) return controller.abort();
	const question = input.value.trim();
	if (question) send(question);
});
input.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
		e.preventDefault();
		form.requestSubmit();
	}
});
input.addEventListener("input", autosize);

panel.inert = true;
setBusy(false);
showEmptyState();
