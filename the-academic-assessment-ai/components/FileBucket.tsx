import React, { useCallback } from 'react';
import { FileInput } from '../types';
import { determineFileType } from '../utils/fileHelper';

interface FileBucketProps {
  title: string;
  description: string;
  files: FileInput[];
  onFilesAdded: (newFiles: FileInput[]) => void;
  onRemoveFile: (id: string) => void;
  multiple?: boolean;
  accept?: string;
  icon?: React.ReactNode;
}

const FileBucket: React.FC<FileBucketProps> = ({
  title,
  description,
  files,
  onFilesAdded,
  onRemoveFile,
  multiple = false,
  accept = ".pdf,.docx,.txt,.png,.jpg",
  icon
}) => {
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles: FileInput[] = Array.from(e.target.files).map(f => ({
        file: f as File,
        id: Math.random().toString(36).substr(2, 9),
        type: determineFileType(f as File)
      }));
      onFilesAdded(newFiles);
      e.target.value = ''; // Reset
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
      <div className="bg-academic-50 p-4 border-b border-slate-200 flex items-center gap-3">
        <div className="text-academic-700">
            {icon}
        </div>
        <div>
          <h3 className="font-serif font-bold text-academic-900">{title}</h3>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
      </div>
      
      <div className="p-4 flex-1 flex flex-col gap-3">
        {/* File List */}
        <div className="flex-1 overflow-y-auto space-y-2 min-h-[100px]">
          {files.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-md p-6">
              <span>No files uploaded</span>
            </div>
          )}
          {files.map((f) => (
            <div key={f.id} className="flex items-center justify-between bg-slate-50 p-2 rounded text-sm border border-slate-200">
              <div className="flex items-center gap-2 truncate">
                <span className="uppercase text-[10px] font-bold bg-academic-100 text-academic-700 px-1 rounded">
                    {f.file.name.split('.').pop()}
                </span>
                <span className="truncate max-w-[150px]">{f.file.name}</span>
              </div>
              <button 
                onClick={() => onRemoveFile(f.id)}
                className="text-red-400 hover:text-red-600 px-2"
              >
                &times;
              </button>
            </div>
          ))}
        </div>

        {/* Upload Action */}
        <label className="cursor-pointer block">
          <div className="bg-academic-600 hover:bg-academic-700 text-white text-center py-2 px-4 rounded text-sm font-medium transition-colors">
            {files.length > 0 && !multiple ? 'Replace File' : 'Upload File'}
          </div>
          <input 
            type="file" 
            className="hidden" 
            multiple={multiple} 
            accept={accept}
            onChange={handleFileChange}
          />
        </label>
      </div>
    </div>
  );
};

export default FileBucket;