
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Link as LinkIcon, AlertCircle, CheckCircle, Loader, Download, FileDown, Network, Files, Trash2, FileCode, Archive, FileText } from 'lucide-react';
import { ScrapeJob, Story } from '../types';
import { scrapeStoryReal, fetchStoryLinks } from '../services/Scraper';
import JSZip from 'jszip';
import TurndownService from 'turndown';

const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});

interface SearchViewProps {
  onStartJobs: (jobs: ScrapeJob[]) => void;
  jobs: ScrapeJob[];
  onJobComplete: (story: Story) => void;
  stories: Story[];
  onClearQueue: () => void;
}

export const SearchView: React.FC<SearchViewProps> = ({ onStartJobs, jobs, onJobComplete, stories, onClearQueue }) => {
  const [inputUrl, setInputUrl] = useState('');
  const [isFetchingLinks, setIsFetchingLinks] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [foundLinks, setFoundLinks] = useState<{url: string, title: string}[]>([]);
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set());
  
  const [isExporting, setIsExporting] = useState(false);
  
  // Internal tick to force re-render for smooth progress bars
  const [, setRenderTick] = useState(0);
  
  // To manage concurrency
  const processingRef = useRef<Set<string>>(new Set());

  // Handle running jobs effect
  useEffect(() => {
    const processQueue = async () => {
      const pendingJobs = jobs.filter(j => j.status === 'pending');
      const activeJobs = jobs.filter(j => j.status === 'downloading');
      
      // Max concurrent downloads (Keep low to avoid getting blocked)
      const MAX_CONCURRENT = 2;

      if (activeJobs.length >= MAX_CONCURRENT || pendingJobs.length === 0) return;

      const jobToStart = pendingJobs[0];
      
      // Prevent double processing
      if (processingRef.current.has(jobToStart.id)) return;
      processingRef.current.add(jobToStart.id);

      // Update status to downloading - Mutation is intentional for performance in this specific architecture
      // We rely on setRenderTick to reflect changes in UI
      jobToStart.status = 'downloading';
      setRenderTick(t => t + 1);
      
      try {
        const story = await scrapeStoryReal(jobToStart.url, (progress) => {
            jobToStart.progress = progress;
            // Force re-render for smooth progress bar animation
            setRenderTick(t => t + 1);
        });
        
        jobToStart.status = 'completed';
        jobToStart.progress = 100;
        jobToStart.resultStoryId = story.id;
        jobToStart.title = story.title;
        onJobComplete(story);
      } catch (error) {
        jobToStart.status = 'failed';
        jobToStart.error = error instanceof Error ? error.message : 'Unknown error';
      } finally {
        processingRef.current.delete(jobToStart.id);
        setRenderTick(t => t + 1);
      }
    };

    // Reduced interval for snappier response
    const interval = setInterval(processQueue, 500);
    return () => clearInterval(interval);
  }, [jobs, onJobComplete]);

  const handleFetchLinks = useCallback(async () => {
      let targetUrl = inputUrl.trim();
      if (!targetUrl) return;

      // Automatically prepend https:// if missing
      if (!/^https?:\/\//i.test(targetUrl)) {
          targetUrl = `https://${targetUrl}`;
      }

      setIsFetchingLinks(true);
      setStatusMessage('Scanning page for stories...');
      setFoundLinks([]);
      setSelectedLinks(new Set());

      try {
          const links = await fetchStoryLinks(targetUrl, (msg) => setStatusMessage(msg));
          setFoundLinks(links);
          // Auto select all by default
          setSelectedLinks(new Set(links.map(l => l.url)));
          setStatusMessage(`Found ${links.length} stories!`);
      } catch (e) {
          setStatusMessage(`Error: ${e instanceof Error ? e.message : 'Failed to fetch'}`);
      } finally {
          setIsFetchingLinks(false);
      }
  }, [inputUrl]);

  const handleStartDownload = () => {
      const linksToDownload = foundLinks.filter(l => selectedLinks.has(l.url));
      const newJobs: ScrapeJob[] = linksToDownload.map(l => ({
          id: crypto.randomUUID(),
          url: l.url,
          title: l.title,
          status: 'pending',
          progress: 0
      }));
      onStartJobs(newJobs);
      setFoundLinks([]);
      setInputUrl('');
      setStatusMessage(`Started ${newJobs.length} downloads`);
  };

  const toggleLinkSelection = (url: string) => {
      const newSet = new Set(selectedLinks);
      if (newSet.has(url)) newSet.delete(url);
      else newSet.add(url);
      setSelectedLinks(newSet);
  };

  // --- EXPORT LOGIC ---

  const handleSingleMdDownload = (story: Story) => {
      if (!story) {
        alert("Error: Story content is missing.");
        return;
      }

      const markdown = `# ${story.title}\n\n${turndownService.turndown(story.content)}`;
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${story.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleBulkZipDownload = async () => {
      const completedJobs = jobs.filter(j => j.status === 'completed' && j.resultStoryId);
      const storiesToExport = completedJobs
          .map(j => stories.find(s => s.id === j.resultStoryId))
          .filter((s): s is Story => !!s);
      
      if (storiesToExport.length === 0) {
        alert("No completed stories found to export.");
        return;
      }

      setIsExporting(true);
      const zip = new JSZip();

      storiesToExport.forEach(story => {
          const fileName = `${story.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
          const markdown = `# ${story.title}\n\n${turndownService.turndown(story.content)}`;
          zip.file(fileName, markdown);
      });

      try {
          const content = await zip.generateAsync({ type: 'blob' });
          const url = URL.createObjectURL(content);
          const a = document.createElement('a');
          a.href = url;
          a.download = `readstack_export_${storiesToExport.length}_stories.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
      } catch (error) {
          console.error("ZIP generation failed:", error);
          alert("Failed to generate ZIP file.");
      } finally {
          setIsExporting(false);
      }
  };

  const completedCount = jobs.filter(j => j.status === 'completed').length;

  return (
    <div className="space-y-8 max-w-4xl mx-auto transform-gpu">
      {/* Search & Fetch Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl transition-shadow duration-300 hover:shadow-2xl hover:shadow-orange-900/10">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Network className="w-5 h-5 text-orange-500" />
          Fetch New Stories
        </h3>
        
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1 group">
            <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-orange-500 transition-colors duration-300" />
            <input 
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Paste Story URL (Story or Category page)..."
              className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg pl-10 pr-4 py-3 focus:ring-1 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all duration-300 ease-out-quart placeholder:text-slate-600"
            />
          </div>
          <button 
            onClick={handleFetchLinks}
            disabled={isFetchingLinks || !inputUrl}
            className="bg-orange-500 hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold px-6 rounded-lg transition-all duration-300 flex items-center gap-2 active:scale-95"
          >
            {isFetchingLinks ? <Loader className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Fetch</span>
          </button>
        </div>

        {statusMessage && (
            <div className="text-sm text-slate-400 mb-4 px-1 flex items-center gap-2 animate-in fade-in duration-300">
                <AlertCircle className="w-4 h-4" />
                {statusMessage}
            </div>
        )}

        {/* Found Links Selection */}
        {foundLinks.length > 0 && (
            <div className="mt-6 border-t border-slate-800 pt-6 animate-in slide-in-from-top-4 duration-500 ease-out-quart">
                <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-medium text-slate-300">Found {foundLinks.length} stories</span>
                    <div className="flex gap-2">
                        <button onClick={() => setSelectedLinks(new Set(foundLinks.map(l => l.url)))} className="text-xs text-orange-500 hover:underline transition-all">Select All</button>
                        <button onClick={() => setSelectedLinks(new Set())} className="text-xs text-slate-500 hover:underline transition-all">None</button>
                    </div>
                </div>
                
                <div 
                    className="max-h-60 overflow-y-auto custom-scrollbar bg-slate-950 rounded-lg border border-slate-800 p-2 mb-4"
                    style={{ contentVisibility: 'auto' }}
                >
                    {foundLinks.map((link) => (
                        <div key={link.url} className="flex items-start gap-3 p-2 hover:bg-slate-900 rounded cursor-pointer transition-colors duration-200 group" onClick={() => toggleLinkSelection(link.url)}>
                            <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-all duration-200 ${selectedLinks.has(link.url) ? 'bg-orange-500 border-orange-500' : 'border-slate-700 group-hover:border-slate-500'}`}>
                                {selectedLinks.has(link.url) && <CheckCircle className="w-3 h-3 text-white animate-in zoom-in duration-200" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-slate-200 truncate group-hover:text-white transition-colors">{link.title}</div>
                                <div className="text-xs text-slate-600 truncate">{link.url}</div>
                            </div>
                        </div>
                    ))}
                </div>

                <button 
                    onClick={handleStartDownload}
                    disabled={selectedLinks.size === 0}
                    className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-orange-500 font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-all duration-300 hover:shadow-lg hover:shadow-orange-900/10 active:scale-98"
                >
                    <Download className="w-4 h-4" />
                    Download {selectedLinks.size} Selected Stories
                </button>
            </div>
        )}
      </div>

      {/* Active Jobs Section */}
      {jobs.length > 0 ? (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out-quart">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                    <Files className="w-4 h-4 text-orange-500" />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white leading-none">Download Queue</h3>
                    <p className="text-xs text-slate-500 mt-1">{jobs.length} items in queue</p>
                </div>
            </div>
            <div className="flex items-center gap-2">
                {completedCount > 1 && (
                    <button 
                        onClick={handleBulkZipDownload}
                        disabled={isExporting}
                        className="text-xs text-slate-950 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 font-bold px-4 py-2.5 rounded-lg flex items-center gap-2 transition-all shadow-lg shadow-orange-500/10 hover:shadow-orange-500/20 active:scale-95"
                    >
                        {isExporting ? <Loader className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                        {isExporting ? 'Generating ZIP...' : `Export All (${completedCount})`}
                    </button>
                )}
                <button
                    onClick={onClearQueue}
                    className="text-xs text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-800 hover:border-slate-700 font-medium px-3 py-2.5 rounded-lg flex items-center gap-2 transition-all active:scale-95"
                >
                    <Trash2 className="w-4 h-4" />
                    Clear
                </button>
            </div>
          </div>
          
          <div className="grid gap-3">
            {[...jobs].reverse().map(job => (
                <div key={job.id} className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 flex items-center gap-4 transform-gpu transition-all duration-300 hover:border-slate-700 hover:bg-slate-900">
                    <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center shrink-0">
                        {job.status === 'downloading' && <Loader className="w-5 h-5 text-orange-500 animate-spin" />}
                        {job.status === 'completed' && <CheckCircle className="w-5 h-5 text-orange-500 animate-in zoom-in duration-300" />}
                        {job.status === 'failed' && <AlertCircle className="w-5 h-5 text-red-500 animate-in zoom-in duration-300" />}
                        {job.status === 'pending' && <div className="w-2 h-2 rounded-full bg-slate-600" />}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                        <div className="flex justify-between mb-1">
                            <span className="font-medium text-slate-200 truncate">{job.title || 'Unknown Story'}</span>
                            <span className={`text-xs font-medium capitalize ${job.status === 'failed' ? 'text-red-400' : 'text-slate-500'}`}>{job.status}</span>
                        </div>
                        
                        {job.status === 'downloading' ? (
                            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-orange-500 transition-all duration-300 ease-out-quart" 
                                    style={{ width: `${job.progress}%` }}
                                ></div>
                            </div>
                        ) : (
                            <div className="text-xs text-slate-500 truncate">{job.url}</div>
                        )}

                        {job.status === 'completed' && job.resultStoryId && (
                            <div className="flex gap-4 mt-2 animate-in fade-in duration-300">
                                <button 
                                    onClick={() => {
                                      const s = stories.find(s => s.id === job.resultStoryId);
                                      if (s) handleSingleMdDownload(s);
                                      else alert("Error: Story content missing.");
                                    }}
                                    className="text-xs flex items-center gap-1 text-orange-500 hover:text-orange-400 font-medium transition-colors"
                                >
                                    <FileText className="w-3 h-3" />
                                    Save Markdown
                                </button>
                            </div>
                        )}
                        
                        {job.status === 'failed' && (
                            <div className="text-xs text-red-400 mt-1">{job.error}</div>
                        )}
                    </div>
                </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="py-12 flex flex-col items-center justify-center text-center opacity-0 animate-fade-in delay-300">
            <div className="w-16 h-16 bg-slate-900 rounded-2xl border border-slate-800 flex items-center justify-center mb-4 text-slate-700">
                <FileText className="w-8 h-8" />
            </div>
            <h4 className="text-slate-400 font-medium">No active downloads</h4>
            <p className="text-slate-600 text-sm mt-1">Paste a URL above to start building your stack</p>
        </div>
      )}
    </div>
  );
};
