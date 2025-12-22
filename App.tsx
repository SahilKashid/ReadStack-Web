import React, { useState } from 'react';
import { Download, Database } from 'lucide-react';
import { Story, ScrapeJob } from './types';
import { SearchView } from './components/SearchView';

const App: React.FC = () => {
  const [stories, setStories] = useState<Story[]>([]);
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);

  const handleJobStart = (newJobs: ScrapeJob[]) => {
    setJobs(prev => [...prev, ...newJobs]);
  };

  const handleJobComplete = (story: Story) => {
    setStories(prev => [story, ...prev]);
  };

  const handleClearQueue = () => {
    setJobs(prev => prev.filter(j => j.status === 'downloading' || j.status === 'pending'));
  };

  const activeJobsCount = jobs.filter(j => j.status === 'downloading' || j.status === 'pending').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col font-sans selection:bg-orange-500/30">
      {/* Unified Header */}
      <header className="h-16 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-4 md:px-8 sticky top-0 z-50 backdrop-blur-md bg-opacity-80 transition-all duration-300">
        <div className="flex items-center gap-3 group cursor-default">
          <div className="w-9 h-9 bg-orange-500 rounded-lg flex items-center justify-center transform group-hover:scale-105 transition-transform duration-300 ease-out-quart shadow-lg shadow-orange-500/20">
            <Download className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold text-orange-500 leading-none">
              ReadStack
            </span>
            <span className="text-[10px] text-slate-500 font-medium tracking-wide group-hover:text-slate-400 transition-colors">
              V1.2.0
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 md:gap-6">
          {/* Status Indicator */}
          <div className="hidden md:flex items-center gap-2 text-slate-400 bg-slate-900 px-3 py-1.5 rounded-full border border-slate-800 select-none">
            <div className="relative flex items-center justify-center w-2.5 h-2.5">
               <div className="absolute w-full h-full bg-orange-500 rounded-full animate-pulse-slow opacity-75"></div>
               <div className="relative w-2 h-2 bg-orange-500 rounded-full"></div>
            </div>
            <span className="text-xs font-medium">System Online</span>
          </div>

          {/* Story Counter */}
          <div className="flex items-center gap-3 pl-3 md:pl-6 md:border-l border-slate-800">
            <div className="flex flex-col items-end">
               <span className="text-xs text-slate-500 font-medium">Processed</span>
               <span className="text-sm font-bold text-slate-200 leading-none tabular-nums">{stories.length}</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-orange-500 transform-gpu transition-transform hover:scale-110 duration-300">
                <Database className="w-4 h-4" />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-5xl mx-auto p-4 md:p-8">
        <div className="opacity-0 animate-fade-in-up">
          <SearchView 
            onStartJobs={handleJobStart} 
            jobs={jobs}
            onJobComplete={handleJobComplete}
            stories={stories}
            onClearQueue={handleClearQueue}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-slate-600 border-t border-slate-900 bg-slate-950">
        <p>ReadStack Web • Client-side Scraper & PDF Generator</p>
      </footer>
    </div>
  );
};

export default App;