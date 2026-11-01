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
        const preview = hit.preview ? `:${hit.line} ${hit.preview}` : "";
        const truncated = hit.textTruncated ? " 文本不完整" : "";
        const title = document.createElement("div");
        title.textContent = `${hit.title}${truncated}`;
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = `${hit.sourceLabel} ${hit.detail}${preview}`;
        row.append(title, meta);
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

  function paint() {
    results.querySelectorAll(".hit").forEach((row) => {
      row.classList.toggle("selected", Number(row.dataset.index) === selected);
    });
  }

  input.addEventListener("input", postQuery);
  input.focus();
  vscode.postMessage({ type: "ready" });
}());
