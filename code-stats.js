
const OWNER = "SamanthaYYN";
const REPO = "to-harry";
const BRANCH = "main";

async function showCodeStats() {
  const container = document.getElementById("code-stats");

  try {
    const api = `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`;
    const response = await fetch(api);

    if (!response.ok) {
      throw new Error("Could not access GitHub repository");
    }

    const tree = await response.json();

    if (tree.truncated) {
      throw new Error("Repository is too large to scan completely");
    }

    const files = tree.tree.filter(file =>
      file.type === "blob" &&
      /\.(html?|css|js)$/i.test(file.path) &&
      !file.path.split("/").some(part =>
        ["node_modules", "dist", "build", "vendor"].includes(part)
      )
    );

    const counts = { HTML: 0, CSS: 0, JavaScript: 0 };

    // Fetch source files in small batches.
    for (let i = 0; i < files.length; i += 10) {
      const batch = files.slice(i, i + 10);

      await Promise.all(batch.map(async file => {
        const url =
          `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${file.path}`;

        const res = await fetch(url);
        if (!res.ok) return;

        const source = await res.text();
        const lines = source.split(/\r\n|\r|\n/).filter(
          line => line.trim().length > 0
        ).length;

        if (/\.html?$/i.test(file.path)) counts.HTML += lines;
        else if (/\.css$/i.test(file.path)) counts.CSS += lines;
        else if (/\.js$/i.test(file.path)) counts.JavaScript += lines;
      }));
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    if (!total) throw new Error("No readable source lines found");

    const colors = {
      HTML: "#E87535",
      CSS: "#4285E8",
      JavaScript: "#D8B52B"
    };

    container.innerHTML = `
      <h2>Website Code Breakdown</h2>
      <p>Measured by non-empty source lines</p>
      ${Object.entries(counts).map(([name, lines]) => {
        const pct = (lines / total * 100);
        return `
          <div style="margin:16px 0;font-family:Arial,sans-serif">
            <div style="display:flex;justify-content:space-between;
                        margin-bottom:6px">
              <span>${name}</span>
              <strong>${pct.toFixed(1)}%</strong>
            </div>
            <div style="height:10px;background:#e5e7eb;
                        border-radius:10px;overflow:hidden">
              <div style="height:100%;width:${pct}%;
                          background:${colors[name]}"></div>
            </div>
            <small>${lines.toLocaleString()} lines</small>
          </div>`;
      }).join("")}
      <p>Total: ${total.toLocaleString()} non-empty lines</p>
    `;
  } catch (error) {
    container.textContent =
      "Unable to load code statistics: " + error.message;
  }
}

showCodeStats();
