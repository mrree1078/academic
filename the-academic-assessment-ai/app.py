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
    from openai import OpenAI
except ImportError:
    OpenAI = None

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
- Analyze the Assignment Brief and the Rubric (The 'Gold Standard').
- Incorporate 'Further Instructions' provided by the lecturer (e.g., 'focus on task 1a').
- Isolate the <student_submission> content. Do NOT conflate the requirements of the Brief with the actual content of the Submission.

Phase 2: The Grading Framework & "Quote or Zero" Protocol
- Bloom's Taxonomy: Lower Tier (Recall/Understand) = Pass/Merit. Higher Tier (Analyze/Evaluate/Create) = Distinction.
- The 70% Threshold: Distinction requires explicit critical analysis ('Why' & 'How'), contextual depth, and synthesis.
- Strictness: Start from 0. Only award marks if explicit evidence is found.
- "Quote or Zero": You cannot award a mark or claim a topic was discussed unless you can extract a direct quote or clear paraphrase from the <student_submission> to prove it. If the Rubric mentions a concept (e.g., GDPR), but the Student does not, the mark is 0.
- Evidence Lock: Do not use outside knowledge. Strictly adhere to the provided documents.
- SPaG: Check for Spelling, Punctuation, and Grammar. However, if the student indicates dyslexia (or if the quality of argument is high but spelling is poor), be lenient on spelling but strict on grammar and structure.

Phase 3: Mathematical Scoring
- Extract the scoring system from the Rubric.
- List every single criterion found in the rubric.
- Assign a numerical score to each criterion based on evidence found.
- Sum the total marks mathematically. Do not guess the total.

Phase 4: Feedback Output Structure
Return the response in **strict JSON** format ONLY. Do not include any text outside the JSON object. Use the following schema:
{
  "mark": (Integer 0-100),
  "grade": (String, e.g., "Distinction", "Merit", "Pass", "Fail"),
  "www": (Array of Strings: Specific strengths linked to the rubric),
  "ebi": (Array of Strings: Constructive criticism focused on how to move to the next grade band),
  "feedForward": (String: Actionable steps for future assignments),
  "rubricAlignment": [
    {
      "criterion": (String: The specific rubric point),
      "score": (Integer: Marks awarded for this point),
      "maxScore": (Integer: Maximum marks available for this point),
      "evidenceFound": (String: Direct quote or 'No evidence found'),
      "criticalReasoning": (String: Why the mark was given/denied)
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
    """Return realistic dummy assessment data."""
    return {
        "mark": 54,
        "grade": "Merit",
        "www": [
            "The submission demonstrates a clear understanding of the core terminology "
            "as outlined in criterion 1.1.",
            "Appropriate use of examples when discussing data protection principles.",
            "Logical structure with clear headings that mirror the brief requirements.",
        ],
        "ebi": [
            "Critical analysis is surface-level. To achieve Distinction, you must explain "
            "'why' and 'how' rather than simply describing concepts.",
            "No evidence found for criterion 2.3 (impact of emerging technologies). "
            "This entire section is missing from your submission.",
            "Referencing is inconsistent -- several claims lack in-text citations.",
        ],
        "feedForward": (
            "For your next assignment, begin by mapping each rubric criterion to a "
            "dedicated section in your work. Use the PEE (Point, Evidence, Explain) "
            "chain to ensure every paragraph contains analysis, not just description."
        ),
        "rubricAlignment": [
            {
                "criterion": "1.1 Explain key concepts of IT",
                "score": 8,
                "maxScore": 10,
                "evidenceFound": (
                    "\"Information Technology refers to the use of computers and "
                    "telecommunications to store, retrieve, and send information.\""
                ),
                "criticalReasoning": (
                    "The student provides a clear definition but does not extend "
                    "this into a contextual discussion of modern IT paradigms."
                ),
            },
            {
                "criterion": "1.2 Discuss data protection legislation",
                "score": 6,
                "maxScore": 10,
                "evidenceFound": (
                    "\"The GDPR was introduced in 2018 to protect personal data "
                    "of EU citizens.\""
                ),
                "criticalReasoning": (
                    "Mentions GDPR but fails to analyse its practical implications "
                    "for organisations. No mention of the Data Protection Act 2018."
                ),
            },
            {
                "criterion": "2.1 Analyze the impact of IT on business",
                "score": 5,
                "maxScore": 15,
                "evidenceFound": (
                    "\"IT helps businesses run more efficiently.\""
                ),
                "criticalReasoning": (
                    "This is a vague, unsupported claim. No specific examples or "
                    "case studies are provided. Analysis is absent."
                ),
            },
            {
                "criterion": "2.3 Evaluate emerging technologies",
                "score": 0,
                "maxScore": 15,
                "evidenceFound": "No evidence found",
                "criticalReasoning": (
                    "The student submission contains no discussion of emerging "
                    "technologies whatsoever. Full marks withheld."
                ),
            },
            {
                "criterion": "3.1 Present work with academic conventions",
                "score": 5,
                "maxScore": 10,
                "evidenceFound": "N/A -- holistic criterion",
                "criticalReasoning": (
                    "Headings are present but referencing is inconsistent. "
                    "Harvard style attempted but not applied uniformly."
                ),
            },
        ],
    }


# ---------------------------------------------------------------------------
# LLM integration
# ---------------------------------------------------------------------------

def call_llm(brief_text: str, rubric_text: str,
             student_text: str, further_instructions: str) -> dict:
    """Send the assessment payload to the configured LLM and parse JSON."""

    api_key = os.environ.get("OPENAI_API_KEY", "")
    api_base = os.environ.get("OPENAI_API_BASE", None)
    model = os.environ.get("LLM_MODEL", "gpt-4o")

    if not api_key:
        raise RuntimeError(
            "No OPENAI_API_KEY found in environment. "
            "Use Mock Mode or set the key."
        )

    if OpenAI is None:
        raise RuntimeError("openai Python package is not installed.")

    client_kwargs: dict = {"api_key": api_key}
    if api_base:
        client_kwargs["base_url"] = api_base

    client = OpenAI(**client_kwargs)

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

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        temperature=0.2,
        max_tokens=4096,
    )

    raw = response.choices[0].message.content.strip()

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
    required_keys = {"mark", "grade", "www", "ebi", "feedForward", "rubricAlignment"}
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
