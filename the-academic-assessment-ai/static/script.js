// ================================================================
// The Academic Assessment AI  --  script.js
// Sequential batch processing with rate-limit-safe delays
// ================================================================

(() => {
    "use strict";

    // ── DOM refs ──────────────────────────────────────────────────
    const briefInput        = document.getElementById("briefFile");
    const rubricInput       = document.getElementById("rubricFile");
    const studentInput      = document.getElementById("studentFiles");
    const furtherInstr      = document.getElementById("furtherInstructions");
    const mockToggle        = document.getElementById("mockToggle");
    const startBtn          = document.getElementById("startBtn");
    const progressWrapper   = document.getElementById("progressWrapper");
    const progressFill      = document.getElementById("progressFill");
    const progressText      = document.getElementById("progressText");
    const resultsContainer  = document.getElementById("results-container");

    // File-name display helpers
    const briefFileName     = document.getElementById("briefFileName");
    const rubricFileName    = document.getElementById("rubricFileName");
    const studentFileNames  = document.getElementById("studentFileNames");

    // ── File-name feedback ────────────────────────────────────────
    briefInput.addEventListener("change",   () => { briefFileName.textContent   = briefInput.files[0]?.name  || ""; validateInputs(); });
    rubricInput.addEventListener("change",  () => { rubricFileName.textContent  = rubricInput.files[0]?.name || ""; validateInputs(); });
    studentInput.addEventListener("change", () => {
        const count = studentInput.files.length;
        studentFileNames.textContent = count === 1
            ? studentInput.files[0].name
            : `${count} files selected`;
        validateInputs();
    });

    // ── Validation ────────────────────────────────────────────────
    function validateInputs() {
        const ready =
            briefInput.files.length   > 0 &&
            rubricInput.files.length  > 0 &&
            studentInput.files.length > 0;
        startBtn.disabled = !ready;
    }

    // ── Delay helper ──────────────────────────────────────────────
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // ── Start batch assessment ────────────────────────────────────
    startBtn.addEventListener("click", async () => {
        // Revalidate
        if (briefInput.files.length === 0 || rubricInput.files.length === 0 || studentInput.files.length === 0) {
            alert("Please upload an Assignment Brief, a Rubric, and at least one Student Submission.");
            return;
        }

        const studentFiles = Array.from(studentInput.files);
        const total = studentFiles.length;
        const isMock = mockToggle.checked;

        // UI state
        startBtn.disabled = true;
        resultsContainer.innerHTML = "";
        progressWrapper.style.display = "block";
        progressFill.style.width = "0%";
        progressText.textContent = `0 / ${total} assessed`;

        const INTER_REQUEST_DELAY_MS = isMock ? 300 : 3000;

        for (let i = 0; i < total; i++) {
            const file = studentFiles[i];

            // Build FormData per request
            const form = new FormData();
            form.append("assignment_brief", briefInput.files[0]);
            form.append("rubric_file",      rubricInput.files[0]);
            form.append("student_file",     file);
            form.append("further_instructions", furtherInstr.value.trim());
            form.append("mock_mode", isMock ? "true" : "false");

            try {
                const resp = await fetch("/assess", { method: "POST", body: form });
                const data = await resp.json();

                if (!resp.ok) {
                    renderError(file.name, data.error || "Unknown server error.");
                } else {
                    renderCard(data);
                }
            } catch (err) {
                renderError(file.name, `Network error: ${err.message}`);
            }

            // Update progress
            const done = i + 1;
            const pct = Math.round((done / total) * 100);
            progressFill.style.width = `${pct}%`;
            progressText.textContent = `${done} / ${total} assessed`;

            // Rate-limit delay (skip after last item)
            if (done < total) {
                await delay(INTER_REQUEST_DELAY_MS);
            }
        }

        // Re-enable
        startBtn.disabled = false;
        progressText.textContent = `Done -- ${total} / ${total} assessed`;
    });

    // ── Render a feedback card ────────────────────────────────────
    function renderCard(data) {
        const card = document.createElement("div");
        card.className = "feedback-card";

        const gradeLower = (data.grade || "").toLowerCase();
        let badgeClass = "grade-fail";
        if (gradeLower.includes("distinction")) badgeClass = "grade-distinction";
        else if (gradeLower.includes("merit"))  badgeClass = "grade-merit";
        else if (gradeLower.includes("pass"))   badgeClass = "grade-pass";

        // Header
        card.innerHTML = `
            <div class="card-header">
                <span class="card-student">${esc(data.studentFile || "Student")}</span>
                <div style="display:flex;align-items:center;gap:.75rem;">
                    <span class="card-mark">${data.mark}<small style="font-size:.5em;font-weight:400">%</small></span>
                    <span class="grade-badge ${badgeClass}">${esc(data.grade)}</span>
                </div>
            </div>
            <div class="card-body">
                ${feedbackSection("What Went Well (WWW)", data.www)}
                ${feedbackSection("Even Better If (EBI)", data.ebi)}
                <div class="feedback-section">
                    <h3>Feed Forward</h3>
                    <p>${esc(data.feedForward || "")}</p>
                </div>
                <div class="feedback-section">
                    <h3>Rubric Alignment Audit</h3>
                    ${rubricTable(data.rubricAlignment || [])}
                </div>
            </div>
            <div class="card-footer">
                <button class="btn-download" data-report='${JSON.stringify(data).replace(/'/g, "&#39;")}'>
                    Download Report
                </button>
            </div>`;

        // Download handler
        card.querySelector(".btn-download").addEventListener("click", (e) => {
            const reportData = JSON.parse(e.currentTarget.dataset.report);
            downloadReport(reportData);
        });

        resultsContainer.appendChild(card);
    }

    // ── Render an error card ──────────────────────────────────────
    function renderError(fileName, message) {
        const el = document.createElement("div");
        el.className = "error-card";
        el.innerHTML = `<h3>Error: ${esc(fileName)}</h3><p>${esc(message)}</p>`;
        resultsContainer.appendChild(el);
    }

    // ── Feedback list helper ──────────────────────────────────────
    function feedbackSection(title, items) {
        if (!Array.isArray(items) || items.length === 0) return "";
        const lis = items.map((t) => `<li>${esc(t)}</li>`).join("");
        return `<div class="feedback-section"><h3>${title}</h3><ul>${lis}</ul></div>`;
    }

    // ── Rubric alignment table ────────────────────────────────────
    function rubricTable(rows) {
        if (rows.length === 0) return "<p>No rubric alignment data.</p>";

        let html = `<table class="rubric-table">
            <thead><tr>
                <th>Criterion</th>
                <th>Score</th>
                <th>Evidence Found</th>
                <th>Critical Reasoning</th>
            </tr></thead><tbody>`;

        for (const r of rows) {
            const max = r.maxScore || "?";
            const pct = r.maxScore ? r.score / r.maxScore : 0;
            let cls = "score-zero";
            if (pct >= 0.7) cls = "score-high";
            else if (pct > 0) cls = "score-mid";

            html += `<tr>
                <td>${esc(r.criterion)}</td>
                <td class="score-cell ${cls}">${r.score} / ${max}</td>
                <td class="evidence-cell">${esc(r.evidenceFound || "")}</td>
                <td>${esc(r.criticalReasoning || "")}</td>
            </tr>`;
        }

        html += "</tbody></table>";
        return html;
    }

    // ── Download report as JSON ───────────────────────────────────
    function downloadReport(data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `report_${(data.studentFile || "student").replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ── Escape HTML ───────────────────────────────────────────────
    function esc(str) {
        const d = document.createElement("div");
        d.appendChild(document.createTextNode(String(str)));
        return d.innerHTML;
    }
})();
