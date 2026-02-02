
import React from 'react';
import { AssessmentResult, RubricCriterion, BriefAdherence } from '../types';
import { generateReportText } from '../utils/fileHelper';

interface ResultCardProps {
  result: AssessmentResult;
}

const ResultCard: React.FC<ResultCardProps> = ({ result }) => {
  const gradeStr = result.grade || '';
  const isDistinction = gradeStr.toLowerCase().includes('distinction');
  const isFail = gradeStr.toLowerCase().includes('fail');
  const gradeColor = isDistinction ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 
                     isFail ? 'text-red-700 bg-red-50 border-red-200' : 
                     'text-academic-700 bg-academic-50 border-academic-200';

  const downloadReport = () => {
    const text = generateReportText(result);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.studentName}_Audit_Report.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getAdherenceBadge = (level: BriefAdherence['adherenceLevel']) => {
    const colors = {
      'Full': 'bg-emerald-100 text-emerald-800 border-emerald-200',
      'Partial': 'bg-amber-100 text-amber-800 border-amber-200',
      'Minimal': 'bg-orange-100 text-orange-800 border-orange-200',
      'None': 'bg-red-100 text-red-800 border-red-200'
    };
    return (
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${colors[level]}`}>
        {level} Adherence
      </span>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden mb-8 transition-all hover:shadow-lg">
      {/* Header */}
      <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-gradient-to-r from-white to-slate-50">
        <div>
            <h3 className="font-serif font-bold text-2xl text-academic-900 tracking-tight">{result.studentName}</h3>
            <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Submission File:</span>
                <p className="text-xs text-slate-500 font-medium">{result.fileName}</p>
            </div>
        </div>
        <div className={`px-6 py-2 rounded-lg border-2 shadow-sm font-bold text-center min-w-[100px] ${gradeColor}`}>
            <div className="text-2xl leading-none">{result.mark}</div>
            <div className="text-[10px] uppercase tracking-wider mt-1 opacity-80">{result.grade}</div>
        </div>
      </div>

      {/* Quantitative Analysis */}
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 border-b border-slate-100 bg-slate-50/50">
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-academic-600 mb-2 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                </svg>
                Lexical Density Audit
            </h4>
            <p className="text-xs text-slate-600 leading-relaxed italic">
                {result.technicalDensity}
            </p>
        </div>
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-academic-600 mb-2 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Structural Volume Audit
            </h4>
            <p className="text-xs text-slate-600 leading-relaxed italic">
                {result.wordCountAnalysis}
            </p>
        </div>
      </div>

      {/* Executive Summary */}
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 border-b border-slate-100">
        <div className="bg-emerald-50/30 p-4 rounded-lg border border-emerald-100">
            <h4 className="text-xs font-bold uppercase tracking-widest text-emerald-800 mb-2">Technical Strengths (WWW)</h4>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{result.www}</p>
        </div>
        <div className="bg-amber-50/30 p-4 rounded-lg border border-amber-100">
            <h4 className="text-xs font-bold uppercase tracking-widest text-amber-800 mb-2">Analytical Gaps (EBI)</h4>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{result.ebi}</p>
        </div>
      </div>

      {/* Brief Adherence Audit */}
      <div className="p-6 border-b border-slate-100">
        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0118 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3l1.5 1.5 3-3.75" />
            </svg>
            Task Integrity Inventory
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {result.briefAdherence.map((task, idx) => (
                <div key={idx} className="bg-slate-50 border border-slate-200 p-3 rounded flex flex-col gap-2">
                    <div className="flex justify-between items-start">
                        <h5 className="text-xs font-bold text-academic-800 truncate pr-2">{task.taskName}</h5>
                        {getAdherenceBadge(task.adherenceLevel)}
                    </div>
                    <div className="text-[10px] text-slate-500 bg-white p-2 border border-slate-100 italic rounded leading-relaxed border-l-2 border-academic-300">
                        {task.evidence}
                    </div>
                    <p className="text-[11px] text-slate-600 font-medium">
                        {task.commentary}
                    </p>
                </div>
            ))}
        </div>
      </div>

      {/* Feed Forward */}
      <div className="px-6 py-5 bg-academic-900 text-white">
          <div className="flex items-start gap-4">
              <div className="bg-white/10 p-2 rounded shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-academic-200">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                </svg>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-academic-300 block mb-1">Pedagogical Strategy</span>
                <p className="text-sm text-academic-50 leading-relaxed">{result.feedForward}</p>
              </div>
          </div>
      </div>

      {/* Detailed Rubric Breakdown */}
      <div className="p-6 bg-slate-50">
        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Verbatim Evidence Mapping
        </h4>
        <div className="space-y-4">
            {result.rubricAlignment.map((crit, idx) => (
                <div key={idx} className="bg-white rounded border border-slate-200 shadow-sm overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex justify-between items-center">
                        <h5 className="text-xs font-bold text-academic-900">{crit.criterion}</h5>
                        <span className="text-[10px] font-mono font-bold bg-academic-100 text-academic-800 px-2 py-0.5 rounded border border-academic-200">
                            {crit.score}
                        </span>
                    </div>
                    <div className="p-4 space-y-3">
                         <div>
                            <span className="text-[9px] font-bold uppercase text-slate-400 tracking-wider block mb-1">Verbatim Quotes Found:</span>
                            <div className="text-[11px] text-slate-700 italic border-l-2 border-emerald-400 pl-3 bg-emerald-50/20 py-2 rounded-r whitespace-pre-wrap leading-relaxed">
                                {crit.evidenceFound}
                            </div>
                         </div>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-50">
                            <div>
                                <span className="text-[9px] font-bold uppercase text-slate-400 tracking-wider block mb-1">Audit Reasoning:</span>
                                <p className="text-[11px] text-slate-600 leading-relaxed">{crit.criticalReasoning}</p>
                            </div>
                            <div>
                                <span className="text-[9px] font-bold uppercase text-amber-600 tracking-wider block mb-1">Missing Evidence/Depth:</span>
                                <p className="text-[11px] text-slate-600 leading-relaxed">{crit.missingEvidence}</p>
                            </div>
                         </div>
                    </div>
                </div>
            ))}
        </div>
      </div>

      {/* Footer */}
      <div className="bg-slate-100 p-4 border-t border-slate-200 flex justify-between items-center">
        <span className="text-[10px] text-slate-400 font-medium">Deterministic Evidence Protocol v3.1 • {result.timestamp}</span>
        <button 
            onClick={downloadReport}
            className="text-xs font-bold text-academic-700 hover:text-academic-900 bg-white px-4 py-2 rounded border border-slate-200 shadow-sm transition-all hover:shadow-md"
        >
            Export Comprehensive Audit
        </button>
      </div>
    </div>
  );
};

export default ResultCard;
