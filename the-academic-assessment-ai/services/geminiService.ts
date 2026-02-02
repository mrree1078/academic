
import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { FileInput, AssessmentResult } from "../types";
import { readFileAsBase64, readFileAsText, readDocxAsText } from "../utils/fileHelper";

const SYSTEM_PROMPT = `
You are a Deterministic Academic Evaluation Engine. Your goal is to produce perfectly consistent, repeatable, and objective grades backed by indisputable textual evidence.

**CORE DIRECTIVE: VERBATIM EVIDENCE PROTOCOL**
- You are FORBIDDEN from making claims about student work without providing a direct, verbatim quote from Source D.
- Every mark awarded must be "bought" with evidence. 

**SCORING LEVELS & EVIDENCE REQUIREMENTS:**
1. **Distinction (80-100%):** Requires a minimum of 3 distinct verbatim quotes per criterion demonstrating high-level critical synthesis, evaluation, or original argument.
2. **Merit (60-79%):** Requires a minimum of 2 distinct verbatim quotes per criterion demonstrating clear analytical application of theory to context.
3. **Pass (40-59%):** Requires at least 1-2 verbatim quotes demonstrating basic identification or description of relevant concepts.
4. **Fail (<40%):** Used when evidence is missing, factually incorrect, or purely superficial.

**PHASE 1: QUANTITATIVE AUDIT (SOURCE D)**
1. **TASK INVENTORY:** Match the submission against EVERY task in Source A (Brief). 
   - 0 points for missing tasks.
   - Partial points for superficial mentions.
   - Full points only for comprehensive technical completion backed by quotes.
2. **TECHNICAL DENSITY CALCULATION:** 
   - Identify every unique technical term or model used correctly from the Indicative Content.
   - Calculate Density: (Count of Correct Technical Terms / Total Word Count).
3. **VOLUME & QUALITY CHECK:** Evaluate the "substantive amount of text created." Reward density and depth over mere word count.

**PHASE 2: THE VERB & QUOTE MATCH (SOURCE B)**
- Match student quotes against rubric verbs.
- If the rubric requires "Critically Analyze" but the quotes only show "Description," the mark is capped at 50%.
- If you cannot find a quote that matches the required cognitive level of the rubric tier, you MUST drop the student to the tier below.

**PHASE 3: DYSLEXIA / CONTEXT OVERRIDE (SOURCE C)**
- If specified as dyslexic, COMPLETELY remove SPAG (Spelling, Punctuation, Grammar) from your scoring logic. Evaluate purely on Technical Density, Argument Depth, and Bloom's Level as evidenced by the quotes.

**OUTPUT REQUIREMENTS (JSON):**
- **mark**: "X/Y" (Strictly calculated).
- **technicalDensity**: Summary of key terms found.
- **wordCountAnalysis**: Breakdown of quality vs. volume.
- **briefAdherence**: Evidence-linked task completion.
- **rubricAlignment**: Standard-linked evidence audit containing VERBATIM QUOTES.
`;

const wrapInXml = (tag: string, content: string) => {
  return `<${tag}>\n${content}\n</${tag}>`;
};

const prepareFilePart = async (fileInput: FileInput, xmlTag: string): Promise<any[]> => {
  const fileType = fileInput.type;

  if (fileType === 'text') {
    const textData = await readFileAsText(fileInput.file);
    return [{ text: wrapInXml(xmlTag, `[File Name: ${fileInput.file.name}]\n${textData}`) }];
  } 
  else if (fileType === 'docx') {
    const textData = await readDocxAsText(fileInput.file);
    return [{ text: wrapInXml(xmlTag, `[File Name: ${fileInput.file.name}]\n[Extracted Text Content]:\n${textData}`) }];
  }
  else if (fileType === 'pdf' || fileType === 'image') {
    const base64Data = await readFileAsBase64(fileInput.file);
    let mimeType = fileInput.file.type;
    if (fileType === 'pdf') mimeType = 'application/pdf';
    return [
      { text: `<${xmlTag}>\n[File Name: ${fileInput.file.name}]` },
      { inlineData: { data: base64Data, mimeType: mimeType } },
      { text: `</${xmlTag}>` }
    ];
  }
  else {
    return [{ text: wrapInXml(xmlTag, `[File Name: ${fileInput.file.name}]\n[WARNING: Unsupported file type.]`) }];
  }
};

export const assessStudentWork = async (
  assignmentFile: FileInput | null,
  rubricFile: FileInput | null,
  studentFile: FileInput,
  furtherInstructions: string,
  modelId: string = 'gemini-3-pro-preview'
): Promise<AssessmentResult> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return mockLlmResponse(studentFile.file.name);

  try {
    const ai = new GoogleGenAI({ apiKey });
    let parts: any[] = [];

    if (assignmentFile) {
      parts.push({ text: "### SOURCE A: MANDATORY BRIEF REQUIREMENTS & TASKS" });
      parts = parts.concat(await prepareFilePart(assignmentFile, "assignment_brief"));
    }
    
    if (rubricFile) {
      parts.push({ text: "### SOURCE B: DETERMINISTIC RUBRIC STANDARDS & VERB LEVELS" });
      parts = parts.concat(await prepareFilePart(rubricFile, "rubric"));
    }
    
    if (furtherInstructions) {
      parts.push({ text: `### SOURCE C: EVALUATION CONTEXT / SPECIAL OVERRIDES (e.g. DYSLEXIA)\n${furtherInstructions}` });
    }

    parts.push({ text: "### SOURCE D: STUDENT SUBMISSION (PRIMARY DATA SOURCE)" });
    parts = parts.concat(await prepareFilePart(studentFile, "student_submission"));

    const response = await ai.models.generateContent({
      model: modelId,
      contents: { role: 'user', parts: parts },
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        seed: 42,
        temperature: 0,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mark: { type: Type.STRING },
            grade: { type: Type.STRING },
            www: { type: Type.STRING },
            ebi: { type: Type.STRING },
            feedForward: { type: Type.STRING },
            technicalDensity: { type: Type.STRING, description: "Detailed analysis of technical lexicon used correctly." },
            wordCountAnalysis: { type: Type.STRING, description: "Quantitative summary of substantive academic output." },
            briefAdherence: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  taskName: { type: Type.STRING },
                  adherenceLevel: { type: Type.STRING, enum: ['Full', 'Partial', 'Minimal', 'None'] },
                  evidence: { type: Type.STRING, description: "Direct verbatim quote from the student work proving task completion." },
                  commentary: { type: Type.STRING }
                },
                required: ["taskName", "adherenceLevel", "evidence", "commentary"]
              }
            },
            rubricAlignment: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  criterion: { type: Type.STRING },
                  score: { type: Type.STRING },
                  missingEvidence: { type: Type.STRING, description: "What specific quotes or technical depth were missing to reach the next tier?" },
                  evidenceFound: { type: Type.STRING, description: "MANDATORY: Provide an exhaustive list of VERBATIM QUOTES. Distinction grades MUST have at least 3 distinct quotes." },
                  criticalReasoning: { type: Type.STRING, description: "Logical justification mapping quotes to rubric verbs. Address dyslexia if applicable." }
                },
                required: ["criterion", "score", "missingEvidence", "evidenceFound", "criticalReasoning"]
              }
            },
          },
          required: ["mark", "grade", "www", "ebi", "feedForward", "technicalDensity", "wordCountAnalysis", "briefAdherence", "rubricAlignment"],
        },
        thinkingConfig: modelId.includes('pro') ? { thinkingBudget: 4096 } : undefined
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    return {
      studentName: studentFile.file.name.split('.')[0],
      fileName: studentFile.file.name,
      mark: parsed.mark || "0/100",
      grade: parsed.grade || "Ungraded",
      www: parsed.www || "None identified.",
      ebi: parsed.ebi || "None identified.",
      feedForward: parsed.feedForward || "No specific guidance.",
      technicalDensity: parsed.technicalDensity || "No analysis available.",
      wordCountAnalysis: parsed.wordCountAnalysis || "No analysis available.",
      briefAdherence: parsed.briefAdherence || [],
      rubricAlignment: parsed.rubricAlignment || [],
      timestamp: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString()
    };
  } catch (error) {
    console.error("Assessment error", error);
    throw error;
  }
};

const mockLlmResponse = (filename: string): Promise<AssessmentResult> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        studentName: filename.split('.')[0],
        fileName: filename,
        mark: "32/58",
        grade: "Fail",
        www: "Demonstrates some basic understanding.",
        ebi: "Missing critical synthesis and task completion.",
        feedForward: "Address all tasks in the brief.",
        technicalDensity: "Identified 2 technical terms: 'Market' and 'Customer'. Both used descriptively.",
        wordCountAnalysis: "Submission contains 1200 words, but 80% is descriptive context for Section 1.",
        briefAdherence: [
          {
            taskName: "Task 1: Market Analysis",
            adherenceLevel: "Partial",
            evidence: "Direct Quote: 'The competitors are numerous and varied in the local area.'",
            commentary: "Lacks the depth of research requested in the brief."
          }
        ],
        rubricAlignment: [
          {
            criterion: "Technical Application",
            score: "Fail",
            missingEvidence: "No verbatim evidence of SWOT or PESTLE application.",
            evidenceFound: "Quote: 'The environment is changing rapidly.'",
            criticalReasoning: "The student provides a descriptive statement but fails to apply a structured model as required by the 'Pass' threshold."
          }
        ],
        timestamp: new Date().toLocaleDateString()
      });
    }, 1500);
  });
};
