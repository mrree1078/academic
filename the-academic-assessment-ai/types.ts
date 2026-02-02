
export interface BriefAdherence {
  taskName: string;
  adherenceLevel: 'Full' | 'Partial' | 'Minimal' | 'None';
  evidence: string;
  commentary: string;
}

export interface RubricCriterion {
  criterion: string;
  score: string;
  missingEvidence: string;
  evidenceFound: string;
  criticalReasoning: string;
}

export interface FileInput {
  file: File;
  id: string;
  preview?: string;
  type: 'pdf' | 'image' | 'text' | 'docx' | 'other';
}

export interface AssessmentResult {
  studentName: string;
  fileName: string;
  mark: string;
  grade: string;
  www: string;
  ebi: string;
  feedForward: string;
  technicalDensity: string; // Analysis of technical terms count vs total text
  wordCountAnalysis: string; // Quantitative vs Qualitative summary
  briefAdherence: BriefAdherence[];
  rubricAlignment: RubricCriterion[];
  timestamp: string;
}

export interface AssessmentError {
  fileName: string;
  error: string;
}

export type ProcessingStatus = 'idle' | 'processing' | 'completed' | 'error';

export interface BatchProgress {
  total: number;
  current: number;
  results: AssessmentResult[];
  errors: AssessmentError[];
}
