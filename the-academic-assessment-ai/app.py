import os
import re
import json
import tempfile
import traceback

from flask import Flask, request, jsonify, render_template

# ---------------------------------------------------------------------------
# File-parsing imports (graceful degradation when a dependency is missing)
# ---------------------------------------------------------------------------
try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

try:
    import docx as python_docx
except ImportError:
    python_docx = None

try:
    from pptx import Presentation
except ImportError:
    Presentation = None

try:
    from odf.opendocument import load as odf_load
    from odf import text as odf_text, teletype
except ImportError:
    odf_load = None

try:
    from PIL import Image
    import pytesseract
except ImportError:
    Image = None
    pytesseract = None

try:
    import anthropic
except ImportError:
    anthropic = None

# ---------------------------------------------------------------------------
# Flask application
# ---------------------------------------------------------------------------
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB upload limit

ALLOWED_EXTENSIONS = {
    ".pdf", ".docx", ".pptx", ".odt", ".txt",
    ".png", ".jpg", ".jpeg",
}

# ---------------------------------------------------------------------------
# System Prompt  --  the "Brain" of the grading AI
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """
You are an expert Academic Assessment AI, specialized in Level 3 (BTEC/T-Level) and Higher Education grading. You act as a 'Critical Pedagogical Auditor' and an 'External Quality Assurance' officer. Your goal is to be realistic, critical, and accurate. You are NOT to be overly generous.

Phase 1: Context & Input Isolation
- Read the <assignment_brief> carefully. This defines WHAT the student was asked to do -- the tasks, scenarios, word counts, format requirements, and learning objectives.
- Read the <rubric> carefully. This defines HOW the work is marked -- the criteria, grade bands, and marks available. The rubric is the sole authority for scoring.
- Read the <further_instructions> from the lecturer. These tell you WHICH section(s) of the rubric to assess.
  * If further instructions name specific tasks, criteria, or sections (e.g., "only assess Task 1a", "focus on P1-P3 and M1", "Learning Outcome 2 only"), you MUST locate those exact sections in the rubric and ONLY assess the criteria that fall under them. Ignore all other criteria entirely.
  * If no filter is given, assess ALL criteria found in the rubric.
- Isolate the <student_submission> content. Do NOT conflate the requirements of the Brief with the actual content of the Submission.

Phase 2: Rubric Extraction (CRITICAL -- read the rubric, do not invent criteria)
- You MUST parse the <rubric> document and locate the specific section(s) identified in Phase 1.
- Extract EVERY assessment criterion from those section(s) EXACTLY as written in the rubric -- including the criterion ID (e.g., "P1", "M1", "D1", "1.1", "Task 1a"), its full description, and the marks or grade band available.
- Use the rubric's OWN marking scheme:
  * If numerical marks are given (e.g., /10, /20), use those exact numbers as maxScore.
  * If the rubric uses Pass/Merit/Distinction bands without numbers, map: Not Achieved = 0, Pass = 1, Merit = 2, Distinction = 3 as maxScore 3.
  * If the rubric uses both, capture both.
- Do NOT invent, rename, merge, split, or paraphrase criteria. Copy them EXACTLY.
- The rubricAlignment array MUST contain ONE entry per extracted criterion. No more, no less.

Phase 3: Brief Adherence Check
- Separately from the rubric, check whether the student has followed the requirements of the <assignment_brief>:
  * Has the student addressed every task/question listed in the brief?
  * Has the student followed the required format (report, presentation, essay, etc.)?
  * Has the student met the word count or page requirements if specified?
  * Has the student used the required scenario/context if one was given?
  * Has the student included required sections (introduction, conclusion, references, etc.)?
- For each brief requirement, state whether it was met, partially met, or not met, with evidence.

Phase 4: The Grading Framework & "Quote or Zero" Protocol
- Bloom's Taxonomy: Lower Tier (Recall/Understand) = Pass/Merit. Higher Tier (Analyze/Evaluate/Create) = Distinction.
- The 70% Threshold: Distinction requires explicit critical analysis ('Why' & 'How'), contextual depth, and synthesis.
- Strictness: Start from 0. Only award marks if explicit evidence is found.
- "Quote or Zero": You cannot award a mark or claim a topic was discussed unless you can extract a direct quote or clear paraphrase from the <student_submission> to prove it. If the rubric criterion requires a concept (e.g., GDPR) but the student does not mention it, the score is 0.
- Evidence Lock: Do not use outside knowledge. Strictly adhere to the provided documents.
- SPaG: Check for Spelling, Punctuation, and Grammar. If the student indicates dyslexia (or if argument quality is high but spelling is poor), be lenient on spelling but strict on grammar and structure.

Phase 5: Mathematical Scoring
- Score ONLY the criteria extracted in Phase 2. Do not add extra criteria.
- Assign a numerical score to each criterion based on evidence found.
- Sum the total marks mathematically. Calculate the percentage: (total scored / total available) * 100. Round to the nearest integer. Do not guess.
- Derive the grade from the rubric's own grade boundaries if provided. Otherwise use: 0-39 = Fail, 40-54 = Pass, 55-69 = Merit, 70-100 = Distinction.

Phase 6: Feedback Output Structure
Return the response in **strict JSON** format ONLY. Do not include any text outside the JSON object. Use the following schema:
{
  "mark": (Integer 0-100: the calculated percentage),
  "grade": (String, e.g., "Distinction", "Merit", "Pass", "Fail"),
  "tasksAssessed": (String: which rubric section(s)/task(s) were assessed, e.g., "Task 1a, Task 1b" or "All criteria"),
  "www": (Array of Strings: Specific strengths, each referencing the rubric criterion ID it relates to),
  "ebi": (Array of Strings: Constructive criticism, each referencing the rubric criterion ID and what is needed for the next grade band),
  "feedForward": (String: Actionable steps for future assignments),
  "briefAdherence": [
    {
      "requirement": (String: The specific requirement from the assignment brief),
      "status": (String: "Met", "Partially Met", or "Not Met"),
      "comment": (String: Brief explanation with evidence from the submission)
    }
  ],
  "rubricAlignment": [
    {
      "criterion": (String: The EXACT criterion ID and name as written in the rubric),
      "score": (Integer: Marks awarded for this criterion),
      "maxScore": (Integer: Maximum marks available as stated in the rubric),
      "evidenceFound": (String: Direct quote from the student submission, or 'No evidence found'),
      "criticalReasoning": (String: Why the mark was given/denied, referencing what the rubric requires vs what the student provided)
    }
  ]
}
"""

# ---------------------------------------------------------------------------
# File-content extraction
# ---------------------------------------------------------------------------

def _clean(text: str) -> str:
    """Collapse excessive whitespace while preserving paragraph breaks."""
    text = re.sub(r"[^\S\n]+", " ", text)       # collapse spaces/tabs
    text = re.sub(r"\n{3,}", "\n\n", text)       # max 2 consecutive newlines
    return text.strip()


def extract_content(file_path: str) -> str:
    """Extract plain text from a supported file type."""
    ext = os.path.splitext(file_path)[1].lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {ext}")

    # --- PDF ---
    if ext == ".pdf":
        if PdfReader is None:
            raise RuntimeError("pypdf is not installed.")
        reader = PdfReader(file_path)
        pages = [page.extract_text() or "" for page in reader.pages]
        return _clean("\n".join(pages))

    # --- DOCX ---
    if ext == ".docx":
        if python_docx is None:
            raise RuntimeError("python-docx is not installed.")
        doc = python_docx.Document(file_path)
        paragraphs = [p.text for p in doc.paragraphs]
        return _clean("\n".join(paragraphs))

    # --- PPTX ---
    if ext == ".pptx":
        if Presentation is None:
            raise RuntimeError("python-pptx is not installed.")
        prs = Presentation(file_path)
        text_parts: list[str] = []
        for slide in prs.slides:
            for shape in slide.shapes:
                if shape.has_text_frame:
                    for para in shape.text_frame.paragraphs:
                        text_parts.append(para.text)
        return _clean("\n".join(text_parts))

    # --- ODT ---
    if ext == ".odt":
        if odf_load is None:
            raise RuntimeError("odfpy is not installed.")
        doc = odf_load(file_path)
        paragraphs = doc.getElementsByType(odf_text.P)
        text_parts = [teletype.extractText(p) for p in paragraphs]
        return _clean("\n".join(text_parts))

    # --- Plain text ---
    if ext == ".txt":
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            return _clean(f.read())

    # --- Images (OCR) ---
    if ext in {".png", ".jpg", ".jpeg"}:
        if Image is None or pytesseract is None:
            raise RuntimeError("Pillow / pytesseract is not installed.")
        img = Image.open(file_path)
        return _clean(pytesseract.image_to_string(img))

    raise ValueError(f"Unhandled extension: {ext}")


def _save_temp(file_storage) -> str:
    """Save a Werkzeug FileStorage to a temp file and return the path."""
    ext = os.path.splitext(file_storage.filename)[1].lower()
    fd, path = tempfile.mkstemp(suffix=ext)
    os.close(fd)
    file_storage.save(path)
    return path


# ---------------------------------------------------------------------------
# Mock LLM response (for testing without an API key)
# ---------------------------------------------------------------------------

def mock_llm_response(student_name: str) -> dict:
    """Return realistic dummy assessment data mirroring rubric-driven output."""
    return {
        "mark": 47,
        "grade": "Pass",
        "tasksAssessed": "Task 1a, Task 1b (as specified in Further Instructions)",
        "www": [
            "P1: Clear definitions provided for key IT concepts including hardware, "
            "software, and networking fundamentals.",
            "P2: GDPR is identified and its purpose is stated correctly.",
            "M1: Some valid examples of IT use in business are provided, showing "
            "understanding beyond basic recall.",
        ],
        "ebi": [
            "P3: No evidence found for this criterion. You must discuss network "
            "topologies as required by the rubric to achieve a Pass.",
            "M2: To move from Pass to Merit, you need to compare different data "
            "protection laws rather than just listing them.",
            "D1: No critical analysis present. Distinction requires you to evaluate "
            "'why' and 'how' IT impacts organisations with real-world case studies.",
            "D2: No synthesis of emerging technologies. You must argue a position "
            "using multiple sources to reach Distinction.",
        ],
        "feedForward": (
            "Map each rubric criterion (P1, P2, M1, D1, etc.) to a dedicated "
            "section in your work. For Pass criteria, describe and define. For "
            "Merit, compare and explain. For Distinction, evaluate and justify. "
            "Use the PEE (Point, Evidence, Explain) chain in every paragraph."
        ),
        "briefAdherence": [
            {
                "requirement": "Task 1a: Produce a report explaining key IT concepts",
                "status": "Partially Met",
                "comment": (
                    "The student has written in report format with headings but "
                    "has only covered hardware and software. Networking and "
                    "operating systems, which are listed in the brief, are missing."
                ),
            },
            {
                "requirement": "Task 1b: Discuss data protection legislation relevant to a given scenario",
                "status": "Partially Met",
                "comment": (
                    "GDPR is discussed but the student has not applied it to the "
                    "scenario provided in the brief (healthcare setting). The brief "
                    "specifically asks students to use 'Scenario B: NHS Trust'."
                ),
            },
            {
                "requirement": "Word count: 1500-2000 words",
                "status": "Not Met",
                "comment": (
                    "Submission appears to be approximately 900 words, well below "
                    "the minimum 1500-word requirement stated in the brief."
                ),
            },
            {
                "requirement": "Include a reference list using Harvard referencing",
                "status": "Not Met",
                "comment": (
                    "No reference list is present at the end of the submission. "
                    "Some in-text citations appear but are not in Harvard format."
                ),
            },
            {
                "requirement": "Include an introduction and conclusion",
                "status": "Partially Met",
                "comment": (
                    "An introduction is present but is only one sentence. "
                    "No conclusion section was found in the submission."
                ),
            },
        ],
        "rubricAlignment": [
            {
                "criterion": "P1: Explain key concepts of information technology",
                "score": 8,
                "maxScore": 10,
                "evidenceFound": (
                    "\"Information Technology refers to the use of computers and "
                    "telecommunications to store, retrieve, and send information.\""
                ),
                "criticalReasoning": (
                    "Rubric requires explanation of key IT concepts. The student "
                    "provides clear definitions of hardware, software, and "
                    "networking but does not cover all sub-topics listed in the "
                    "rubric (operating systems omitted). 8/10 awarded."
                ),
            },
            {
                "criterion": "P2: Outline the principles of data protection legislation",
                "score": 6,
                "maxScore": 10,
                "evidenceFound": (
                    "\"The GDPR was introduced in 2018 to protect personal data "
                    "of EU citizens.\""
                ),
                "criticalReasoning": (
                    "Rubric requires outlining data protection principles. Student "
                    "identifies GDPR but does not mention the Data Protection Act "
                    "2018 or the role of the ICO, both listed in the rubric. 6/10."
                ),
            },
            {
                "criterion": "P3: Describe network topologies and protocols",
                "score": 0,
                "maxScore": 10,
                "evidenceFound": "No evidence found",
                "criticalReasoning": (
                    "Rubric requires description of network topologies (star, mesh, "
                    "bus) and protocols (TCP/IP, HTTP). The student submission "
                    "contains no discussion of this topic. 0/10 awarded."
                ),
            },
            {
                "criterion": "M1: Explain how IT supports business operations",
                "score": 7,
                "maxScore": 15,
                "evidenceFound": (
                    "\"Businesses use cloud computing and email systems to "
                    "improve daily operations and communication.\""
                ),
                "criticalReasoning": (
                    "Rubric requires explanation with examples. Student gives "
                    "valid examples (cloud, email) but explanation is shallow -- "
                    "does not explain HOW these improve operations in detail. "
                    "Partial Merit level. 7/15."
                ),
            },
            {
                "criterion": "M2: Compare data protection approaches across sectors",
                "score": 0,
                "maxScore": 15,
                "evidenceFound": "No evidence found",
                "criticalReasoning": (
                    "Rubric requires comparison across sectors (healthcare, finance, "
                    "education). No comparative analysis found in submission. 0/15."
                ),
            },
            {
                "criterion": "D1: Evaluate the impact of IT on a named organisation",
                "score": 0,
                "maxScore": 20,
                "evidenceFound": "No evidence found",
                "criticalReasoning": (
                    "Rubric requires critical evaluation with a named case study. "
                    "Student provides only generic statements ('IT helps businesses "
                    "run more efficiently') with no named organisation, no sources, "
                    "and no evaluative argument. 0/20 awarded."
                ),
            },
            {
                "criterion": "D2: Evaluate emerging technologies and their future impact",
                "score": 0,
                "maxScore": 20,
                "evidenceFound": "No evidence found",
                "criticalReasoning": (
                    "Rubric requires evaluation of emerging technologies (AI, IoT, "
                    "blockchain) with synthesised argument. No discussion found "
                    "in the student submission whatsoever. 0/20 awarded."
                ),
            },
        ],
    }


# ---------------------------------------------------------------------------
# LLM integration
# ---------------------------------------------------------------------------

def call_llm(brief_text: str, rubric_text: str,
             student_text: str, further_instructions: str) -> dict:
    """Send the assessment payload to Claude via the Anthropic API."""

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")

    if not api_key:
        raise RuntimeError(
            "No ANTHROPIC_API_KEY found in environment. "
            "Use Mock Mode or set the key."
        )

    if anthropic is None:
        raise RuntimeError("anthropic Python package is not installed.")

    client = anthropic.Anthropic(api_key=api_key)

    user_message = (
        "<assignment_brief>\n"
        f"{brief_text}\n"
        "</assignment_brief>\n\n"
        "<rubric>\n"
        f"{rubric_text}\n"
        "</rubric>\n\n"
        "<further_instructions>\n"
        f"{further_instructions or 'None provided.'}\n"
        "</further_instructions>\n\n"
        "<student_submission>\n"
        f"{student_text}\n"
        "</student_submission>"
    )

    response = client.messages.create(
        model=model,
        max_tokens=4096,
        temperature=0.2,
        system=SYSTEM_PROMPT,
        messages=[
            {"role": "user", "content": user_message},
        ],
    )

    raw = response.content[0].text.strip()

    # Strip markdown code fences if the model wraps its output
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"LLM returned invalid JSON. Parse error: {exc}\n\nRaw output:\n{raw}"
        ) from exc

    # Validate required keys
    required_keys = {"mark", "grade", "www", "ebi", "feedForward", "rubricAlignment", "briefAdherence"}
    missing = required_keys - set(data.keys())
    if missing:
        raise RuntimeError(f"LLM JSON is missing keys: {missing}")

    return data


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/assess", methods=["POST"])
def assess():
    """Grade a single student submission against the provided brief & rubric."""
    mock_mode = request.form.get("mock_mode", "false").lower() == "true"

    # --- Validate uploads ---------------------------------------------------
    if "assignment_brief" not in request.files:
        return jsonify({"error": "Assignment Brief file is required."}), 400
    if "rubric_file" not in request.files:
        return jsonify({"error": "Rubric file is required."}), 400
    if "student_file" not in request.files:
        return jsonify({"error": "Student submission file is required."}), 400

    brief_file = request.files["assignment_brief"]
    rubric_file = request.files["rubric_file"]
    student_file = request.files["student_file"]

    if not brief_file.filename or not rubric_file.filename or not student_file.filename:
        return jsonify({"error": "All three file slots must have a file selected."}), 400

    further_instructions = request.form.get("further_instructions", "")

    temp_paths: list[str] = []

    try:
        # Save uploaded files to temp storage
        brief_path = _save_temp(brief_file)
        temp_paths.append(brief_path)
        rubric_path = _save_temp(rubric_file)
        temp_paths.append(rubric_path)
        student_path = _save_temp(student_file)
        temp_paths.append(student_path)

        # Extract text
        brief_text = extract_content(brief_path)
        rubric_text = extract_content(rubric_path)
        student_text = extract_content(student_path)

        if not brief_text:
            return jsonify({"error": "Could not extract text from the Assignment Brief."}), 400
        if not rubric_text:
            return jsonify({"error": "Could not extract text from the Rubric."}), 400
        if not student_text:
            return jsonify({"error": "Could not extract text from the Student Submission."}), 400

        # Grade
        if mock_mode:
            result = mock_llm_response(student_file.filename)
        else:
            result = call_llm(brief_text, rubric_text, student_text, further_instructions)

        result["studentFile"] = student_file.filename
        return jsonify(result), 200

    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 502
    except Exception:
        traceback.print_exc()
        return jsonify({"error": "An unexpected server error occurred."}), 500
    finally:
        for p in temp_paths:
            try:
                os.unlink(p)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
