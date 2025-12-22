
import { Story, ScrapeJob } from '../types';

// Definition of proxy strategies
interface ProxyStrategy {
    name: string;
    buildUrl: (targetUrl: string) => string;
    extractContent: (response: Response) => Promise<string>;
}

const PROXIES: ProxyStrategy[] = [
    {
        name: 'CorsProxy.io',
        buildUrl: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        extractContent: async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.text();
        }
    },
    {
        name: 'CodeTabs',
        buildUrl: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
        extractContent: async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.text();
        }
    },
    {
        name: 'AllOrigins',
        buildUrl: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
        extractContent: async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data.contents) throw new Error('No contents in AllOrigins response');
            return data.contents;
        }
    }
];

/**
 * Fetches HTML using a rotating proxy strategy
 */
async function fetchHtmlWithFallback(
    url: string, 
    onLog?: (message: string, type: 'info' | 'error' | 'success') => void
): Promise<Document> {
    let lastError: Error | null = null;

    for (const proxy of PROXIES) {
        try {
            // specific delay to be nice to proxies
            await new Promise(r => setTimeout(r, 200));
            
            const proxyUrl = proxy.buildUrl(url);
            if (onLog) onLog(`Trying ${proxy.name}...`, 'info');
            
            const response = await fetch(proxyUrl);
            const htmlText = await proxy.extractContent(response);
            
            if (!htmlText || htmlText.length < 100) {
                throw new Error('Received empty or invalid content');
            }

            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, 'text/html');
            
            // Basic validation that we got a webpage
            if (!doc.querySelector('body')) {
                 throw new Error('Parsed HTML has no body');
            }

            if (onLog) onLog(`Using ${proxy.name}`, 'success');
            return doc;
        } catch (e) {
            // Clean error handling - no console.warn as requested
            // Just notify the caller via callback if provided
            if (onLog) onLog(`${proxy.name} failed`, 'error');
            lastError = e as Error;
            // Continue to next proxy
        }
    }

    throw new Error(`All proxies failed. Last error: ${lastError?.message}`);
}

// Helper to resolve relative URLs
const resolveUrl = (base: string, relative: string): string => {
    try {
        return new URL(relative, base).href;
    } catch (e) {
        return relative;
    }
};

/**
 * Parses a generic search result or category page to find story links
 */
export const fetchStoryLinks = async (
    searchUrl: string,
    onLog?: (message: string, type: 'info' | 'error' | 'success') => void
): Promise<{url: string, title: string}[]> => {
  try {
    const doc = await fetchHtmlWithFallback(searchUrl, onLog);
    
    // Selectors for story links in search results and category pages
    const anchors = Array.from(doc.querySelectorAll('a'));
    
    const stories = anchors
      .filter(a => {
        const href = a.getAttribute('href');
        // Generic heuristics for story sites
        return href && 
               (
                 href.includes('/story/') || 
                 href.includes('/view/') || 
                 href.includes('/works/') || 
                 href.includes('/s/') ||
                 href.includes('/fiction/')
               ) && 
               !href.includes('#') && 
               !href.includes('reviews') &&
               !href.includes('comment') &&
               !href.includes('rate') &&
               !href.includes('login');
      })
      .map(a => {
        const href = a.getAttribute('href') || '';
        const fullUrl = resolveUrl(searchUrl, href);
        
        return {
          url: fullUrl,
          title: a.textContent?.trim() || 'Unknown Title'
        };
      });

    // Deduplicate based on URL
    const uniqueStories = new Map();
    stories.forEach(s => {
        if (!uniqueStories.has(s.url)) {
            uniqueStories.set(s.url, s);
        }
    });
    
    return Array.from(uniqueStories.values());
  } catch (error) {
      console.error("Failed to fetch story list:", error);
      throw error;
  }
};

/**
 * Scrapes a single story, handling pagination
 */
export const scrapeStoryReal = async (
  url: string, 
  onProgress: (progress: number) => void,
  onLog?: (message: string, type: 'info' | 'error' | 'success') => void
): Promise<Story> => {
  let currentUrl = url;
  let pageCount = 1;
  let fullContent = '';
  let metadata: Partial<Story> = {
    id: crypto.randomUUID(),
    dateAdded: Date.now(),
    url: url,
    tags: [],
    category: 'Uncategorized'
  };

  // Used to detect loops
  const visitedUrls = new Set<string>();

  try {
    while (currentUrl && !visitedUrls.has(currentUrl)) {
      visitedUrls.add(currentUrl);
      onProgress(Math.min(95, pageCount * 10));

      const doc = await fetchHtmlWithFallback(currentUrl, onLog);

      // Extract Metadata on first page
      if (pageCount === 1) {
        // Generic selectors
        const titleEl = doc.querySelector('h1') || 
                        doc.querySelector('.story-title') || 
                        doc.querySelector('.post-title') || 
                        doc.querySelector('.entry-title');
        metadata.title = titleEl?.textContent?.trim() || 'Unknown Title';

        const authorEl = doc.querySelector('.author') || 
                         doc.querySelector('a[rel="author"]') || 
                         doc.querySelector('.byline') || 
                         doc.querySelector('.meta .user');
        metadata.author = authorEl?.textContent?.trim() || 'Unknown Author';

        const catEl = doc.querySelector('.category') || 
                      doc.querySelector('.breadcrumbs a:last-child') || 
                      doc.querySelector('a[rel="category tag"]');
        if (catEl) metadata.category = catEl.textContent?.trim();

        // Description often in meta tag or specific div
        const descEl = doc.querySelector('meta[name="description"]') || 
                       doc.querySelector('meta[property="og:description"]');
        metadata.description = descEl?.getAttribute('content') || '';
        
        // Tags - usually at the bottom or top
        const tagEls = Array.from(doc.querySelectorAll('a[href*="/tags/"], .tags a, .post-tags a'));
        metadata.tags = tagEls.map(t => t.textContent?.trim() || '').filter(t => t);
      }

      // Extract Content
      // Heuristic: Semantic tags or common class names
      let contentContainer = doc.querySelector('article') || 
                             doc.querySelector('.story-content') || 
                             doc.querySelector('.entry-content') || 
                             doc.querySelector('.post-content') || 
                             doc.querySelector('#story-text') || 
                             doc.querySelector('.main-content');
      
      // Fallback: Find the div that contains the most text paragraphs if strict selectors fail
      if (!contentContainer) {
          const divs = Array.from(doc.querySelectorAll('div'));
          let maxP = 0;
          for (const div of divs) {
              const pCount = div.querySelectorAll('p').length;
              if (pCount > maxP) {
                  maxP = pCount;
                  contentContainer = div;
              }
          }
      }
      
      if (contentContainer) {
        // Clean up the content
        // Remove scripts, ads, sidebars, etc.
        const clone = contentContainer.cloneNode(true) as Element;
        const junk = clone.querySelectorAll('script, style, .advert, .ad, .sidebar, .comments, .share-buttons, .related-posts, nav');
        junk.forEach(el => el.remove());
        
        fullContent += clone.innerHTML;
      } else {
        if (onLog) onLog(`No content found on page ${pageCount}`, 'error');
      }

      // Find Next Page
      // Look for "Next" button or link in pager
      const nextLink = doc.querySelector('a[rel="next"]') || 
                       doc.querySelector('.pagination .next') || 
                       doc.querySelector('.pager .next') ||
                       Array.from(doc.querySelectorAll('a')).find(a => {
                           const text = a.textContent?.trim().toLowerCase() || '';
                           return text === 'next' || text.includes('next page');
                       });
      
      if (nextLink) {
        let nextHref = nextLink.getAttribute('href');
        if (nextHref) {
           currentUrl = resolveUrl(currentUrl, nextHref);
           pageCount++;
        } else {
           currentUrl = '';
        }
      } else {
        currentUrl = '';
      }
    }

    onProgress(100);

    // Basic Word Count
    const wordCount = fullContent.replace(/<[^>]*>/g, ' ').split(/\s+/).length;

    // Fallbacks if metadata missing
    if (!metadata.title) metadata.title = 'Untitled Story';
    if (!metadata.author) metadata.author = 'Unknown';

    return {
      ...metadata,
      content: fullContent,
      wordCount,
    } as Story;

  } catch (e) {
    console.error("Scrape failed", e);
    throw e;
  }
};
