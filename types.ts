
export interface Story {
  id: string;
  title: string;
  author: string;
  description: string;
  content: string; // HTML or Markdown content
  tags: string[];
  category: string;
  rating?: number;
  wordCount?: number;
  dateAdded: number;
  publishedDate?: string;
  url?: string;
}

export interface ScrapeJob {
  id: string;
  url: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  progress: number;
  title?: string;
  publishedDate?: string;
  error?: string;
  resultStoryId?: string;
  proxyStatus?: string; // e.g., "Trying CodeTabs...", "Success via AllOrigins"
}
