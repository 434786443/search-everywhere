(function () {
  const vscode = acquireVsCodeApi();
  const input = document.getElementById("q");
  const hint = document.getElementById("hint");
  const status = document.getElementById("status");
  const results = document.getElementById("results");
  const tabs = Array.from(document.querySelectorAll("[data-tab]"));
  let tab = "all";
  let selectable = [];
  let selected = 0;

  function postQuery() {
    vscode.postMessage({ type: "query", text: input.value, tab });
  }

  tabs.forEach((button) => {
    button.addEventListener("click", () => {
      tab = button.dataset.tab;
      tabs.forEach((item) => item.classList.toggle("active", item === button));
      postQuery();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selected = Math.min(selected + 1, Math.max(selectable.length - 1, 0));
      paint();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selected = Math.max(selected - 1, 0);
      paint();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = selectable[selected];
      if (hit) vscode.postMessage({ type: "open", id: hit.id });
    } else if (event.key === "Escape") {
      event.preventDefault();
      vscode.postMessage({ type: "close" });
    } else if (event.key === "Tab") {
      event.preventDefault();
      const order = ["all", "files", "symbols", "commands"];
      const index = order.indexOf(tab);
      const next = event.shiftKey ? (index + 3) % 4 : (index + 1) % 4;
      tab = order[next];
      tabs.forEach((item) => item.classList.toggle("active", item.dataset.tab === tab));
      postQuery();
    }
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "results") return;
    status.textContent = message.payload.status || "";
    hint.hidden = input.value.trim().length > 0;
    selectable = [];
    results.replaceChildren();
    for (const group of message.payload.groups) {
      if (group.hits.length === 0 && !group.note) continue;
      const heading = document.createElement("h2");
      heading.textContent = group.title;
      results.appendChild(heading);
      for (const hit of group.hits) {
        const index = selectable.push(hit) - 1;
        const row = document.createElement("div");
        row.className = "hit";
        row.dataset.index = String(index);
        const truncated = hit.textTruncated ? " 文本不完整" : "";
        const head = document.createElement("div");
        head.className = "hit-head";
        if (hit.badge) head.append(badgeElement(hit.badge));
        const title = document.createElement("span");
        title.className = "hit-title";
        fillHighlighted(title, hit.title, hit.titleRanges);
        if (truncated) title.append(truncated);
        head.append(title);
        const meta = document.createElement("div");
        meta.className = "meta";
        if (hit.sourceLabel) meta.append(`${hit.sourceLabel} `);
        fillHighlighted(meta, hit.detail, hit.detailRanges);
        if (hit.preview) {
          meta.append(`:${hit.line} `);
          fillHighlighted(meta, hit.preview, hit.previewRanges);
        }
        row.append(head, meta);
        row.addEventListener("click", () => vscode.postMessage({ type: "open", id: hit.id }));
        results.appendChild(row);
      }
      if (group.note) {
        const note = document.createElement("div");
        note.className = "note";
        note.textContent = group.note;
        results.appendChild(note);
      }
    }
    selected = 0;
    paint();
  });

  function badgeElement(badge) {
    const span = document.createElement("span");
    span.className = "badge";
    span.textContent = badge.text;
    span.style.color = badge.color;
    // Fewer characters earn a wider glyph: a lone letter can afford a bigger cap height.
    span.classList.add(badge.text.length <= 1 ? "badge-one" : badge.text.length === 2 ? "badge-two" : "badge-three");
    return span;
  }

  function fillHighlighted(parent, text, ranges) {
    const marks = Array.isArray(ranges) ? ranges : [];
    let cursor = 0;
    for (const range of marks) {
      const start = range[0];
      const end = range[1];
      if (start > cursor) parent.append(text.slice(cursor, start));
      const mark = document.createElement("mark");
      mark.textContent = text.slice(start, end);
      parent.append(mark);
      cursor = end;
    }
    if (cursor < text.length) parent.append(text.slice(cursor));
  }

  function paint() {
    results.querySelectorAll(".hit").forEach((row) => {
      row.classList.toggle("selected", Number(row.dataset.index) === selected);
    });
  }

  input.addEventListener("input", postQuery);
  input.focus();
  vscode.postMessage({ type: "ready" });
}());
