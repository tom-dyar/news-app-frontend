// Incremental parser for the Server-Sent Events the /chat endpoint streams.
// Feed it `leftover + newChunk`; it returns the complete events plus whatever partial event is left over.

export function parseSse(buffer) {
	const events = [];
	let rest = buffer;
	for (;;) {
		const boundary = /\r?\n\r?\n/.exec(rest);
		if (!boundary) break;
		const block = rest.slice(0, boundary.index);
		rest = rest.slice(boundary.index + boundary[0].length);

		let event = "message";
		const data = [];
		for (const line of block.split(/\r?\n/)) {
			if (line.startsWith(":")) continue;
			if (line.startsWith("event:")) event = line.slice(6).trim();
			else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
		}
		if (data.length === 0) continue;
		try {
			events.push({ event, data: JSON.parse(data.join("\n")) });
		} catch {
			// malformed frame: skip it rather than break the whole stream
		}
	}
	return { events, rest };
}
