// The server's protected endpoints (refresh, chat) need a password. It is never part of this public page: the owner types it
// once, it is kept in this browser only, and is then sent automatically. A 401 from the server clears it.

const KEY = "news-refresh-password";

export function savedPassword() {
	try {
		return localStorage.getItem(KEY) || "";
	} catch {
		return "";
	}
}

export function rememberPassword(pw) {
	try {
		pw ? localStorage.setItem(KEY, pw) : localStorage.removeItem(KEY);
	} catch {
		// storage unavailable (private mode): the password just has to be entered again next time
	}
}

const dialog = document.getElementById("pw-dialog");
const input = document.getElementById("pw-input");
let pending = null;

/** Ask for the password; resolves to the trimmed text, or "" if cancelled. Concurrent callers share one dialog. */
export function askPassword(message) {
	if (pending) return pending;
	document.getElementById("pw-message").textContent = message;
	input.value = "";
	dialog.returnValue = "";
	dialog.showModal();
	input.focus();
	pending = new Promise((resolve) =>
		dialog.addEventListener(
			"close",
			() => {
				pending = null;
				resolve(dialog.returnValue === "ok" ? input.value.trim() : "");
			},
			{ once: true },
		),
	);
	return pending;
}

/** The saved password, or ask for it. */
export async function getPassword(message) {
	return savedPassword() || askPassword(message);
}

document.getElementById("pw-form").addEventListener("submit", (e) => {
	e.preventDefault();
	dialog.close("ok");
});
document.getElementById("pw-cancel").addEventListener("click", () => dialog.close("cancel"));
