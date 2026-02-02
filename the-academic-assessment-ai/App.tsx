import React, { useState, useRef } from 'react';
import FileBucket from './components/FileBucket';
import ResultCard from './components/ResultCard';
import { FileInput, BatchProgress, AssessmentResult } from './types';
import { assessStudentWork } from './services/geminiService';

const App: React.FC = () => {
  // --- State Buckets ---
  const [briefFiles, setBriefFiles] = useState<FileInput[]>([]);
  const [rubricFiles, setRubricFiles] = useState<FileInput[]>([]);
  const [studentFiles, setStudentFiles] = useState<FileInput[]>([]);
  const [instructions, setInstructions] = useState<string>("");
  const [modelId, setModelId] = useState<string>('gemini-3-pro-preview');

  // --- Processing State ---
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'paused'>('idle');
  const [progress, setProgress] = useState<BatchProgress>({
    total: 0,
    current: 0,
    results: [],
    errors: []
  });
  
  // Ref for cancellation if needed (not implemented deeply, but good practice)
  const abortControllerRef = useRef<AbortController | null>(null);

  // --- Handlers ---
  const handleStartAssessment = async () => {
    if (studentFiles.length === 0) {
      alert("Please upload at least one student submission.");
      return;
    }
    
    // Reset Progress
    setStatus('running');
    setProgress({
      total: studentFiles.length,
      current: 0,
      results: [],
      errors: []
    });

    const brief = briefFiles.length > 0 ? briefFiles[0] : null;
    const rubric = rubricFiles.length > 0 ? rubricFiles[0] : null;

    // Iterate through students
    for (let i = 0; i < studentFiles.length; i++) {
      const student = studentFiles[i];
      
      try {
        // Send to AI with selected model
        const result = await assessStudentWork(brief, rubric, student, instructions, modelId);
        
        // Update State with new result
        setProgress(prev => ({
          ...prev,
          current: prev.current + 1,
          results: [result, ...prev.results] // Prepend to show newest first
        }));
      } catch (error) {
        console.error(`Error processing ${student.file.name}`, error);
        setProgress(prev => ({
          ...prev,
          current: prev.current + 1,
          errors: [...prev.errors, { fileName: student.file.name, error: "Failed to process" }]
        }));
      }

      // Add a polite delay between requests to avoid hitting rate limits immediately
      // Only delay if there are more items to process
      if (i < studentFiles.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay between files
      }
    }

    setStatus('completed');
  };

  const calculateProgressWidth = () => {
    if (progress.total === 0) return '0%';
    return `${Math.round((progress.current / progress.total) * 100)}%`;
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="bg-academic-900 text-white shadow-md z-10 sticky top-0">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white/10 rounded-md flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.499 5.216 50.59 50.59 0 00-2.658.812m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
                    </svg>
                </div>
                <div>
                    <h1 className="font-serif font-bold text-lg leading-tight">Academic Assessment AI</h1>
                    <p className="text-[10px] text-academic-300 uppercase tracking-widest">Grading Assistant v1.0</p>
                </div>
            </div>
            
            {/* Status Indicator */}
            <div className="flex items-center gap-4">
                 {status === 'running' && (
                    <div className="flex items-center gap-2 text-academic-200 text-sm animate-pulse">
                        <span>Processing {progress.current + 1} of {progress.total}</span>
                    </div>
                 )}
                 <div className="text-xs text-academic-400">
                    {process.env.API_KEY ? 'Connected to Gemini' : 'Mock Mode (No API Key)'}
                 </div>
            </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8 grid grid-cols-12 gap-8">
        
        {/* Left Column: Input Buckets (4 cols) */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
            
            {/* Bucket A: Context */}
            <div className="h-64">
                <FileBucket 
                    title="Bucket A: Context"
                    description="Upload the Assignment Brief (PDF/Text)"
                    files={briefFiles}
                    onFilesAdded={(f) => setBriefFiles(f)} // Replaces existing
                    onRemoveFile={() => setBriefFiles([])}
                    icon={
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                    }
                />
            </div>

            {/* Bucket B: Criteria (HEIGHT INCREASED to 600px for better visibility) */}
            <div className="flex flex-col bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden h-[600px]">
                <div className="flex-1 h-1/2">
                    <FileBucket 
                        title="Bucket B: Criteria"
                        description="Upload the Marking Rubric"
                        files={rubricFiles}
                        onFilesAdded={(f) => setRubricFiles(f)}
                        onRemoveFile={() => setRubricFiles([])}
                        icon={
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        }
                    />
                </div>
                <div className="border-t border-slate-200 p-4 bg-slate-50 flex-1 h-1/2 flex flex-col">
                    <label className="text-xs font-bold text-academic-700 uppercase tracking-wide mb-2 block">Further Instructions / Specific Focus</label>
                    <textarea 
                        className="w-full flex-1 p-3 text-sm text-gray-900 bg-white border border-slate-300 rounded focus:ring-2 focus:ring-academic-500 focus:border-academic-500 outline-none resize-none placeholder-gray-400"
                        placeholder="e.g. Focus specifically on Task 1a regarding critical analysis. Ignore Section 3."
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                    ></textarea>
                </div>
            </div>

             {/* Bucket C: Students */}
             <div className="h-96">
                <FileBucket 
                    title="Bucket C: Submissions"
                    description="Upload Student Files (Batch)"
                    files={studentFiles}
                    onFilesAdded={(f) => setStudentFiles([...studentFiles, ...f])}
                    onRemoveFile={(id) => setStudentFiles(studentFiles.filter(f => f.id !== id))}
                    multiple={true}
                    icon={
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                        </svg>
                    }
                />
            </div>
        </div>

        {/* Right Column: Actions & Results (8 cols) */}
        <div className="col-span-12 lg:col-span-8 flex flex-col">
            
            {/* Action Area */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 mb-8 sticky top-20 z-10">
                
                {/* Model Selector and Main Actions */}
                <div className="mb-6">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h2 className="text-xl font-serif font-bold text-academic-900">Assessment Console</h2>
                            <p className="text-slate-500 text-sm mb-3">Ready to process {studentFiles.length} submissions.</p>
                        </div>
                        <button 
                            onClick={handleStartAssessment}
                            disabled={status === 'running' || studentFiles.length === 0}
                            className={`
                                px-6 py-3 rounded text-white font-medium shadow-sm transition-all
                                ${status === 'running' ? 'bg-slate-400 cursor-not-allowed' : 'bg-academic-600 hover:bg-academic-700 hover:shadow-md'}
                            `}
                        >
                            {status === 'running' ? 'Processing...' : 'Start Batch Assessment'}
                        </button>
                    </div>

                    <div className="flex items-center gap-2 bg-slate-50 p-3 rounded border border-slate-200">
                        <span className="text-xs font-bold text-academic-700 uppercase whitespace-nowrap">AI Model:</span>
                        <select 
                            value={modelId}
                            onChange={(e) => setModelId(e.target.value)}
                            className="w-full bg-transparent text-sm text-slate-700 font-medium focus:outline-none cursor-pointer"
                        >
                            <option value="gemini-3-pro-preview">Gemini 3.0 Pro (High Reasoning - Best for Grading)</option>
                            <option value="gemini-3-flash-preview">Gemini 3.0 Flash (Fast - High Quota Limit)</option>
                        </select>
                    </div>
                </div>

                {/* Progress Bar */}
                <div className="relative pt-1">
                    <div className="flex mb-2 items-center justify-between">
                        <div>
                        <span className="text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-academic-600 bg-academic-100">
                            Progress
                        </span>
                        </div>
                        <div className="text-right">
                        <span className="text-xs font-semibold inline-block text-academic-600">
                            {calculateProgressWidth()}
                        </span>
                        </div>
                    </div>
                    <div className="overflow-hidden h-2 mb-4 text-xs flex rounded bg-academic-100">
                        <div 
                            style={{ width: calculateProgressWidth() }} 
                            className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-academic-600 transition-all duration-500 ease-out"
                        ></div>
                    </div>
                </div>
            </div>

            {/* Results Stream */}
            <div className="flex-1">
                {progress.results.length === 0 && status === 'idle' && (
                    <div className="h-64 flex items-center justify-center text-slate-400 bg-white rounded-lg border border-dashed border-slate-300">
                        <p>Feedback cards will appear here...</p>
                    </div>
                )}
                
                {progress.results.map((result, idx) => (
                    <ResultCard key={idx} result={result} />
                ))}
            </div>

        </div>

      </main>
    </div>
  );
};

export default App;